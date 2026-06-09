# Error Contract

All error responses from the Northflow Payment Orchestration Service follow a single envelope shape:

```json
{
  "ok": false,
  "error": {
    "code": "SCOPE_DENIED",
    "message": "Missing required scope: payment:create",
    "details": null
  }
}
```

`details` is always `null` in current implementation. Reserved for structured validation details in future versions.

---

## HTTP Status → Error Code Mapping

| HTTP Status | Error Code                  | When                                                                  |
|-------------|-----------------------------|-----------------------------------------------------------------------|
| 400         | `VALIDATION_ERROR`          | Missing required field, invalid value, business rule violation        |
| 401         | `UNAUTHORIZED`              | Missing `Authorization` header, credential not found, revoked, expired |
| 401         | `SOURCE_APP_MISMATCH`       | Credential belongs to a different source application                  |
| 401         | `SERVICE_MISCONFIGURED`     | `AUTH_DATASOURCE` env var not set; service cannot authenticate        |
| 403         | `SCOPE_DENIED`              | Credential present but missing required scope                         |
| 403         | `MERCHANT_ACCESS_DENIED`    | Credential not granted access to the requested merchant               |
| 404         | `NOT_FOUND`                 | Resource not found                                                    |
| 409         | `CONFLICT`                  | Idempotency key collision with different payload                      |
| 422         | `UNPROCESSABLE`             | Business rule prevents processing (e.g. refund on non-refundable tx)  |
| 429         | `RATE_LIMITED`              | Per-credential or per-IP rate limit exceeded                          |
| 500         | `INTERNAL_ERROR`            | Unexpected server error (safe message, no stack trace)                |
| 501         | `NOT_IMPLEMENTED`           | Feature present but not wired in current deployment configuration     |

---

## Auth Error Detail

### `UNAUTHORIZED` (401)

Returned when:
- `Authorization: Bearer <secret>` header is missing entirely
- The `rawSecret` does not match any active credential
- The matched credential is revoked (`revokedAt` is set)
- The matched credential is expired (`expiresAt < now`)

```json
{ "ok": false, "error": { "code": "UNAUTHORIZED", "message": "Missing authentication credential.", "details": null } }
{ "ok": false, "error": { "code": "UNAUTHORIZED", "message": "Credential not found or revoked.", "details": null } }
{ "ok": false, "error": { "code": "UNAUTHORIZED", "message": "Credential expired.", "details": null } }
```

### `SOURCE_APP_MISMATCH` (401)

Returned when the credential's `sourceApp` does not match the service's `SOURCE_APP` env var.
Used to prevent cross-environment credential reuse.

```json
{ "ok": false, "error": { "code": "SOURCE_APP_MISMATCH", "message": "Credential does not belong to this application.", "details": null } }
```

### `SERVICE_MISCONFIGURED` (401)

Returned when `AUTH_DATASOURCE` is not set or the auth repository is not wired.
Callers should treat this as a deployment configuration error, not a client error.

```json
{ "ok": false, "error": { "code": "SERVICE_MISCONFIGURED", "message": "Authentication is not configured.", "details": null } }
```

### `SCOPE_DENIED` (403)

Returned when the credential is valid and active but does not have the required scope for the route.
The message always names the missing scope.

```json
{ "ok": false, "error": { "code": "SCOPE_DENIED", "message": "Missing required scope: payment:create", "details": null } }
```

### `MERCHANT_ACCESS_DENIED` (403)

Returned when the credential has the required scope but the credential has not been granted access
to the specific `merchantId` being accessed.

```json
{ "ok": false, "error": { "code": "MERCHANT_ACCESS_DENIED", "message": "Merchant access denied.", "details": null } }
```

---

## HMAC Signed Request Errors

When `signedRequestsMode` is `required` (production default), requests without valid HMAC
signatures receive:

| HTTP | Code                  | Condition                                                  |
|------|-----------------------|------------------------------------------------------------|
| 401  | `SIGNATURE_MISSING`   | No `x-nf-signature` header                                |
| 401  | `SIGNATURE_INVALID`   | Signature present but HMAC verification failed             |
| 401  | `SIGNATURE_EXPIRED`   | Timestamp outside ±5-minute tolerance window               |
| 401  | `SIGNING_KEY_NOT_FOUND` | `x-nf-key-id` references unknown or revoked key          |

---

## SDK Error Classes

The TypeScript client SDK maps all non-2xx responses to typed error classes:

```ts
import { PaymentOrchestrationClientError, PaymentOrchestrationNetworkError } from '@northflow/payment-orchestration-client-sdk';

try {
  await client.createPaymentIntent(...);
} catch (err) {
  if (err instanceof PaymentOrchestrationClientError) {
    // err.status — HTTP status (400, 401, 403, ...)
    // err.code       — error code string ('SCOPE_DENIED', ...)
    // err.message    — human-readable message from service
  }
  if (err instanceof PaymentOrchestrationNetworkError) {
    // Network-level failure (DNS, timeout, connection refused)
  }
}
```

### `PaymentOrchestrationClientError`

```ts
class PaymentOrchestrationClientError extends Error {
  statusCode: number;
  code: string;
}
```

Thrown for any response where `ok === false` or HTTP status >= 400.

### `PaymentOrchestrationNetworkError`

```ts
class PaymentOrchestrationNetworkError extends Error {
  cause?: Error;
}
```

Thrown for `fetch` failures (network unreachable, timeout, DNS failure).

---

## Error Envelope Invariants

1. Every error response has `ok: false` — guaranteed.
2. Every error response has `error.code` — a stable `SCREAMING_SNAKE_CASE` string.
3. Every error response has `error.message` — a human-readable string for logging/debugging.
4. `error.details` is always `null` in the current implementation.
5. No stack traces are ever included in error responses.
6. Auth errors never reveal whether a credential ID exists (no enumeration).
