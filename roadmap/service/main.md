# Northflow Payment Orchestration — Service Roadmap

This is the canonical roadmap for the Northflow Payment Orchestration service layer.

This file is **not** a Replit/Codex prompt. Execution prompts must be stored separately under `roadmap/service/`.

## Current Focus

The service roadmap focuses on:

- Service API security.
- Client integration isolation.
- Multi-app caller identity.
- Merchant ownership enforcement.
- Scope-based authorization.
- SDK and direct REST API parity.
- Payment method discovery/options.
- Service audit logging.
- Credential lifecycle hardening.
- Rate limit and abuse protection.

Out of scope for the current service-security work:

- Dashboard management UI.
- Dashboard authentication and RBAC.
- Public provider webhook hardening.
- Provider expansion unrelated to service auth/integration tests.

## Consumer Integration Model

Northflow is a central payment orchestration service used by backend applications.

Target consumers:

- Consumer A — multi-tenant POS, direct REST API integration.
- Consumer B — multi-tenant transport/booking system, SDK integration.
- Consumer C — payment/OTC application, direct REST API integration.

```txt
Consumer A backend  ───────┐
Consumer B backend ───────┼──> Northflow Payment Orchestration
Consumer C backend ───────┘
```

Frontend clients, tenant users, cashier terminals, and customers must not call the internal service API directly. Consumer backends call Northflow on behalf of their own business tenants/orders/bookings/payment flows.

## Identity Model

Northflow separates caller identity from payment ownership.

```txt
API Client        = consumer backend application using Northflow
ClientCredential  = API credential owned by an API client
Merchant          = business/tenant/payment owner in Northflow
ProviderAccount   = payment provider account for a merchant
PaymentMethod     = provider method enabled for a merchant provider account
PaymentIntent     = payable object/invoice/order/booking amount to collect
Transaction       = payment/refund/void attempt or resulting operation
AuditLog          = immutable service activity trail
```

Rule:

```txt
1 consumer application environment = 1 API client identity
1 API client may have multiple credentials for rotation
1 tenant/business/payment owner    = 1 merchant in Northflow
```

Examples:

```txt
API Client: client_consumer-a_prod
Merchant:   mer_cafe_mawar

API Client: client_consumer-b_prod
Merchant:   mer_nusa_shuttle

API Client: client_consumer-c_prod
Merchant:   mer_consumer-c
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
  credential rotation
  rate limit and abuse protection
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
api_client:credential:create
api_client:credential:read
api_client:credential:revoke
api_client:credential:rotate
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

## Key Decisions

```txt
API Client = consumer backend application
Merchant   = business/tenant/payment owner
```

Official `sourceApp` values:

```txt
consumer-a
consumer-b
consumer-c
internal
```

## Acceptance Criteria

- Service security contract is documented.
- Official `sourceApp` values are documented.
- Scope list is documented.
- Global service token is marked as legacy/dev-only.
- Dashboard and webhook are explicitly out of scope.

---

# Phase S1 — API Client Registry ✅ COMPLETED

## Goal

Add persistent API client identity so Northflow can identify the consumer backend application calling the service.

## Implemented Data Model

```txt
po_api_clients
po_client_credentials
po_client_merchant_access
```

Security rules:

- Do not store plaintext API key material.
- Store only a safe prefix and a one-way hash.
- Show plaintext key material only once at creation/rotation time.
- Support active, revoked, and expired credential states.
- Support client-to-merchant access grants.

---

# Phase S2 — Replace Global Token With Client Auth ✅ COMPLETED

## Goal

Replace single global service-token authentication with per-client API key authentication.

## Authentication Contract

The service accepts per-client credentials through:

```txt
Authorization: Bearer <credential>
x-nf-api-key: <credential>
```

The service resolves:

```txt
apiKey -> credentialId -> clientId -> sourceApp -> scopes -> merchant access
```

The auth middleware attaches:

```ts
req.auth = {
  clientId: "client_consumer-a_prod",
  sourceApp: "consumer-a",
  environment: "production",
  credentialId: "...",
  scopes: [...]
}
```

Legacy global token remains compatibility mode only and is disabled by default in production.

---

# Phase S3 — Merchant Ownership Guard ✅ COMPLETED

## Goal

Prevent one consumer application from accessing another application's merchants.

## Rule

Every protected route resolving or receiving a `merchantId` must verify:

```txt
merchantId must be granted to req.auth.clientId
```

If not allowed:

```txt
403 MERCHANT_ACCESS_DENIED
```

Create-merchant rule:

- Creating a merchant requires `merchant:create`.
- The resulting merchant must be linked to the creating API client unless explicitly created by an internal/system client.
- Normal clients must not create orphan merchants without access grants.

---

# Phase S4 — SourceApp Enforcement ✅ COMPLETED

## Goal

Prevent caller spoofing by requiring payload `sourceApp` to match authenticated client `sourceApp`.

If the authenticated client source app is `consumer-a`, accepted payload source app must also be `consumer-a`.

Mismatched source app returns:

```txt
403 SOURCE_APP_MISMATCH
```

---

# Phase S5 — Scope-Based Authorization ✅ COMPLETED

## Goal

Ensure API clients can only perform allowed actions.

Initial protected route matrix:

```txt
POST /v1/merchants                                      -> merchant:create
GET  /v1/merchants/:id                                  -> merchant:read
POST /v1/merchants/:merchantId/provider-accounts        -> provider_account:create
GET  /v1/merchants/:merchantId/provider-accounts/:id    -> provider_account:read
POST /v1/payment-intents                                -> intent:create
GET  /v1/payment-intents/:id/status                     -> intent:read
GET  /v1/payment-intents/:id/refundability              -> intent:read
POST /v1/payment-intents/:id/gateway-payments           -> payment:create
POST /v1/payment-intents/:id/reconcile                  -> payment:reconcile
POST /v1/payment-transactions/:transactionId/refund     -> payment:refund
POST /v1/payment-transactions/:transactionId/void       -> payment:void
```

Scope rejection returns:

```txt
403 SCOPE_DENIED
```

---

# Phase S6 — Client Integration Contract ✅ COMPLETED

## Goal

Make direct REST API and SDK integrations use the same service contract.

REST consumers:

- Consumer A.
- Consumer C.

SDK consumer:

- Consumer B.

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
- Preserve structured service error codes.

---

# Phase S7 — Integration Smoke Tests ✅ COMPLETED

## Goal

Prove multi-app integration works and isolation does not leak.

Tested flows:

```txt
Consumer A REST positive flow
Consumer B SDK positive flow
Consumer C REST positive flow
cross-app merchant denial
sourceApp spoofing denial
missing-scope denial
REST vs SDK parity
```

---

# Phase S7.5 — Payment Method Options ✅ COMPLETED

## Goal

Allow API clients to discover which payment methods are available for a merchant/provider account, and validate that a selected payment method is enabled before creating a gateway payment.

Payment methods originate from provider capabilities. Northflow stores enabled/allowed methods for each merchant provider account and consumer apps must request payment options instead of hard-coding provider method availability.

## Implemented Data Model

```txt
po_provider_account_methods
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

## Gateway Payment Validation

When creating a gateway payment with `providerAccountId`, the requested method must exist in `po_provider_account_methods`, must be active, must support the intent currency, and must satisfy configured min/max amount.

If no methods are configured for the provider account, the service fails closed:

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

---

# Phase S8 — Service Audit Log ✅ COMPLETED

## Goal

Create an immutable audit trail for service API activity.

## Implemented Data Model

```txt
po_audit_logs
```

Core audit fields:

```txt
request_id
client_id
source_app
merchant_id
actor_type
action
resource_type
resource_id
status
http_method
path
status_code
error_code
ip_address
user_agent
metadata
created_at
```

Audited action families:

```txt
merchant.*
provider_account.*
payment_method.*
payment_options.read
payment_intent.*
gateway_payment.create
payment.refund
payment.void
payment.reconcile
provider_event.reprocess
audit_log.read
```

Read endpoint:

```txt
GET /v1/audit-logs -> audit_log:read
```

Security rules:

- Never store API keys, authorization headers, raw secrets, provider credentials, full request bodies, or raw provider responses.
- Audit writes are best-effort and non-fatal.
- Audit logs are immutable; no business update/delete path should exist.

---

# Phase S9 — Service Protection Hardening

## S9.1 — API Key Rotation and Credential Lifecycle ✅ COMPLETED

## Goal

Allow API clients to maintain multiple credentials safely so keys can be rotated without downtime.

## Implemented Routes

```txt
POST /v1/api-clients/:clientId/credentials
  requires: api_client:credential:create

GET /v1/api-clients/:clientId/credentials
  requires: api_client:credential:read

POST /v1/api-clients/:clientId/credentials/rotate
  requires: api_client:credential:rotate

POST /v1/api-clients/:clientId/credentials/:credentialId/revoke
  requires: api_client:credential:revoke
```

## Security Invariants

```txt
- rawCredential is shown exactly once in create/rotate responses.
- credentialHash is never returned in API responses.
- plaintext credential is never stored.
- audit metadata never includes rawCredential, credentialHash, Authorization header, or x-nf-api-key.
- revocation is immediate, irreversible, and idempotent.
- normal clients may manage only their own clientId.
- internal/legacy clients may manage any clientId where explicitly scoped.
- rotation creates a new active key and may revoke one specified old key.
- rotation never bulk-revokes all credentials.
- lastUsedAt updates on successful auth.
```

## Implemented Use Cases

```txt
CreateCredential
ListCredentials
RevokeCredential
RotateCredential
```

## Docs

```txt
docs/security/api-key-rotation.md
```

---

## S9.2 — Rate Limit and Abuse Protection ✅ COMPLETED

## Goal

Protect the service against abusive or accidental high-volume traffic.

## Implementation

```txt
RateLimiterStore interface
InMemoryRateLimiterStore fixed-window implementation
createRateLimitMiddleware after auth on /v1 routes
auth failure rate limiting in auth middleware
RATE_LIMITED error code -> 429
```

## Rate Limit Buckets

```txt
client:{clientId}:global
client:{clientId}:route:{method}:{routeGroup}
ip:{ip}:auth_fail
credential_prefix:{prefix}:auth_fail
```

The prefix bucket is counted without revealing whether the prefix exists.

## Response Headers

```txt
X-RateLimit-Limit
X-RateLimit-Remaining
X-RateLimit-Reset
Retry-After
```

## Configuration

```txt
PAYMENT_ORCHESTRATION_RATE_LIMIT_ENABLED
PAYMENT_ORCHESTRATION_RATE_LIMIT_CLIENT_GLOBAL_PER_MINUTE
PAYMENT_ORCHESTRATION_RATE_LIMIT_CLIENT_ROUTE_PER_MINUTE
PAYMENT_ORCHESTRATION_RATE_LIMIT_AUTH_FAILURE_PER_MINUTE
```

## Docs

```txt
docs/security/rate-limits.md
```

## Future Subphase

```txt
S9.2.1 — RedisRateLimiterStore / distributed rate limit
```

This is a future scale-out enhancement. The current implementation is in-memory/per-process.

---

## S9.3 — Network-Level Service Protection ✅ COMPLETED

### Implemented

**Part A — Documentation**
- `docs/security/network-protection.md`: subdomain layout, Cloudflare/reverse proxy model, origin firewall checklist, CORS policy, health/readiness exposure policy, request size and security headers policy, full deployment checklist.

**Part B — App-Level HTTP Hardening**

```txt
B1: app.disable('x-powered-by')               → X-Powered-By absent from all responses
B2: securityHeaders middleware                 → X-Content-Type-Options, X-Frame-Options,
                                                 Referrer-Policy, Cache-Control, CORP
B3: createCorsMiddleware()                     → CORS disabled by default; no wildcard; no reflection
B4: trust proxy configurable via env           → disabled by default
B5: JSON body limit env-configurable           → default 256kb; webhooks unaffected
B6: structured 404 for unknown paths           → { ok:false, error: { code: 'NOT_FOUND' } }
B7: /ready token protection                    → x-nf-ready-token header if PAYMENT_ORCHESTRATION_READY_TOKEN set
```

**Part C — New env vars**

```txt
PAYMENT_ORCHESTRATION_CORS_ENABLED=false
PAYMENT_ORCHESTRATION_CORS_ALLOWED_ORIGINS=https://console.northflow.space,...
PAYMENT_ORCHESTRATION_TRUST_PROXY=false   (or loopback/uniquelocal/true)
PAYMENT_ORCHESTRATION_JSON_BODY_LIMIT=256kb
PAYMENT_ORCHESTRATION_READY_TOKEN=<secret>
```

**New files**
```txt
apps/service/src/middleware/securityHeaders.ts
apps/service/src/middleware/cors.ts
```

### Tests: 36/36 pass (6 unit / config + 30 HTTP integration)

### Full suite: 422/422 pass (no regressions against S1-S9.2)

### Docs: docs/security/network-protection.md

---

## S9.4 — Signed Requests / HMAC ✅ COMPLETED

## Goal

Upgrade from bearer-style API key auth to signed requests to reduce replay/tamper risk.

## Implemented Data Model

```txt
po_client_signing_keys
po_request_nonces
```

## Implemented Routes

```txt
POST /v1/api-clients/:clientId/signing-keys
  requires: api_client:signing_key:create
  returns: rawSigningSecret ONCE

GET /v1/api-clients/:clientId/signing-keys
  requires: api_client:signing_key:read
  returns: safe view (no secrets)

POST /v1/api-clients/:clientId/signing-keys/rotate
  requires: api_client:signing_key:rotate

POST /v1/api-clients/:clientId/signing-keys/:keyId/revoke
  requires: api_client:signing_key:revoke
```

## Added Authorization Scopes

```txt
api_client:signing_key:create
api_client:signing_key:read
api_client:signing_key:rotate
api_client:signing_key:revoke
```

## Signing Protocol

```txt
algorithm:   NF-HMAC-SHA256-V1
canonical:   ALGORITHM\ntimestampMs\nnonce\nMETHOD\npath\ncanonical_query\nbody_sha256_hex
signature:   HMAC-SHA256(rawSigningSecret, canonicalString) as lowercase hex
```

## Security Invariants

```txt
- rawSigningSecret shown exactly once (on create/rotate).
- Signing secrets stored AES-256-GCM encrypted.
- Encryption key must be exactly 32 bytes — no silent padding or truncation.
- Signed headers never fall back to bearer auth on failure.
- Nonces consumed atomically via DB unique constraint.
- Revoked/expired keys rejected immediately.
- Signed request failures count toward IP auth-failure rate limit.
```

## Mode Configuration

```txt
PAYMENT_ORCHESTRATION_SIGNED_REQUESTS_MODE=required  (default in production)
PAYMENT_ORCHESTRATION_SIGNED_REQUESTS_MODE=optional  (default in non-production)
```

## Client SDK

The `@northflow/payment-orchestration-client-sdk` signs requests automatically when `signing` config is provided. Canonical string and HMAC computation are shared from `@northflow/payment-orchestration-core`.

## Docs

```txt
docs/security/signed-requests-hmac.md
```

---

## S9.5 — mTLS / Private Network

Advanced future options:

```txt
mTLS between consumer backends and Northflow
private service network
VPN/Tailscale/internal gateway
API gateway in front of Northflow
Cloudflare mTLS / Zero Trust integration
```

---

# Execution Priority

Completed service phases:

```txt
S1 -> S2 -> S3 -> S4 -> S5 -> S6 -> S7 -> S7.5 -> S8 -> S9.1 -> S9.2 -> S9.3 -> S9.4
```

Next recommended service protection phases:

```txt
S9.5
```

Practical production minimum (all complete):

```txt
S9.1 API key rotation          ✅
S9.2 rate limit                ✅
S9.3 network-level protection  ✅
S9.4 signed requests / HMAC    ✅
```
