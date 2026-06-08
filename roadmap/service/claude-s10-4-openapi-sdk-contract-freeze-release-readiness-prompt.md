# Claude Prompt — S10.4 OpenAPI + SDK Contract Freeze / Public Release Readiness

You are working in `northflow-payment-orchestration`.

S10.1–S10.3.1 cleaned the SDK/API contract, added merchant integration docs, implemented merchant outbound webhooks, and hardened webhook delivery claiming. This phase freezes the public REST API, SDK API, webhook event contract, and integration docs so Northflow can be prepared for deployment/public merchant-backend usage without ambiguous contracts.

## Hard Rules

- Do not add new payment features.
- Do not add dashboard UI.
- Do not add a new provider integration.
- Do not change provider codes: `manual`, `fake_gateway`, `xendit_sandbox`.
- Do not change database schema unless fixing an actual mismatch found during contract validation.
- Do not change route behavior unless fixing a proven mismatch between OpenAPI, SDK, tests, and service implementation.
- Do not change inbound HMAC canonical request signing.
- Do not change outbound merchant webhook signature format.
- Do not reintroduce legacy aliases, compatibility overloads, or old SDK call shapes.
- Do not expose API keys, provider credentials, raw webhook secrets, raw signing secrets, service tokens, or database URLs in docs examples, responses, tests, reports, or logs.
- Do not mention named external consumer projects. Use generic names only: merchant backend, checkout backend, POS backend, billing backend, SDK consumer, REST consumer, API client, merchant, provider account.

---

## Goal

Freeze and verify all current public contracts:

1. REST OpenAPI contract.
2. SDK public method contract.
3. SDK request/response TypeScript contract.
4. Merchant outbound webhook event contract.
5. Merchant outbound webhook signature contract.
6. Auth/scopes contract.
7. Error response contract.
8. Integration docs/examples parity.
9. Deployment/release readiness checklist.

This phase is primarily contract validation, documentation, tests, and small bug fixes for mismatches only.

---

## Task A — REST route inventory and OpenAPI parity

Audit the actual service routes against OpenAPI docs.

Check route files under:

```txt
apps/service/src/routes
apps/service/src/app.ts
```

Update these OpenAPI files if they exist:

```txt
docs/openapi/payment-orchestration.openapi.json
docs/payment-orchestration.openapi.json
```

The OpenAPI contract must include current routes for at least:

```txt
Health / readiness
Merchant create/read
Provider account create/read
Provider account methods list/upsert/delete/sync
Merchant payment methods list
Payment options
Payment intent create/status/refundability/reconcile
Gateway payment create
Payment transaction refresh-provider-status/refund/void
Fake gateway dev confirm
API client credentials create/list/rotate/revoke
Signing keys create/list/rotate/revoke
Audit logs read
Merchant outbound webhook endpoint create/list/disable/rotate-secret
Merchant outbound webhook deliveries list
Merchant outbound webhook replay
Provider webhook ingress routes where currently public
```

For each protected route, document:

```txt
auth requirement
required scope
merchant access requirement
request body
response body
error shape
idempotency key requirement if applicable
```

Do not invent routes. If a doc route does not exist, either remove it from OpenAPI or implement only if it is clearly intended and already backed by tests.

---

## Task B — SDK public contract freeze

Audit `packages/client-sdk/src`.

The SDK must expose only current official names.

Required confirmations:

```txt
PaymentOrchestrationClient only
PaymentOrchestrationClientError only
PaymentOrchestrationNetworkError only
PaymentOrchestrationClientConfig only
provider-account methods are merchantId-first only
refundPaymentTransaction only
voidPaymentTransaction only
apiKey + optional signing only for public merchant SDK auth
no serviceToken in public SDK config
no PaymentEngine* aliases
no Standalone* aliases
no providerAccountId-first overloads
no ID guessing helpers
```

Update SDK docs/comments if stale.

Add or update SDK contract tests that assert:

```txt
public export names
method names
provider-account method URLs
request headers
response unwrap behavior
error type behavior
signed request header behavior
```

---

## Task C — SDK TypeScript response shapes vs runtime responses

Audit SDK response types against actual service response envelopes.

The SDK request helper unwraps `{ ok: true, data }`. Therefore exported SDK method return types must represent the unwrapped data shape, not the raw service envelope, unless a method intentionally returns an inner object that itself has `data`.

Check especially:

```txt
PaymentIntentPaymentOptionsResponse
GatewayPaymentResponse
PaymentIntentStatusResponse
RefundabilityResponse
RefundPaymentTransactionResponse
VoidPaymentTransactionResponse
ProviderAccountResponse
ListProviderAccountMethodsResponse
UpsertProviderAccountMethodResponse
SyncProviderAccountMethodsResponse
CreateSigningKeyResponse
RotateSigningKeyResponse
Merchant webhook route responses if SDK methods exist or are added
```

If mismatch exists:

- fix SDK types or request unwrapping consistently
- update examples
- add tests proving the TypeScript-facing shape matches runtime mock response

Do not add new SDK methods unless needed for documented current service route coverage.

---

## Task D — Merchant outbound webhook contract freeze

Audit S10.3 webhook files:

```txt
packages/core/src/domain/MerchantWebhook.ts
apps/service/src/application/merchant-webhooks/*
apps/service/src/routes/merchantWebhooks.ts
docs/integration/merchant-outbound-webhooks.md
docs/integration/webhook-signature-verification.md
```

Freeze the event payload contract:

```json
{
  "id": "evt_xxx",
  "type": "payment_intent.paid",
  "createdAt": "2026-06-08T00:00:00.000Z",
  "merchantId": "mer_xxx",
  "resource": {
    "type": "payment_intent",
    "id": "pi_xxx"
  },
  "data": {
    "intent": {},
    "transaction": null
  }
}
```

Freeze headers:

```txt
x-nf-webhook-id
x-nf-webhook-delivery-id
x-nf-webhook-type
x-nf-webhook-timestamp
x-nf-webhook-signature
x-nf-webhook-signature-version: v1
```

Freeze signing string:

```txt
<timestamp>.<eventId>.<deliveryId>.<rawJsonBody>
```

Add/confirm tests for:

```txt
event type list stability
payload shape stability
header list stability
signature string stability
signature verification example parity
no raw secret in list responses
retry/dead state remains documented
```

---

## Task E — Auth scope contract freeze

Update canonical scope list in `roadmap/service/main.md` and current docs if missing newer scopes.

Ensure `webhook:manage` and `webhook:read` are included in the official scope list.

Build or update a route-scope matrix document, preferably:

```txt
docs/integration/route-scope-matrix.md
```

Matrix must include:

```txt
HTTP method
path
required scope
merchant access requirement
notes
```

Tests should assert that important documented scopes exist in route code and docs:

```txt
webhook:manage
webhook:read
payment_method:read
payment_method:write
payment_method:sync
api_client credential scopes
signing key scopes
payment refund/void/reconcile scopes
```

---

## Task F — Error contract freeze

Document and test common error response shape:

```json
{
  "ok": false,
  "error": {
    "code": "SCOPE_DENIED",
    "message": "Missing required scope: ...",
    "details": null
  }
}
```

Check current error helpers and middleware.

Ensure docs cover at least:

```txt
401 UNAUTHORIZED
403 SCOPE_DENIED
403 MERCHANT_ACCESS_DENIED
403 SOURCE_APP_MISMATCH
404 NOT_FOUND / resource-specific not found
409 idempotency/conflict where applicable
422 validation/business rule failures
429 RATE_LIMITED
5xx internal failures
```

Do not change business behavior unless an error response is clearly malformed or undocumented.

---

## Task G — Release readiness docs

Create or update:

```txt
docs/release/public-contract-freeze.md
docs/release/deployment-readiness-checklist.md
```

Must include:

```txt
required env vars
backend-only secret policy
API key creation/rotation
request signing optional/required modes
merchant access grants
provider account setup
payment method setup
merchant outbound webhook setup
polling fallback
rate limit expectations
readiness endpoint policy
OpenAPI file location
SDK package import name
smoke test checklist
rollback checklist
known not-yet-supported features
```

Known not-yet-supported features should be explicit if true:

```txt
dashboard UI not implemented
provider expansion beyond current providers not implemented
merchant frontend direct Northflow access not supported
```

---

## Task H — Contract tests

Add or update tests, recommended file names:

```txt
tests/s10-4-openapi-contract-freeze.test.ts
tests/s10-4-sdk-contract-freeze.test.ts
tests/s10-4-release-readiness-docs.test.ts
```

Required test coverage:

```txt
OpenAPI contains all current public routes
OpenAPI has no stale removed SDK/route names
SDK exports only official public names
SDK return types/examples use unwrapped response shapes
route-scope matrix includes webhook scopes
webhook event contract remains stable
webhook signature contract remains stable
release readiness docs exist
public docs do not expose secret/public env patterns
provider codes unchanged
no PaymentEngine* SDK aliases
no Standalone* public aliases
no providerAccountId-first SDK overload docs
```

Use pragmatic static tests where runtime test harness is heavy.

---

## Task I — Validation report

Create:

```txt
.agents/memory/s10-4-openapi-sdk-contract-freeze-release-readiness-validation.md
```

Include:

```txt
timestamp
git commit checked
files changed
OpenAPI files updated
SDK public contract confirmed
SDK response shape mismatches found/fixed
webhook contract frozen
route-scope matrix status
error contract status
release readiness docs created
commands run
type-check results
test results
known failures
provider codes unchanged confirmation
no dashboard confirmation
no DB schema change confirmation unless needed and documented
no inbound HMAC canonical change confirmation
remaining issues
```

Do not claim a command passed unless it was actually run.

---

## Required validation commands

Run and document:

```bash
pnpm --filter @northflow/payment-orchestration-core type-check
pnpm --filter @northflow/payment-orchestration-client-sdk type-check
pnpm --filter @northflow/payment-orchestration-service type-check
pnpm test
```

If the repo has OpenAPI validation/lint commands, run them too. If not, add a simple schema-valid JSON parse/static test.

---

## Acceptance criteria

S10.4 is complete only when:

```txt
OpenAPI matches current service routes
SDK public exports are strict and official only
SDK response types match runtime unwrapped shapes
Merchant webhook payload/header/signature contract is documented and tested
Route-scope matrix exists and includes webhook scopes
Error response contract is documented and tested
Release readiness docs exist
No stale removed alias/call-shape appears in current docs/examples/tests
Provider codes remain unchanged
No dashboard work introduced
No inbound HMAC canonical format changed
Core/client-sdk/service type-check pass
Full tests pass or failures are honestly documented
Validation report exists
```

Commit and push all changes.
