# Replit/Codex Prompt - Phase S1-S5 Service Security and Client Integration

You are working in the `northflow-payment-orchestration` repository.

Implement Phase S1-S5 for service security and multi-client integration isolation.

This prompt is written for implementation. Do not treat it as a roadmap-only document.

## Goal

Move the service from a single shared service credential model to a per-client authentication and authorization model.

Northflow must safely support these consumer applications:

- Consumer A: multi-tenant POS using direct REST API.
- Consumer B: multi-tenant transport/booking system using the SDK.
- Consumer C: payment/OTC app using direct REST API.

The intended model is:

```txt
1 consumer app environment = 1 API client
1 tenant/business/payment owner = 1 merchant
```

## Strict Scope

Do not implement dashboard work.
Do not implement provider webhook roadmap work.
Do not rewrite unrelated payment logic.
Do not weaken existing idempotency, refund, void, reconciliation, or provider protections.

---

## Phase S1 - API Client Registry

Add persistent service-owned models for:

1. API clients.
2. API client credentials.
3. Client-to-merchant access grants.

Use the existing service-local Drizzle schema pattern in `apps/service/src/infrastructure/schema.ts`.

Required API client fields:

```txt
id
name
source_app
environment
status
metadata
created_at
updated_at
```

Required client credential fields:

```txt
id
client_id
credential_prefix
credential_hash
status
expires_at
last_used_at
created_at
revoked_at
```

Required client merchant access fields:

```txt
id
client_id
merchant_id
scopes
status
created_at
revoked_at
```

Rules:

- Never store raw credential material.
- Store only a safe prefix and one-way hash.
- Raw generated credential material may be shown only once at creation time.
- Support active, revoked, and expired credential states.
- Add repository contracts in `packages/core` where needed.
- Add Drizzle implementations under `apps/service/src/infrastructure/repositories`.

S1 acceptance criteria:

- Schema compiles.
- Migration generation works.
- Repositories compile and are wired into the service container.
- Tests cover active, revoked, and expired credential states.
- Tests cover client-to-merchant access lookup.

---

## Phase S2 - Replace Global Token With Client Auth

Replace the shared service credential middleware with per-client authentication.

The service must resolve:

```txt
presented credential -> credential record -> client -> sourceApp -> environment -> scopes/access context
```

Attach a typed auth context to the request:

```ts
req.auth = {
  clientId: string,
  sourceApp: string,
  environment: string,
  credentialId: string,
  scopes: string[]
}
```

Legacy compatibility:

- Keep the old shared service credential only as optional compatibility mode.
- Add an environment flag named `PAYMENT_ORCHESTRATION_LEGACY_SERVICE_TOKEN_ENABLED`.
- Production default must be disabled.
- If disabled, the old shared service credential must not authorize protected routes.

S2 acceptance criteria:

- Missing credential returns 401.
- Invalid credential returns 401.
- Revoked credential returns 401.
- Expired credential returns 401.
- Valid credential attaches request auth context.
- Production disables legacy shared credential by default.
- Existing API error envelope remains stable.

---

## Phase S3 - Merchant Ownership Guard

Every protected route that receives or resolves `merchantId` must verify:

```txt
merchantId belongs to, or is granted to, req.auth.clientId
```

If access is not granted, return:

```txt
403 MERCHANT_ACCESS_DENIED
```

Protected route families:

```txt
POST /v1/merchants
GET  /v1/merchants/:id
POST /v1/merchants/:merchantId/provider-accounts
GET  /v1/merchants/:merchantId/provider-accounts/:id
POST /v1/payment-intents
GET  /v1/payment-intents/:id/status
GET  /v1/payment-intents/:id/refundability
POST /v1/payment-intents/:id/gateway-payments
POST /v1/payment-intents/:id/reconcile
POST /v1/payment-transactions/:transactionId/refund
POST /v1/payment-transactions/:transactionId/void
```

Create merchant behavior:

- Requires `merchant:create` scope.
- Newly-created merchants must be linked to the creating API client unless the client is explicitly internal/system.

S3 acceptance criteria:

- Consumer A client can access Consumer A merchants only.
- Consumer B client can access Consumer B merchants only.
- Consumer C client can access Consumer C merchants only.
- Cross-merchant access returns `403 MERCHANT_ACCESS_DENIED`.
- Existing merchant-scoped idempotency behavior remains intact.

---

## Phase S4 - SourceApp Enforcement

Prevent caller spoofing.

If authenticated client source app is `consumer-a`, then request payloads that include `sourceApp` must also use `consumer-a`.

If a request sends a different source app, return:

```txt
403 SOURCE_APP_MISMATCH
```

If `sourceApp` is omitted where safe, default it to `req.auth.sourceApp`.

Apply this at minimum to:

- Create merchant.
- Create payment intent.

S4 acceptance criteria:

- Matching sourceApp succeeds.
- Missing sourceApp is auto-filled where safe.
- Mismatched sourceApp returns `403 SOURCE_APP_MISMATCH`.
- External references remain application-owned references and are not treated as authentication data.

---

## Phase S5 - Scope-Based Authorization

Add route-level scope checks.

Initial route-scope matrix:

```txt
POST /v1/merchants -> merchant:create
GET /v1/merchants/:id -> merchant:read
POST /v1/merchants/:merchantId/provider-accounts -> provider_account:create
GET /v1/merchants/:merchantId/provider-accounts/:id -> provider_account:read
POST /v1/payment-intents -> intent:create
GET /v1/payment-intents/:id/status -> intent:read
GET /v1/payment-intents/:id/refundability -> intent:read
POST /v1/payment-intents/:id/gateway-payments -> payment:create
POST /v1/payment-intents/:id/reconcile -> payment:reconcile
POST /v1/payment-transactions/:transactionId/refund -> payment:refund
POST /v1/payment-transactions/:transactionId/void -> payment:void
```

If scope is missing, return:

```txt
403 SCOPE_DENIED
```

Scope checks must compose with merchant ownership checks.

S5 acceptance criteria:

- Client without `payment:refund` cannot refund.
- Client without `payment:void` cannot void.
- Client without `merchant:create` cannot create merchant.
- Client without `payment:reconcile` cannot reconcile.
- Rejections use `403 SCOPE_DENIED`.

---

## Implementation Rules

1. Preserve existing API response envelope.
2. Never store raw credential material.
3. Never log credentials, provider secrets, authorization data, or raw sensitive headers.
4. Keep service-local schema ownership under `apps/service/src/infrastructure/schema.ts`.
5. Keep shared contracts in `packages/core` when repositories, SDK, or app code need them.
6. Keep payment domain behavior unchanged unless required for auth or authorization enforcement.
7. Do not implement dashboard or webhook roadmap work in this phase.
8. Do not remove existing tests unless replaced with equivalent or better tests.
9. Update docs when headers, env vars, or integration contracts change.

## Required Tests

Add or update tests for:

- API client creation and lookup.
- Credential hashing and validation.
- Revoked credential rejection.
- Expired credential rejection.
- Missing credential rejection.
- Valid credential request auth context.
- Client merchant access allowed.
- Client merchant access denied.
- SourceApp mismatch rejection.
- Missing sourceApp auto-fill where safe.
- Scope allowed.
- Scope denied.
- Consumer A client cannot access Consumer B merchant.
- Consumer B client cannot access Consumer C merchant.
- Consumer C client cannot access Consumer A merchant.

## Expected Final State

After S1-S5:

```txt
Consumer A credentials can access only Consumer A merchants.
Consumer B credentials can access only Consumer B merchants.
Consumer C credentials can access only Consumer C merchant(s).
```

Direct REST API and SDK integrations must use the same service authentication and authorization model.

Before finishing, run:

```bash
pnpm type-check
pnpm test
```

If migrations are required, generate them using the existing Drizzle workflow and commit them with the code changes.
