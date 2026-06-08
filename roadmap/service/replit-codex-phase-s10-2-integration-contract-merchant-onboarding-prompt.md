# Replit/Codex Prompt - Phase S10.2 Integration Contract & Merchant Onboarding Guide

You are working in the `northflow-payment-orchestration` repository.

This phase implements:

```txt
S10.2 - Integration Contract & Merchant Onboarding Guide
```

## Current status

S10 and S10.1 are complete and clean:

```txt
core type-check       CLEAN
client-sdk type-check CLEAN
service type-check    CLEAN
pnpm test             passing
```

S10 created the admin CLI/bootstrap runtime.
S10.1 removed confusing `Standalone*` naming from active code and restored clean core/sdk/service behavior.

Now the next priority is to make integration into external merchant/consumer backends precise, safe, documented, testable, and hard to misuse.

This phase is primarily contract/documentation/test hardening, not a new payment feature phase.

---

# Northflow-only rule

Keep this phase generic and Northflow-only.

Do not mention named external consumer projects anywhere in generated code comments, docs, tests, examples, validation reports, sample env files, or roadmap text.

Use generic terms only:

```txt
merchant application
merchant backend
consumer backend
REST consumer
SDK consumer
external integrator
checkout backend
POS backend
billing backend
merchant
API client
provider account
payment method
```

Provider names are allowed only when referring to actual provider adapters/provider codes.

---

# Main goal

Create a complete integration guide and contract verification layer for merchant applications.

A merchant/consumer backend must be able to understand exactly how to integrate with Northflow via:

```txt
1. Client SDK
2. Direct REST API
```

The guide must explain:

```txt
who calls Northflow
which secrets live where
how onboarding works
how API client/merchant/provider setup works
how checkout/payment runtime works
how payment options work
how status polling works
how refund/void works
how idempotency works
how signed requests work
what not to do
```

The phase must not introduce a dashboard.
The phase must not introduce merchant outbound webhooks yet.
The phase must not alter payment runtime behavior unless a documented SDK/REST contract mismatch is found and fixed.

---

# Critical integration principle

Northflow credentials must be used by server-side merchant/consumer backends only.

Allowed:

```txt
Browser/mobile/POS frontend -> merchant backend -> Northflow
```

Not allowed:

```txt
Browser/mobile/POS frontend -> Northflow directly with API key/signing secret
```

Document this clearly.

The API key, raw signing secret, service token, provider credentials, database URL, and webhook secrets must never be placed in browser/mobile/frontend/public env.

---

# Scope

## In scope

```txt
merchant integration guide
SDK quickstart
REST quickstart
sample env template
merchant onboarding CLI flow
payment lifecycle sequence
payment method/options guide
status polling guide
refund/void guide
idempotency guide
signed request guide
security checklist
contract parity verification tests
route/method parity audit
validation report
roadmap update
```

## Out of scope

```txt
management dashboard UI
merchant outbound webhook/callback delivery
new provider integration
new database schema unless absolutely required for docs/tests
changing provider codes
changing route URLs unless fixing a proven SDK mismatch
changing payment status semantics
changing HMAC canonical format
mTLS/private network
front-end integration package
```

If a mismatch is discovered between SDK and service routes, fix it only if it is clearly wrong and document the fix in the validation report.

---

# Part A - Documentation deliverables

Create a new integration docs folder if it does not exist:

```txt
docs/integration/
```

Create these files:

```txt
docs/integration/merchant-integration-guide.md
docs/integration/sdk-quickstart.md
docs/integration/rest-quickstart.md
docs/integration/env-template.md
docs/integration/payment-lifecycle.md
docs/integration/idempotency-guide.md
docs/integration/payment-method-options.md
docs/integration/status-polling.md
docs/integration/refund-void.md
docs/integration/security-checklist.md
```

If the repository already has equivalent docs, update them instead of duplicating.

## A1. `merchant-integration-guide.md`

Must explain the full integration model:

```txt
merchant frontend -> merchant backend -> Northflow -> provider
```

Include sections:

```txt
purpose
integration roles
runtime architecture
backend-only secret rule
merchantId vs API client vs sourceApp vs externalPayableId
onboarding objects
admin CLI bootstrap sequence
SDK integration path
REST integration path
payment lifecycle
idempotency
payment options
status polling
refund/void
error handling
signed requests
production checklist
common mistakes
```

Use simple diagrams in fenced text blocks.

## A2. `sdk-quickstart.md`

Must include TypeScript examples for merchant backend usage:

```ts
import { PaymentOrchestrationClient } from "@northflow/payment-orchestration-client-sdk";
```

Include:

```txt
install/import
client setup with baseUrl/apiKey/merchantId/sourceApp
optional signing config
create payment intent
get payment options
create gateway payment
poll status
refund transaction
void transaction
error handling with PaymentOrchestrationClientError
idempotency key examples
```

Examples must be backend-only and must not imply browser usage.

## A3. `rest-quickstart.md`

Must include cURL examples for direct REST integration:

```txt
create payment intent
get payment options
create gateway payment
get intent status
get refundability
refund payment transaction
void payment transaction
```

Include required headers:

```txt
Authorization: Bearer <NORTHFLOW_API_KEY>
x-payment-merchant-id: <merchantId>
x-source-app: <sourceApp>
Content-Type: application/json
```

If signed requests are supported, include a separate explanation that signed headers are optional/required depending on service config.

Do not expose real secrets.

## A4. `env-template.md`

Must provide a safe merchant backend env template:

```env
NORTHFLOW_BASE_URL=https://your-northflow-service.example.com
NORTHFLOW_API_KEY=nf.<env>.<credentialId>.<secret>
NORTHFLOW_MERCHANT_ID=mer_xxx
NORTHFLOW_SOURCE_APP=checkout-backend

# Optional signed requests
NORTHFLOW_CLIENT_ID=client_xxx
NORTHFLOW_SIGNING_KEY_ID=sk_xxx
NORTHFLOW_SIGNING_SECRET=copy-once-secret
```

Must include warning:

```txt
Never use NEXT_PUBLIC_, VITE_, EXPO_PUBLIC_, or frontend/public env prefixes for secrets.
```

## A5. `payment-lifecycle.md`

Must include sequence from order creation to paid status:

```txt
1. Create local order/invoice/booking in merchant app
2. Create payment intent in Northflow
3. Read payment options
4. Create payment transaction/gateway payment
5. Show QR/payment URL/VA/instructions to customer
6. Provider webhook updates Northflow
7. Merchant backend polls Northflow status
8. Merchant app marks payable paid/failed/expired
```

Include status mapping examples:

```txt
Northflow pending -> local awaiting_payment
Northflow paid -> local paid
Northflow failed -> local payment_failed
Northflow expired -> local payment_expired
Northflow refunded/partially_refunded -> local refund state
```

Do not invent unsupported statuses. Check current core domain statuses first.

## A6. `idempotency-guide.md`

Must explain idempotency key strategy.

Include examples:

```txt
intent creation: order:<orderId>:intent
payment creation: order:<orderId>:payment:<method>
refund: refund:<transactionId>:<amount>
void: void:<transactionId>
```

Explain:

```txt
why idempotency prevents duplicate provider calls
when to reuse the same key
when to create a new key
what not to include in idempotency keys
retry behavior
```

## A7. `payment-method-options.md`

Must explain:

```txt
provider account method is not a global catalog
methods are enabled per merchant/provider account
payment options are filtered by merchant, provider account, currency, amount, and status
merchant frontend should display options returned by Northflow, not hardcode unsupported methods
```

Use current method types:

```txt
qris
virtual_account
ewallet
card
retail_outlet
manual
other
```

Do not use old invalid names like `bank_transfer` or `qr_code` unless explicitly described as old names not to use.

## A8. `status-polling.md`

Must explain current polling model:

```txt
merchant backend polls Northflow intent status
frontend polls merchant backend, not Northflow directly
```

Include recommended polling guidance:

```txt
poll short interval immediately after payment creation
back off after several attempts
stop when terminal
never poll from frontend directly using Northflow credentials
```

Clarify that merchant outbound webhook/callback is future phase and not part of S10.2.

## A9. `refund-void.md`

Must explain:

```txt
refund vs void/cancel
which transaction IDs are used
refundability check
idempotency for refund/void
provider support may vary
manual provider behavior
fake_gateway dev/test behavior
```

Do not claim all providers support all operations.

## A10. `security-checklist.md`

Must include:

```txt
backend-only API key
backend-only signing secret
no public env prefixes
TLS required
no provider secret in client app
use merchant access grants
use idempotency keys
log request ids but not secrets
handle 401/403/429/5xx separately
rotate credentials/signing keys
use least privilege scopes
```

---

# Part B - SDK/REST contract audit

Audit the SDK against current service routes.

Check:

```txt
packages/client-sdk/src/client.ts
packages/client-sdk/src/types.ts
apps/service/src/routes
apps/service/src/http
apps/service/src/server.ts
```

Confirm SDK methods call correct routes and response shapes.

At minimum verify these concepts:

```txt
createPaymentIntent
getPaymentIntentStatus
getRefundability
createGatewayPayment
refreshProviderStatus
getPaymentOptions
refundPaymentTransaction / refundTransaction alias if applicable
voidPaymentTransaction / voidTransaction alias if applicable
reconcilePaymentIntentTotals
createMerchant
getMerchant if supported by service
createProviderAccount
getProviderAccount if supported by service
listProviderAccountMethods
upsertProviderAccountMethod
deleteProviderAccountMethod
syncProviderAccountMethods
createSigningKey
listSigningKeys
rotateSigningKey
revokeSigningKey
confirmFakeGatewayPayment
getReadiness
```

If the SDK has names that differ from service route semantics, keep backward-compatible aliases where needed and document official names.

Example:

```txt
Official: refundPaymentTransaction
Deprecated alias: refundTransaction
```

Only add aliases if needed for compatibility and type-check stability.

Do not break existing SDK consumers.

---

# Part C - Integration smoke tests

Add tests that prove the public SDK/REST integration contract remains stable.

Recommended test files:

```txt
tests/s10-2-sdk-integration-contract.test.ts
tests/s10-2-rest-contract-docs.test.ts
```

If the existing test structure prefers package-local tests, follow it.

Required test coverage:

```txt
SDK exposes official integration methods
SDK backward-compatible aliases still work if kept
SDK injects merchantId into request body when config merchantId exists
SDK does not require request interfaces to have Record<string, unknown> index signatures
SDK error class supports current object-style and/or positional constructor usage if both are supported
SDK signed request headers are built with core canonical helpers
SDK does not expose provider credentials
method types match qris/virtual_account/ewallet/card/retail_outlet/manual/other
integration docs mention backend-only secret handling
integration docs do not mention named external consumer projects
REST quickstart includes required auth/merchant/sourceApp headers
merchant outbound webhook is documented as future, not current
```

Tests should be pragmatic and not brittle.

Do not require a real provider or real database for S10.2 tests unless existing test harness already provides it.

---

# Part D - Sample integration artifacts

Create sample files if appropriate:

```txt
examples/merchant-backend/README.md
examples/merchant-backend/sdk-checkout-flow.ts
examples/merchant-backend/rest-checkout-flow.md
examples/merchant-backend/.env.example
```

Rules:

```txt
examples must be backend-only
examples must not include real secrets
examples must not mention named external projects
examples must not require new runtime dependencies unless justified
examples should compile if TypeScript example tests are included
```

If examples folder exists, place files consistently with existing structure.

---

# Part E - Update roadmap

Update:

```txt
roadmap/service/main.md
```

Add S10.2 section:

```txt
S10.2 — Integration Contract & Merchant Onboarding Guide
```

Mark as completed only after docs/tests/type-check pass.

Do not mark future phases complete.

Also update any service roadmap index if one exists.

---

# Part F - Validation report

Create:

```txt
.agents/memory/s10-2-integration-contract-merchant-onboarding-validation.md
```

The report must include:

```txt
timestamp
git commit checked
files changed
SDK/REST route parity findings
SDK methods verified
REST docs created
integration docs created
examples created/skipped with reason
commands run
type-check results
test results
known failures
security checklist result
Northflow-only search result
named external consumer project search result
remaining issues
```

Do not claim a command passed unless it was actually run.

---

# Required commands

Run and document:

```bash
pnpm --filter @northflow/payment-orchestration-core type-check
pnpm --filter @northflow/payment-orchestration-client-sdk type-check
pnpm --filter @northflow/payment-orchestration-service type-check
pnpm --filter @northflow/payment-orchestration-service test
pnpm test
```

Also run grep checks:

```bash
grep -R "NEXT_PUBLIC_.*NORTHFLOW\|VITE_.*NORTHFLOW\|EXPO_PUBLIC_.*NORTHFLOW" docs examples packages apps tests -n || true

grep -R "bank_transfer\|qr_code" docs/integration examples packages/client-sdk apps/service tests -n || true

grep -R "merchant outbound webhook is implemented\|callback delivery is implemented" docs/integration examples -n || true
```

Expected:

```txt
No docs/examples instruct secrets to use public frontend env prefixes.
No current docs/examples use invalid method types as recommended values.
No docs claim merchant outbound webhook is implemented in S10.2.
```

---

# Acceptance criteria

S10.2 is complete only when:

```txt
merchant integration guide exists
SDK quickstart exists
REST quickstart exists
env template exists
payment lifecycle docs exist
idempotency guide exists
payment method options docs exist
status polling docs exist
refund/void docs exist
security checklist exists
SDK/REST contract parity is audited
SDK method names are documented clearly
integration smoke tests exist and pass
roadmap updated
validation report exists
no named external consumer project references introduced
no dashboard implementation introduced
no merchant outbound webhook implementation introduced
core/client-sdk/service type-check pass
pnpm test passes or failures are honestly documented
```

Commit and push all changes.
