# Northflow Payment Orchestration — Service Roadmap

This is the canonical roadmap for the Northflow Payment Orchestration service layer.

This file is **not** a Replit/Codex prompt. Execution prompts must be stored separately under `roadmap/service/`.

## Current Focus

The current roadmap focuses on:

- Service API security.
- Client integration isolation.
- Multi-app caller identity.
- Merchant ownership enforcement.
- Scope-based authorization.
- SDK and direct REST API parity.

Out of scope for the current service-security work:

- Dashboard management UI.
- Dashboard authentication and RBAC.
- Public provider webhook hardening.
- Provider expansion unrelated to service auth/integration tests.

## Consumer Integration Model

Northflow is a central payment orchestration service used by backend applications.

Target consumers:

- AuraPoS — multi-tenant POS, direct REST API integration.
- Transity — multi-tenant transport/booking system, SDK integration.
- Kioskoin — payment/OTC application, direct REST API integration.

Runtime model:

```txt
AuraPoS backend  ───────┐
Transity backend ───────┼──> Northflow Payment Orchestration
Kioskoin backend ───────┘
```

Frontend clients, tenant users, cashier terminals, and customers must not call the internal service API directly. Consumer backends call Northflow on behalf of their own business tenants/orders/bookings/payment flows.

## Identity Model

Northflow separates caller identity from payment ownership.

```txt
API Client        = consumer backend application using Northflow
Merchant          = business/tenant/payment owner in Northflow
ProviderAccount   = payment provider account for a merchant
PaymentIntent     = payable object/invoice/order/booking amount to collect
Transaction       = payment/refund/void attempt or resulting operation
```

Examples:

```txt
API Client: client_aurapos_prod
Merchant:   mer_cafe_mawar

API Client: client_transity_prod
Merchant:   mer_nusa_shuttle

API Client: client_kioskoin_prod
Merchant:   mer_kioskoin
```

Rule:

```txt
1 consumer application environment = 1 API client credential
1 tenant/business/payment owner    = 1 merchant in Northflow
```

## Current Security Problem

The current baseline uses a single global service token header for protected API routes. This is acceptable for early development but not for production multi-app usage.

Problem:

```txt
If AuraPoS, Transity, and Kioskoin share the same service token,
that token can access every merchant unless the service adds client-level isolation.
```

Required direction:

```txt
FROM:
  one global service token

TO:
  per-client API identity
  per-client API keys
  merchant access control
  action scopes
  sourceApp enforcement
  SDK/direct REST compatibility
```

## Roadmap File Naming Convention

Main roadmap:

```txt
roadmap/service/main.md
```

Sequential phase execution prompt:

```txt
roadmap/service/replit-codex-phase-s1-5-[case-name]-prompt.md
```

Non-sequential or grouped phase execution prompt:

```txt
roadmap/service/replit-codex-phase-s1-s2-s5-[case-name]-prompt.md
```

Prompt files must be written in English and must include explicit implementation rules, constraints, acceptance criteria, and test expectations.

---

# Phase S0 — Service Security Baseline Contract

## Goal

Freeze the service security model before implementation changes.

## Work Items

Define official identity semantics:

```txt
API Client = consumer backend application
Merchant   = business/tenant/payment owner
```

Define official `sourceApp` values:

```txt
aurapos
transity
kioskoin
internal
```

Define initial authorization scopes:

```txt
merchant:create
merchant:read
provider_account:create
provider_account:read
intent:create
intent:read
payment:create
payment:read
payment:refund
payment:void
payment:reconcile
provider_event:reprocess
```

Define legacy token policy:

```txt
PAYMENT_ORCHESTRATION_LEGACY_SERVICE_TOKEN_ENABLED=false
```

Production default must be `false`.

## Acceptance Criteria

- Service security contract is documented.
- Official `sourceApp` values are documented.
- Scope list is documented.
- Global service token is marked as legacy/dev-only.
- Dashboard and webhook are explicitly out of scope.

---

# Phase S1 — API Client Registry

## Goal

Add persistent API client identity so Northflow can identify the consumer backend application calling the service.

## Required Data Model

Add persistent models for:

- API clients.
- API client keys.
- Client-to-merchant access grants.

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

Required API key fields:

```txt
id
client_id
key_prefix
secret_hash
status
expires_at
last_used_at
created_at
revoked_at
```

Required merchant access fields:

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

- Do not store plaintext API key material.
- Store only a safe prefix and a one-way hash.
- Show plaintext key material only once at creation time.
- Support active, revoked, and expired states.

## Acceptance Criteria

- API client table exists.
- API key table exists.
- Client merchant access table exists.
- Repository interfaces and Drizzle implementations exist.
- Tests cover active, revoked, and expired keys.
- Tests cover client-to-merchant access lookup.

---

# Phase S2 — Replace Global Token With Client Auth

## Goal

Replace single global service-token authentication with per-client API key authentication.

## Authentication Contract

The service must accept a per-client API key through a standard auth header or a dedicated Northflow API key header.

The service must resolve:

```txt
apiKey -> keyId -> clientId -> sourceApp -> scopes -> merchant access
```

The auth middleware must attach request auth context:

```ts
req.auth = {
  clientId: "client_aurapos_prod",
  sourceApp: "aurapos",
  environment: "production",
  scopes: [...],
  allowedMerchantIds: [...]
}
```

## Legacy Token Compatibility

The existing global service-token middleware must become compatibility mode only.

Production default:

```txt
PAYMENT_ORCHESTRATION_LEGACY_SERVICE_TOKEN_ENABLED=false
```

If compatibility mode is disabled, the old service-token header must not authorize protected routes.

## Acceptance Criteria

- Request without API key returns 401.
- Invalid API key returns 401.
- Revoked API key returns 401.
- Expired API key returns 401.
- Valid API key attaches `req.auth`.
- Global service token is disabled by default in production.
- Error envelope remains compatible with the existing API error contract.

---

# Phase S3 — Merchant Ownership Guard

## Goal

Prevent one consumer application from accessing another application's merchants.

## Rule

Every route resolving or receiving a `merchantId` must check:

```txt
merchantId must be allowed for req.auth.clientId
```

If not allowed, return:

```txt
403 MERCHANT_ACCESS_DENIED
```

## Protected Route Families

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

Special create-merchant rule:

- Creating a merchant requires `merchant:create`.
- The resulting merchant must be linked to the creating API client unless explicitly created by an internal/system client.

## Acceptance Criteria

- `client_aurapos_prod` can access AuraPoS merchants only.
- `client_transity_prod` can access Transity merchants only.
- `client_kioskoin_prod` can access Kioskoin merchants only.
- Cross-merchant access returns `403 MERCHANT_ACCESS_DENIED`.
- Existing merchant-scoped idempotency behavior still works.

---

# Phase S4 — SourceApp Enforcement

## Goal

Prevent caller spoofing by requiring payload `sourceApp` to match authenticated client `sourceApp`.

## Rule

If the authenticated client source app is `aurapos`, the accepted payload source app must also be `aurapos`.

If the request sends another source app, return:

```txt
403 SOURCE_APP_MISMATCH
```

If `sourceApp` is omitted where it is optional, the service may default it to `req.auth.sourceApp`.

## Acceptance Criteria

- Matching `sourceApp` succeeds.
- Missing `sourceApp` can be auto-filled where safe.
- Mismatched `sourceApp` returns `403 SOURCE_APP_MISMATCH`.
- `externalTenantId`, `externalOutletId`, and `externalPayableId` remain application-owned external references.

---

# Phase S5 — Scope-Based Authorization

## Goal

Ensure API clients can only perform allowed actions.

## Initial Route-Scope Matrix

```txt
POST /v1/merchants
  requires: merchant:create

GET /v1/merchants/:id
  requires: merchant:read

POST /v1/merchants/:merchantId/provider-accounts
  requires: provider_account:create

GET /v1/merchants/:merchantId/provider-accounts/:id
  requires: provider_account:read

POST /v1/payment-intents
  requires: intent:create

GET /v1/payment-intents/:id/status
  requires: intent:read

GET /v1/payment-intents/:id/refundability
  requires: intent:read

POST /v1/payment-intents/:id/gateway-payments
  requires: payment:create

POST /v1/payment-intents/:id/reconcile
  requires: payment:reconcile

POST /v1/payment-transactions/:transactionId/refund
  requires: payment:refund

POST /v1/payment-transactions/:transactionId/void
  requires: payment:void
```

## Acceptance Criteria

- Client without `payment:refund` cannot refund.
- Client without `payment:void` cannot void.
- Client without `merchant:create` cannot create merchant.
- Client without `payment:reconcile` cannot reconcile.
- Rejections use `403 SCOPE_DENIED`.

---

# Phase S6 — Client Integration Contract

## Goal

Make direct REST API and SDK integrations use the same service contract.

REST consumers:

- AuraPoS.
- Kioskoin.

SDK consumer:

- Transity.

Required request properties:

```txt
client authentication
merchantId
sourceApp
externalTenantId when applicable
externalPayableType
externalPayableId
idempotencyKey
```

SDK requirements:

- Attach client authentication automatically.
- Preserve request body parity with direct REST API.
- Expose structured errors for `UNAUTHORIZED`, `SCOPE_DENIED`, `MERCHANT_ACCESS_DENIED`, and `SOURCE_APP_MISMATCH`.

## Acceptance Criteria

- REST API and SDK generate equivalent requests.
- SDK authentication uses the same auth middleware.
- Integration documentation exists for AuraPoS, Transity, and Kioskoin.

---

# Phase S7 — Integration Smoke Tests

## Goal

Prove multi-app integration works and isolation does not leak.

## Positive Tests

```txt
AuraPoS API:
  create merchant
  create intent
  create gateway payment
  get status
  refund/void according to scope

Transity SDK:
  create merchant
  create intent
  create gateway payment
  get status

Kioskoin API:
  use existing merchant
  create intent
  create gateway payment
  get status
```

## Negative Tests

```txt
AuraPoS client accesses Transity merchant -> 403
Transity client accesses Kioskoin merchant -> 403
Kioskoin client accesses AuraPoS merchant -> 403
AuraPoS client sends sourceApp=transity -> 403
Client without refund scope calls refund -> 403
Client without void scope calls void -> 403
Revoked key calls API -> 401
Expired key calls API -> 401
```

---

# Phase S8 — Service Audit Log

## Goal

Create an immutable audit trail for service API activity.

## Required Data Model

```txt
payment_orchestration_audit_logs
- id
- request_id
- client_id
- source_app
- merchant_id
- actor_type
- action
- resource_type
- resource_id
- status
- ip_address
- user_agent
- metadata
- created_at
```

Initial `actor_type` values:

```txt
api_client
system
worker
```

Future dashboard work may add:

```txt
admin_user
```

Required audited actions:

```txt
merchant.create
provider_account.create
payment_intent.create
gateway_payment.create
payment_status.read
payment.refund
payment.void
payment.reconcile
provider_event.reprocess
```

## Acceptance Criteria

- Every protected route produces an audit log entry.
- Failed authorization attempts also produce audit logs where possible.
- Audit logs never store API keys, raw secrets, provider secrets, or authorization headers.

---

# Phase S9 — Future Service Protection Hardening

This phase is part of the service roadmap but must not block S1-S8.

## S9.1 — Signed Requests

Upgrade from bearer-style API key auth to signed requests with:

```txt
client id
key id
timestamp
nonce
request signature
```

Server checks:

```txt
timestamp within maximum skew
nonce has not been used before
signature is valid
key is active
scope is allowed
merchant access is allowed
```

Future nonce table:

```txt
payment_orchestration_request_nonces
- id
- client_id
- key_id
- nonce
- timestamp
- expires_at
```

## S9.2 — Key Rotation

Support multiple keys per client:

```txt
current key
next key
revoked key
expired key
```

Requirements:

- Generate a new key without downtime.
- Revoke old key safely.
- Track `lastUsedAt`.
- Expose only key prefix after creation.

## S9.3 — Redis / Distributed Rate Limit

Move API rate limiting to a distributed store.

Suggested keys:

```txt
api:{clientId}:{route}
api:{clientId}:{scope}
```

## S9.4 — Network-Level Service Protection

For the internal service subdomain, protect the service with:

```txt
Cloudflare proxy ON
origin firewall allows Cloudflare only
no direct public service port
block unknown paths
protect /ready and /version
disable public docs/swagger
```

## S9.5 — mTLS / Private Network

Advanced future options:

```txt
mTLS between consumer backends and Northflow
private service network
VPN/Tailscale/internal gateway
API gateway in front of Northflow
```

---

# Execution Priority

Immediate implementation priority:

```txt
S1 -> S2 -> S3 -> S4 -> S5
```

This enables safe multi-app usage:

```txt
AuraPoS credential can access only AuraPoS merchants.
Transity credential can access only Transity merchants.
Kioskoin credential can access only Kioskoin merchant(s).
```

After S1-S5, continue with:

```txt
S6 -> S7 -> S8
```

Then move to future hardening:

```txt
S9.x
```
