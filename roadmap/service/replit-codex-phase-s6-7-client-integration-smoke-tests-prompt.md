# Replit/Codex Prompt - Phase S6-S7 Client Integration Contract and Smoke Tests

You are working in the `northflow-payment-orchestration` repository.

S1-S5 service security is complete. This prompt implements the next service roadmap phases:

- S6: Client Integration Contract
- S7: Integration Smoke Tests

Do not implement dashboard work.
Do not implement provider webhook roadmap work.
Do not rewrite unrelated payment domain logic.
Do not weaken S1-S5 authentication, merchant ownership, sourceApp enforcement, or scope authorization.

---

# Context

Northflow Payment Orchestration is a central payment service used by multiple backend applications.

Target consumers:

```txt
AuraPoS   -> direct REST API consumer
Transity  -> SDK consumer
Kioskoin  -> direct REST API consumer
```

Identity model:

```txt
API Client = consumer backend application/environment
Merchant   = business/tenant/payment owner in Northflow
```

Runtime rule:

```txt
1 consumer app environment = 1 API client credential
1 tenant/business/payment owner = 1 merchant in Northflow
```

Existing S1-S5 guarantees must remain true:

```txt
AuraPoS credentials can access only AuraPoS merchants.
Transity credentials can access only Transity merchants.
Kioskoin credentials can access only Kioskoin merchants.
sourceApp cannot be spoofed.
route scopes must be enforced globally and per merchant grant.
```

---

# Phase S6 - Client Integration Contract

## Goal

Freeze and document the integration contract for direct REST API consumers and SDK consumers.

REST and SDK must call the same service behavior and produce equivalent request semantics.

## Required Deliverables

Create or update documentation under:

```txt
docs/integration/
```

Recommended files:

```txt
docs/integration/client-integration-contract.md
docs/integration/aurapos-rest-integration.md
docs/integration/transity-sdk-integration.md
docs/integration/kioskoin-rest-integration.md
```

If the repo already has integration docs, update the existing structure instead of duplicating.

---

## S6.1 - Freeze Common Request Contract

Document the required common fields for payment orchestration calls:

```txt
merchantId
sourceApp
externalTenantId when applicable
externalOutletId when applicable
externalPayableType
externalPayableId
amountDue / amount
currency
allowPartial when relevant
provider
method
providerAccountId when relevant
idempotencyKey
metadata when needed
```

Document auth headers:

```txt
Authorization: Bearer <northflow credential>
```

and supported dedicated header:

```txt
x-nf-api-key: <northflow credential>
```

Rules:

- Consumer frontends must not call the internal Northflow service API directly.
- Consumer backends call Northflow on behalf of their tenant/order/booking/payment flow.
- `sourceApp` must match the authenticated API client.
- `merchantId` must belong to the authenticated API client.
- Every create/mutate operation must use an idempotency key.
- Do not document legacy service token as the recommended integration method.

---

## S6.2 - REST API Contract

Document REST examples for AuraPoS and Kioskoin.

Required REST flows:

```txt
create merchant
create provider account
create payment intent
create gateway payment
get payment intent status
get refundability
refund transaction
void transaction
```

For AuraPoS examples, use:

```txt
sourceApp = aurapos
externalTenantId = aurapos tenant id
externalOutletId = outlet id when available
externalPayableType = pos_order
externalPayableId = order id
```

For Kioskoin examples, use:

```txt
sourceApp = kioskoin
externalPayableType = otc_order
externalPayableId = OTC order id
```

Keep examples generic. Do not include real secrets.

---

## S6.3 - SDK Contract

Inspect `packages/client-sdk`.

Update SDK if needed so it supports the S1-S5 auth model and service routes.

SDK requirements:

- accepts `baseUrl`
- accepts API credential
- attaches auth automatically using `Authorization: Bearer <credential>` by default
- optionally supports `x-nf-api-key` if the SDK design supports custom auth mode cleanly
- exposes methods for the same operations as direct REST where currently supported by the service
- does not expose legacy service-token integration as the recommended path
- returns or throws structured errors consistently

Required SDK method coverage, if missing:

```txt
merchants.create
merchants.get
providerAccounts.create
providerAccounts.get
paymentIntents.create
paymentIntents.getStatus
paymentIntents.getRefundability
paymentIntents.createGatewayPayment
paymentTransactions.refund
paymentTransactions.void
```

Use existing naming conventions if the SDK already has a different but consistent method structure.

---

## S6.4 - Error Contract

Document and test structured error handling for:

```txt
UNAUTHORIZED
MERCHANT_ACCESS_DENIED
SOURCE_APP_MISMATCH
SCOPE_DENIED
VALIDATION_ERROR
IDEMPOTENCY_CONFLICT
NOT_FOUND
```

SDK should preserve:

```txt
http status
error code
message
request id when available
raw response or details when safe
```

Do not leak credentials, provider secrets, or authorization headers in error objects/logs.

---

# Phase S7 - Integration Smoke Tests

## Goal

Prove that AuraPoS REST, Transity SDK, and Kioskoin REST integrations work with isolated credentials and merchants.

Use tests, scripts, or both. Prefer automated tests committed to the repo.

Recommended location:

```txt
tests/integration/
```

or extend the existing service integration test structure if more appropriate.

---

## S7.1 - Seed Test Clients and Merchants

Create test fixtures for:

```txt
client_aurapos_test
client_transity_test
client_kioskoin_test
```

And merchants:

```txt
mer_aurapos_cafe_test
mer_transity_shuttle_test
mer_kioskoin_main_test
```

Each client must have access only to its own merchant(s).

Suggested sourceApp mapping:

```txt
client_aurapos_test  -> sourceApp aurapos
client_transity_test -> sourceApp transity
client_kioskoin_test -> sourceApp kioskoin
```

---

## S7.2 - Positive Smoke Flows

### AuraPoS REST flow

Verify direct REST can:

```txt
create merchant
create provider account
create payment intent
create gateway payment
get status
refund or void according to granted scope
```

Use POS-specific external references:

```txt
externalTenantId
externalOutletId
externalPayableType = pos_order
externalPayableId
```

### Transity SDK flow

Verify SDK can:

```txt
create merchant
create provider account
create payment intent
create gateway payment
get status
```

Use transport/booking references:

```txt
externalTenantId
externalOutletId when relevant
externalPayableType = booking
externalPayableId
```

### Kioskoin REST flow

Verify direct REST can:

```txt
use/create Kioskoin merchant
create provider account
create payment intent
create gateway payment
get status
```

Use OTC references:

```txt
externalPayableType = otc_order
externalPayableId
```

---

## S7.3 - Negative Isolation Tests

Required tests:

```txt
AuraPoS credential tries to access Transity merchant -> 403 MERCHANT_ACCESS_DENIED
AuraPoS credential tries to access Kioskoin merchant -> 403 MERCHANT_ACCESS_DENIED
Transity credential tries to access AuraPoS merchant -> 403 MERCHANT_ACCESS_DENIED
Transity credential tries to access Kioskoin merchant -> 403 MERCHANT_ACCESS_DENIED
Kioskoin credential tries to access AuraPoS merchant -> 403 MERCHANT_ACCESS_DENIED
Kioskoin credential tries to access Transity merchant -> 403 MERCHANT_ACCESS_DENIED
```

Required sourceApp spoof tests:

```txt
AuraPoS credential sends sourceApp=transity -> 403 SOURCE_APP_MISMATCH
Transity credential sends sourceApp=kioskoin -> 403 SOURCE_APP_MISMATCH
Kioskoin credential sends sourceApp=aurapos -> 403 SOURCE_APP_MISMATCH
```

Required scope tests:

```txt
client without payment:refund tries refund -> 403 SCOPE_DENIED
client without payment:void tries void -> 403 SCOPE_DENIED
client without provider_account:create tries provider account create -> 403 SCOPE_DENIED
```

---

## S7.4 - REST vs SDK Parity

Add a parity test or documented verification that the SDK sends equivalent request body/header semantics as REST.

At minimum verify:

```txt
same auth model
same merchantId/sourceApp behavior
same idempotencyKey behavior
same error codes for auth/ownership/scope failures
```

If full network-level SDK parity is difficult, use a mocked fetch/transport test to assert outgoing request shape.

---

# Documentation Requirements

Docs must explain:

```txt
which app uses REST vs SDK
how merchant mapping is stored by consumer apps
what credentials are used by consumer backends
how idempotency keys should be generated
how sourceApp is enforced
how merchant ownership is enforced
how common error codes should be handled
```

Recommended idempotency key formats:

```txt
aurapos:<tenantId>:<orderId>:create-intent
aurapos:<tenantId>:<orderId>:gateway-payment:<method>
transity:<tenantId>:<bookingId>:create-intent
transity:<tenantId>:<bookingId>:gateway-payment:<method>
kioskoin:<orderId>:create-intent
kioskoin:<orderId>:gateway-payment:<method>
```

These are examples only; do not hard-code these formats into service logic unless a centralized helper is intentionally added.

---

# Implementation Rules

1. Do not break S1-S5 security.
2. Do not reintroduce global shared service-token as recommended integration.
3. Do not expose credentials in logs, docs, test snapshots, or fixtures.
4. Do not use real production merchant IDs, provider credentials, or API keys.
5. Keep examples fake and clearly marked.
6. Keep SDK and REST contracts aligned.
7. Preserve existing API error envelope.
8. Keep Drizzle migration state untouched unless a schema change is truly required.
9. If a schema change is required, create a new prioritized Drizzle migration; do not edit old migrations.
10. Document any pre-existing failures separately.

---

# Required Validation

Run:

```bash
pnpm type-check
pnpm test
```

If SDK package changes, also run package-specific checks if available:

```bash
pnpm --filter @northflow/payment-orchestration-client-sdk type-check
pnpm --filter @northflow/payment-orchestration-client-sdk test
```

If service integration tests require DB/provider setup and cannot run in the current environment, document what was skipped and why.

Create or update a validation report:

```txt
.agents/memory/s6-s7-client-integration-validation.md
```

Report must include:

```txt
commit checked
files changed
commands run
pass/fail/skipped results
known pre-existing failures
remaining issues
```

---

# Expected Final State

After S6-S7:

```txt
AuraPoS REST integration is documented and smoke-tested.
Transity SDK integration is documented and smoke-tested.
Kioskoin REST integration is documented and smoke-tested.
SDK and REST use the same auth and request semantics.
Cross-app merchant access is denied.
sourceApp spoofing is denied.
missing scopes are denied.
error contract is documented.
validation evidence is committed.
```

Commit and push all changes.
