# Northflow Payment Orchestration — Service Roadmap

This is the canonical roadmap for the Northflow Payment Orchestration service layer.

This file is **not** a Replit/Codex prompt. Execution prompts must be stored separately under `roadmap/service/`.

## Current Focus

The current service roadmap focuses on:

- Service API security.
- Client integration isolation.
- Multi-app caller identity.
- Merchant ownership enforcement.
- Scope-based authorization.
- SDK and direct REST API parity.
- Payment method discovery/options.
- Service audit logging.

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
PaymentMethod     = provider method enabled for a merchant provider account
PaymentIntent     = payable object/invoice/order/booking amount to collect
Transaction       = payment/refund/void attempt or resulting operation
AuditLog          = immutable service activity trail
```

Rule:

```txt
1 consumer application environment = 1 API client credential
1 tenant/business/payment owner    = 1 merchant in Northflow
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

## Security Direction

The service moves from a single global service token to isolated API client credentials.

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
  payment method options controlled by Northflow
  immutable audit logs
```

## Official Authorization Scopes

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
payment_method:read
payment_method:write
payment_method:sync
audit_log:read
```

## Legacy Token Policy

```txt
PAYMENT_ORCHESTRATION_LEGACY_SERVICE_TOKEN_ENABLED=false
```

Production default must be `false`. The global service token is legacy/dev-only compatibility, not the recommended integration method.

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

Define the official scope model and legacy token policy.

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

```txt
apiKey -> keyId -> clientId -> sourceApp -> scopes -> merchant access
```

The auth middleware must attach request auth context:

```ts
req.auth = {
  clientId: "client_aurapos_prod",
  sourceApp: "aurapos",
  environment: "production",
  scopes: [...]
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

Special create-merchant rule:

- Creating a merchant requires `merchant:create`.
- The resulting merchant must be linked to the creating API client unless explicitly created by an internal/system client.
- Normal clients must not create orphan merchants without access grants.

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

# Phase S7.5 — Payment Method Options

## Goal

Allow API clients to discover which payment methods are available for a given merchant/provider account, and validate that a payment method is enabled before creating a gateway payment.

Payment methods originate from provider capabilities. Northflow stores the enabled/allowed methods for each merchant provider account and consumer apps must request payment options instead of hard-coding provider method availability.

## Required Data Model

```txt
po_provider_account_methods
- id
- merchant_id
- provider_account_id
- provider
- method
- method_type
- provider_method_code
- display_name
- status
- currency
- min_amount
- max_amount
- sort_order
- public_config
- provider_metadata
- metadata
- created_at
- updated_at
```

## Route-Scope Matrix

```txt
GET  /v1/merchants/:merchantId/provider-accounts/:providerAccountId/methods
  requires one-of: payment_method:read OR provider_account:read

PUT  /v1/merchants/:merchantId/provider-accounts/:providerAccountId/methods/:method
  requires one-of: payment_method:write OR provider_account:create

POST /v1/merchants/:merchantId/provider-accounts/:providerAccountId/methods/sync
  requires one-of: payment_method:sync OR provider_account:create

GET  /v1/merchants/:merchantId/payment-methods
  requires one-of: payment_method:read OR provider_account:read OR intent:read

GET  /v1/payment-intents/:intentId/payment-options
  requires one-of: payment_method:read OR intent:read
```

## New Scopes Added

```txt
payment_method:read   — list/discover payment methods for a merchant
payment_method:write  — create or update payment method configuration
payment_method:sync   — trigger provider-side sync of payment methods
```

## Gateway Payment Validation

When creating a gateway payment with `providerAccountId`, the requested `method` must exist in `po_provider_account_methods`, must be active, must support the intent currency, and must satisfy configured min/max amount.

If no methods are configured for the provider account, the service must fail closed:

```txt
422 PAYMENT_METHODS_NOT_CONFIGURED
```

Other validation failures:

```txt
422 PAYMENT_METHOD_NOT_AVAILABLE
422 PAYMENT_METHOD_DISABLED
422 PAYMENT_METHOD_CURRENCY_UNSUPPORTED
422 PAYMENT_METHOD_AMOUNT_OUT_OF_RANGE
```

Backward-compatible validation skip is allowed only when `methodRepo` is truly not wired in legacy/test containers. Production/service containers must wire `methodRepo` and fail closed.

## Acceptance Criteria

- `po_provider_account_methods` table exists with migration `0007_po_provider_account_methods.sql`.
- List, upsert, sync, and options endpoints work.
- Gateway payment creation validates method against configured methods and fails closed when methods are not configured.
- Tests cover list, upsert, sync, options, and gateway payment validation.
- Consumer integration docs include the `create intent -> get payment options -> create gateway payment` flow.

---

# Phase S8 — Service Audit Log

## Goal

Create an immutable audit trail for service API activity.

## Required Data Model

```txt
po_audit_logs
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
- http_method
- path
- status_code
- error_code
- ip_address
- user_agent
- metadata
- created_at
```

`actor_type` values:

```txt
api_client
legacy_client
internal
system
worker
unknown
```

`status` values:

```txt
success
failure
denied
error
```

## Audited Actions

```txt
merchant.create
merchant.read
provider_account.create
provider_account.read
payment_method.list
payment_method.upsert
payment_method.sync
payment_options.read
payment_intent.create
payment_intent.status.read
payment_intent.refundability.read
gateway_payment.create
payment.refund
payment.void
payment.reconcile
provider_event.reprocess
audit_log.read
```

## Route-Scope Matrix

```txt
GET /v1/audit-logs
  requires: audit_log:read
  note: internal/system clients only, or merchant-scoped clients with audit_log:read grant
```

## New Scopes Added

```txt
audit_log:read — list audit log entries (internal/system clients only or merchant-scoped with explicit grant)
```

## Security Rules

- Never store API keys, authorization headers, raw secrets, or provider credentials.
- Never store full request bodies.
- Never store raw provider responses.
- Metadata field must be small and safe.
- Audit writes are best-effort: write errors must not propagate to payment operation callers.
- Audit logs are immutable; no business update/delete path should exist.

## Acceptance Criteria

- `po_audit_logs` table exists with migration `0008_po_audit_logs.sql`.
- Protected route success paths produce audit log entries.
- Authorization denial attempts produce audit log entries where route context is available.
- Unexpected errors produce audit log entries where practical.
- Audit writes are best-effort and non-fatal.
- `GET /v1/audit-logs` endpoint exists with scope guard.
- Tests cover audit creation for major routes.
- Audit logs never contain secrets.

---

# Phase S9 — Service Protection Hardening

## S9.1 — API Key Rotation and Credential Lifecycle ✅ COMPLETED

Supersedes the earlier "Signed Requests" placeholder for this slot.  
Implemented zero-downtime credential rotation and full credential lifecycle management.

### Implemented

```txt
POST   /v1/api-clients/:clientId/credentials              — create (scope: api_client:credential:create)
GET    /v1/api-clients/:clientId/credentials              — list   (scope: api_client:credential:read)
POST   /v1/api-clients/:clientId/credentials/rotate       — rotate (scope: api_client:credential:rotate)
POST   /v1/api-clients/:clientId/credentials/:id/revoke   — revoke (scope: api_client:credential:revoke)
```

### Security invariants

```txt
- rawCredential shown exactly once (create/rotate response) — never stored or logged
- credentialHash never returned in any API response
- Revocation is immediate, irreversible, and idempotent
- Normal clients may only manage their own clientId (403 CREDENTIAL_NOT_OWNED otherwise)
- All lifecycle events recorded in audit log (no plaintext/hash in metadata)
- listByClientId added to ClientCredentialRepository interface
```

### New use cases

```txt
CreateCredential  — generate nf.<env>.<id>.<secret>, store prefix+hash only
ListCredentials   — return SafeCredentialView[] (no hash)
RevokeCredential  — idempotent; rejects cross-client revokes
RotateCredential  — create new + optionally revoke old (no accidental bulk revoke)
```

### Tests: 23/23 pass (13 unit + 11 HTTP integration)

### Docs: docs/security/api-key-rotation.md

---

## S9.2 — Rate Limit and Abuse Protection ✅ COMPLETED

Per-client rate limiting via `InMemoryRateLimiterStore` + auth-failure IP rate limiting.

### Implementation

```txt
RateLimiterStore interface — compatible with future RedisRateLimiterStore
InMemoryRateLimiterStore  — fixed-window, clock-aligned, pruning on hit
createRateLimitMiddleware — applied after auth on /v1 routes
Auth failure tracking     — IP bucket incremented on every 401; 429 replaces 401 at threshold
```

### Rate limit buckets

```txt
client:{clientId}:global              — 600 req/min (configurable)
client:{clientId}:route:{m}:{group}   — 120 req/min (configurable)
ip:{ip}:auth_fail                     — 30 failures/min (configurable)
credential_prefix:{prefix}:auth_fail  — same; never reveals prefix existence
```

### Response headers

```txt
X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, Retry-After (on 429)
```

### Configuration env vars

```txt
PAYMENT_ORCHESTRATION_RATE_LIMIT_ENABLED                  (default: true)
PAYMENT_ORCHESTRATION_RATE_LIMIT_CLIENT_GLOBAL_PER_MINUTE (default: 600)
PAYMENT_ORCHESTRATION_RATE_LIMIT_CLIENT_ROUTE_PER_MINUTE  (default: 120)
PAYMENT_ORCHESTRATION_RATE_LIMIT_AUTH_FAILURE_PER_MINUTE  (default: 30)
```

### Tests: 12/12 pass (4 unit + 8 HTTP integration)

### Docs: docs/security/rate-limits.md

### Full suite: 386/386 pass (no regressions against S1-S8)

---

## S9.3 — Signed Requests (Future)

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
po_request_nonces
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
S6 -> S7 -> S7.5 -> S8
```

Then move to future hardening:

```txt
S9.x
```
