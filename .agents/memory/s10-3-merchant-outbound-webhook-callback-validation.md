# S10.3 Merchant Outbound Webhook / Callback Validation

- Timestamp: 2026-06-08T17:53:55Z
- Git commit checked before patch: ec292536ce6e6d5f09fec41ccc66472d78a30226

## Files changed

- apps/service/src/app.ts
- apps/service/src/application/merchant-webhooks/events.ts
- apps/service/src/application/merchant-webhooks/secret.ts
- apps/service/src/application/merchant-webhooks/signing.ts
- apps/service/src/application/merchant-webhooks/useCases.ts
- apps/service/src/application/merchant-webhooks/worker.ts
- apps/service/src/application/use-cases/ConfirmFakeGatewayPayment.ts
- apps/service/src/application/use-cases/HandleProviderWebhook.ts
- apps/service/src/application/use-cases/RefundPaymentTransaction.ts
- apps/service/src/application/use-cases/VoidPaymentTransaction.ts
- apps/service/src/config/env.ts
- apps/service/src/container.ts
- apps/service/src/infrastructure/repositories/DrizzleMerchantWebhookDeliveryRepository.ts
- apps/service/src/infrastructure/repositories/DrizzleMerchantWebhookEndpointRepository.ts
- apps/service/src/infrastructure/repositories/DrizzleMerchantWebhookEventRepository.ts
- apps/service/src/infrastructure/repositories/merchantWebhookMappers.ts
- apps/service/src/infrastructure/schema.ts
- apps/service/src/routes/merchantWebhooks.ts
- apps/service/src/workers/run.ts
- docs/integration/client-integration-contract.md
- docs/integration/merchant-outbound-webhooks.md
- docs/integration/status-polling.md
- docs/integration/webhook-signature-verification.md
- migrations/0010_po_merchant_webhooks.sql
- packages/core/src/application/repositories.ts
- packages/core/src/domain/MerchantWebhook.ts
- packages/core/src/index.ts
- tests/s10-3-merchant-outbound-webhooks.test.ts

## Migrations added

- `migrations/0010_po_merchant_webhooks.sql`
  - `po_merchant_webhook_endpoints`
  - `po_merchant_webhook_events`
  - `po_merchant_webhook_deliveries`

## Event types implemented

- `payment_intent.requires_payment`
- `payment_intent.partially_paid`
- `payment_intent.paid`
- `payment_intent.failed`
- `payment_intent.expired`
- `payment_intent.cancelled`
- `payment_intent.refunded`
- `payment_intent.voided`
- `payment_transaction.requires_action`
- `payment_transaction.succeeded`
- `payment_transaction.failed`
- `payment_transaction.cancelled`
- `payment_transaction.refunded`
- `payment_transaction.voided`

`payment_intent.overpaid` is mapped conservatively to `payment_intent.paid` because the required event list did not include an overpaid event.

## API / CLI commands added

HTTP API under authenticated merchant routes:

- `POST /v1/merchants/:merchantId/webhooks/endpoints`
- `GET /v1/merchants/:merchantId/webhooks/endpoints`
- `POST /v1/merchants/:merchantId/webhooks/endpoints/:endpointId/disable`
- `POST /v1/merchants/:merchantId/webhooks/endpoints/:endpointId/rotate-secret`
- `GET /v1/merchants/:merchantId/webhooks/deliveries`
- `POST /v1/merchants/:merchantId/webhooks/replay`

Worker operation:

- `pnpm --filter @northflow/payment-orchestration-service worker deliver-merchant-webhooks --limit 25`

## Security decisions

- Raw endpoint signing secret is returned only on create/rotate.
- Stored endpoint secret material uses the existing AES-256-GCM signing secret protector, not plaintext.
- Endpoint list and delivery list responses omit raw secret/ciphertext.
- Delivery response bodies are truncated before storage.
- Delivery occurs only from service worker/use-case code, never frontend/browser code.
- Docs explicitly say webhook secrets must remain backend-only and must not use frontend/public env vars.

## Retry policy

- Attempt 1: immediate worker tick.
- Attempt 2: +1 minute.
- Attempt 3: +5 minutes.
- Attempt 4: +15 minutes.
- Attempt 5: +1 hour.
- After configured max attempts: `dead`.

## Signature format

HMAC-SHA256 lowercase hex, version `v1`, over:

```txt
<timestamp>.<eventId>.<deliveryId>.<rawJsonBody>
```

Headers:

- `x-nf-webhook-id`
- `x-nf-webhook-delivery-id`
- `x-nf-webhook-type`
- `x-nf-webhook-timestamp`
- `x-nf-webhook-signature`
- `x-nf-webhook-signature-version: v1`

## Commands run

- `pnpm install` — succeeded, with peer/build-script warnings from pnpm.
- `pnpm --filter @northflow/payment-orchestration-service type-check` — succeeded.
- `pnpm --filter @northflow/payment-orchestration-core type-check` — succeeded.
- `pnpm --filter @northflow/payment-orchestration-client-sdk type-check` — succeeded.
- `pnpm --filter @northflow/payment-orchestration-core type-check && pnpm --filter @northflow/payment-orchestration-client-sdk type-check && pnpm --filter @northflow/payment-orchestration-service type-check` — succeeded.
- `pnpm test` — succeeded, 499 tests passing. Rerun after doc/test updates also succeeded.

## Type-check results

- Core: pass.
- Client SDK: pass.
- Service: pass.

## Test results

- Full test suite: pass (`499` tests, `0` failures) on final run.
- Added S10.3 coverage for signature determinism/verification, disabled endpoint suppression, stable envelope shape, duplicate transition dedupe, 2xx success, non-2xx retry, dead-letter state, response truncation, docs frontend-secret safety, and provider code unchanged checks.

## Provider codes unchanged confirmation

Confirmed provider registry still uses only existing provider codes: `manual`, `fake_gateway`, and `xendit_sandbox`.

## No dashboard confirmation

No dashboard UI files were modified.

## No inbound HMAC signing change confirmation

No changes were made to `packages/core/src/security/canonicalRequest.ts`; inbound S9.4 canonical request signing format remains unchanged.

## Remaining issues

- Drizzle meta snapshot/codegen was not regenerated because this repo stores SQL migrations directly and type-check/tests pass against the updated schema file.
- No real external HTTP calls are made in tests; outbound delivery tests use a mock fetch implementation.
