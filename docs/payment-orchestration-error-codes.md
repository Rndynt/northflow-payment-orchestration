# Payment Orchestration — Public Error Codes

**Phase:** 8F — Refund, Void, and Manual Provider Parity  
**Status:** STABLE  
**Last updated:** 2026-06-05

All error responses from the standalone payment-orchestration-service use the following envelope:

```json
{
  "ok": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable description.",
    "details": null
  }
}
```

`details` may contain structured validation metadata (e.g. field names) on `VALIDATION_ERROR`; otherwise `null`.

---

## Stable Public Error Codes

### Validation

| Code | HTTP | Description |
|------|------|-------------|
| `VALIDATION_ERROR` | 400 | Request body or params failed validation. `details` may contain field-level errors. |

---

### Resource Not Found

| Code | HTTP | Description |
|------|------|-------------|
| `MERCHANT_NOT_FOUND` | 404 | No merchant with the given `merchantId` exists. |
| `INTENT_NOT_FOUND` | 404 | No payment intent with the given `id` exists for the merchant. |
| `TRANSACTION_NOT_FOUND` | 404 | No payment transaction with the given `id` exists for the merchant. |
| `PROVIDER_ACCOUNT_NOT_FOUND` | 404 | No provider account with the given `id` exists for the merchant. |

---

### Provider Account Errors

| Code | HTTP | Description |
|------|------|-------------|
| `PROVIDER_ACCOUNT_REQUIRED` | 422 | A provider account must exist for the merchant before initiating a gateway payment. |
| `PROVIDER_ACCOUNT_DISABLED` | 422 | The resolved provider account is disabled. Re-enable or use a different account. |
| `PROVIDER_ACCOUNT_PROVIDER_MISMATCH` | 422 | The requested provider does not match the provider account's configured provider. |

---

### Provider Runtime Errors

| Code | HTTP | Description |
|------|------|-------------|
| `PROVIDER_NOT_AVAILABLE` | 503 | The payment provider is not registered or not available in the current environment. |
| `PROVIDER_HTTP_CLIENT_UNCONFIGURED` | 503 | The HTTP client for the provider is not initialized (missing base URL or credentials config). |
| `PROVIDER_CREDENTIALS_UNAVAILABLE` | 503 | `credentialsRef` does not resolve to a valid secret in the current environment. |

---

### Webhook Errors

| Code | HTTP | Description |
|------|------|-------------|
| `WEBHOOK_PROVIDER_NOT_SUPPORTED` | 400 | The `:provider` path param does not have a registered webhook handler. |
| `WEBHOOK_SIGNATURE_MISSING` | 401 | Expected a signature header but it was absent. |
| `WEBHOOK_SIGNATURE_INVALID` | 401 | The provided signature does not match the computed HMAC. |
| `WEBHOOK_BODY_INVALID` | 422 | Webhook body could not be parsed or is missing required fields. |
| `WEBHOOK_SECRET_REQUIRED` | 403 | `NODE_ENV=production` requires a webhook secret but none is configured. |

---

### Payment Flow Errors

| Code | HTTP | Description |
|------|------|-------------|
| `OVERPAYMENT_REJECTED` | 422 | The payment `amount` would cause the intent total to exceed `amountDue`. |

---

### Refund Errors (Phase 8F)

| Code | HTTP | Description |
|------|------|-------------|
| `TRANSACTION_NOT_REFUNDABLE` | 422 | Transaction is not refundable. Must be `direction=incoming`, `status=succeeded`, and `transactionType` in `[payment, deposit, settlement]`. |
| `REFUND_EXCEEDS_REFUNDABLE` | 422 | Refund `amount` exceeds the remaining refundable amount (original amount minus prior refunds). |
| `PROVIDER_REFUND_UNSUPPORTED` | 422 | The payment provider does not support programmatic refunds. Use manual/offline refund process. |
| `PROVIDER_REFUND_FAILED` | 502 | The payment provider rejected the refund request. See `message` for the provider's failure reason. |

---

### Void / Cancel Errors (Phase 8F)

| Code | HTTP | Description |
|------|------|-------------|
| `TRANSACTION_NOT_VOIDABLE` | 422 | Transaction cannot be voided. Must be `direction=incoming` and `status` in `[pending, requires_action]`. |
| `PROVIDER_CANCEL_UNSUPPORTED` | 422 | The payment provider does not support programmatic cancellation. Void may still be possible via manual process. |
| `PROVIDER_CANCEL_FAILED` | 502 | The payment provider rejected the cancellation request. See `message` for the provider's failure reason. |

---

### Idempotency Errors

| Code | HTTP | Description |
|------|------|-------------|
| `IDEMPOTENCY_IN_PROGRESS` | 409 | A request with the same `idempotencyKey` is currently being processed. Retry after a short delay. |
| `IDEMPOTENCY_CONFLICT` | 409 | A completed request with the same `idempotencyKey` exists but with different parameters. |
| `IDEMPOTENCY_PREVIOUSLY_FAILED` | 409 | A previous request with the same `idempotencyKey` failed. Use a new key to retry. |

---

### Operations / Repository

| Code | HTTP | Description |
|------|------|-------------|
| `OPERATIONS_REPOSITORY_UNSUPPORTED` | 501 | The requested operation is not supported by the configured repository implementation. |

---

### Access Control

| Code | HTTP | Description |
|------|------|-------------|
| `FORBIDDEN_IN_PRODUCTION` | 403 | The endpoint is only available in non-production environments. |

---

## Operational Endpoints (no envelope)

The following endpoints are **outside** the error envelope contract and are used by load balancers and health-check probes:

| Endpoint | Auth | Notes |
|----------|------|-------|
| `GET /health` | None | Always returns `{ "ok": true, "service": "..." }` — no error envelope. |
| `GET /version` | None | Returns service metadata — no error envelope. |
| `GET /ready` | None | Returns readiness state — no error envelope. 200 if DB configured, 200 with `ok: false` if not. |

---

## Backward Compatibility Notes

- Error codes are **additive only** — existing codes will not be removed or renamed.
- Phase 8F adds refund/void codes; Phase 8K base codes are unchanged.
- The `details` field is always present (`null` when not applicable).
- The `message` field is human-readable and may change between releases; callers MUST switch on `code`, not `message`.

---

## SDK Usage

```ts
import { PaymentOrchestrationClient, PaymentOrchestrationClientError } from '@northflow/payment-orchestration-client-sdk';

try {
  await client.createPaymentIntent({ ... });
} catch (err) {
  if (err instanceof PaymentOrchestrationClientError) {
    switch (err.code) {
      case 'MERCHANT_NOT_FOUND':
        // handle 404
        break;
      case 'VALIDATION_ERROR':
        // err.details contains field-level errors
        console.error('Validation failed:', err.details);
        break;
      case 'OVERPAYMENT_REJECTED':
        // handle 422
        break;
      case 'TRANSACTION_NOT_REFUNDABLE':
        // transaction cannot be refunded in current state
        break;
      case 'REFUND_EXCEEDS_REFUNDABLE':
        // requested refund amount too large
        break;
      case 'TRANSACTION_NOT_VOIDABLE':
        // transaction cannot be voided in current state
        break;
      default:
        throw err;
    }
  }
}
```

## Refund/void provider fallback hardening notes

- `PROVIDER_REFUND_UNSUPPORTED`: returned when a non-manual gateway/sandbox provider does not expose `refundPayment()`. Manual refunds may be recorded offline; FakeGateway supports deterministic dev/test refund; Xendit sandbox currently returns unsupported.
- `PROVIDER_CANCEL_UNSUPPORTED`: returned when a non-manual gateway/sandbox provider does not expose `cancelPayment()`. Manual void/cancel may be recorded offline; FakeGateway supports deterministic dev/test cancel; Xendit sandbox currently returns unsupported.
- `IDEMPOTENCY_CONFLICT`: returned when the same merchant-scoped idempotency key is reused for a different refund/void transaction context. Matching refund/void replay returns success with `idempotentReplay: true`.
