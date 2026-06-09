# S10.4 — OpenAPI / SDK Contract Freeze Validation

**Branch:** `feat/s10-4-contract-freeze-release-readiness`  
**Phase:** S10.4  
**Date:** 2026-06-09

---

## Changes Made

### apps/service/src/routes/paymentMethods.ts
- **Fixed upsert response:** Changed `{ ok: true, data: serializeMethod(result.method), created: result.created }` to `{ ok: true, data: { ...serializeMethod(result.method), created: result.created } }` so the `created` flag is inside the `data` envelope and survives SDK unwrapping.

### packages/client-sdk/src/types.ts
- **Fixed `ListProviderAccountMethodsResponse`:** Was `{ data: ProviderAccountMethodResponse[] }`. Now `= ProviderAccountMethodResponse[]` (flat array, matching actual unwrapped service response).
- **Fixed `UpsertProviderAccountMethodResponse`:** Was `{ data: ProviderAccountMethodResponse; created: boolean }`. Now `extends ProviderAccountMethodResponse { created: boolean }` (flat merged shape, preserving `created`).
- **Fixed `SyncProviderAccountMethodsResponse`:** Was `{ data: { methods, syncedCount, skippedCount, message } }`. Now `{ methods, syncedCount, skippedCount, message }` (flat, matching actual unwrapped).
- **Fixed `PaymentIntentPaymentOptionsResponse`:** Was `{ data: { intentId, merchantId, currency, amountRemaining, options } }`. Now flat `{ intentId, merchantId, currency, amountRemaining, options }`.
- **Added webhook types:** `MerchantWebhookEventType`, `MerchantWebhookEndpointStatus`, `MerchantWebhookDeliveryStatus`, `MerchantWebhookEndpointResponse`, `CreateMerchantWebhookEndpointRequest`, `CreateMerchantWebhookEndpointResponse`, `ListMerchantWebhookEndpointsResponse`, `RotateMerchantWebhookEndpointSecretResponse`, `MerchantWebhookDeliveryResponse`, `ListMerchantWebhookDeliveriesResponse`, `ReplayMerchantWebhookRequest`, `ReplayMerchantWebhookResponse`.

### packages/client-sdk/src/client.ts
- **Removed `deleteProviderAccountMethod`:** No backing service route, no use case, no repo method. Contract freeze excludes unimplemented methods.
- **Added 6 webhook methods:** `createMerchantWebhookEndpoint`, `listMerchantWebhookEndpoints`, `disableMerchantWebhookEndpoint`, `rotateMerchantWebhookEndpointSecret`, `listMerchantWebhookDeliveries`, `replayMerchantWebhook`.

### packages/client-sdk/src/index.ts
- Exported all new webhook types.

### docs/openapi/payment-orchestration.openapi.json
- **Updated to v0.4.0:** Was v0.3.0 with 17 paths. Now 34 paths.
- **Added 20 missing routes:** payment methods (list/upsert/sync/merchant-list), payment options, audit logs, API client credentials (create/list/rotate/revoke), signing keys (create/list/rotate/revoke), merchant webhooks (create/list/disable/rotate-secret/deliveries/replay).
- **Fixed security declarations:** Health routes now correctly have `security: []`. All `/v1/*` routes have scoped security.
- **Added component schemas:** ProviderAccountMethod, UpsertProviderAccountMethodRequest, PaymentOptionItem, AuditLogEntry, ApiClientCredential, ApiClientCredentialCreated, SigningKey, SigningKeyCreated, WebhookEventType, WebhookEndpoint, WebhookDelivery.
- **Added response components:** Unauthorized, Forbidden, NotFound, ValidationError, RateLimited.
- **Fixed ErrorEnvelope schema:** Explicit `required: [ok, error]` with `error.code`, `error.message`, `error.details`.

### docs/payment-orchestration.openapi.json
- Synced to match `docs/openapi/payment-orchestration.openapi.json`.

### docs/security/route-scope-matrix.md *(new)*
- Authoritative route → scope table covering all 34 routes and 24 scopes.

### docs/integration/error-contract.md *(new)*
- All error codes documented: UNAUTHORIZED, SOURCE_APP_MISMATCH, SERVICE_MISCONFIGURED, SCOPE_DENIED, MERCHANT_ACCESS_DENIED, NOT_FOUND, CONFLICT, VALIDATION_ERROR, RATE_LIMITED, INTERNAL_ERROR, NOT_IMPLEMENTED, SIGNATURE_MISSING, SIGNATURE_INVALID, SIGNATURE_EXPIRED, SIGNING_KEY_NOT_FOUND.

### docs/release/v0.4.0-release-readiness.md *(new)*
- Full pre-release checklist.

### tests/s10-4-openapi-parity.test.ts *(new)*
- 11 tests asserting OpenAPI spec paths ↔ service route inventory parity.

### tests/s10-4-sdk-response-shapes.test.ts *(new)*
- 12 tests asserting SDK `{ ok, data }` unwrapping correctness for all fixed response types.

### tests/s10-2-sdk-integration-contract.test.ts
- Removed `deleteProviderAccountMethod` from required methods list.
- Added 6 webhook methods to required methods list.
- Added `deleteProviderAccountMethod` to `removed` methods assertion.

---

## Invariants Confirmed

- No route behavior changed except: upsert now embeds `created` inside `data`.
- No schema migrations.
- No new payment features added.
- No dashboard (`apps/dashboard`) changes.
- `apps/service` type-check: ✅
- `packages/core` type-check: ✅
- `packages/client-sdk` type-check: ✅
- All pre-existing tests: ✅ (500+ pass)
