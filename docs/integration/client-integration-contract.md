# Northflow Payment Orchestration — Client Integration Contract

> Phase S6 — Frozen contract for AuraPoS (REST), Transity (SDK), and Kioskoin (REST).

---

## Identity Model

| Concept      | Northflow Entity                         |
|--------------|------------------------------------------|
| Consumer app | API Client (one per app × environment)   |
| Tenant/owner | Merchant (one per business / payment owner) |

**Rule**: one consumer application environment → one API client credential.  
**Rule**: one tenant / business / payment owner → one merchant in Northflow.

---

## Consumer Integration Method

| Consumer | Integration method |
|----------|--------------------|
| AuraPoS  | Direct REST API    |
| Transity | Client SDK         |
| Kioskoin | Direct REST API    |

Consumer **frontends** must never call the Northflow service API directly.  
Consumer **backends** call Northflow on behalf of their tenant, order, or payment flow.

---

## Authentication

### Recommended — Per-client credential (S1-S5)

Every consumer backend authenticates using a per-client credential issued in `nf.<env>.<credentialId>.<secret>` format.

```
Authorization: Bearer nf.live.abc123.xxxxxxxxxxxxxxxx
```

Alternative dedicated header (equivalent):

```
x-nf-api-key: nf.live.abc123.xxxxxxxxxxxxxxxx
```

Credentials are issued per application × environment. Do not share credentials across applications.

### Legacy — Shared service token (deprecated)

The legacy `x-payment-orchestration-service-token` header is supported in development only and is disabled in production by default. Do not use it for new integrations.

---

## Common Request Fields

| Field                  | When required                    | Notes                                      |
|------------------------|----------------------------------|--------------------------------------------|
| `merchantId`           | All merchant-scoped requests     | Must belong to the authenticated client    |
| `sourceApp`            | All create/mutate operations     | Must match the authenticated client's app  |
| `externalTenantId`     | When tenant scoping is relevant  | e.g. AuraPoS tenant ID                     |
| `externalOutletId`     | When outlet scoping is relevant  | e.g. AuraPoS outlet ID                     |
| `externalPayableType`  | All payment intent requests      | e.g. `pos_order`, `booking`, `otc_order`   |
| `externalPayableId`    | All payment intent requests      | Reference to the payable in the consumer system |
| `amountDue` / `amount` | Create intent / gateway payment  | Integer, smallest currency unit (e.g. IDR cents) |
| `currency`             | Create intent                    | ISO 4217 (e.g. `IDR`)                      |
| `allowPartial`         | Create intent (optional)         | Allow partial payments on the intent        |
| `provider`             | Create gateway payment           | e.g. `fake_gateway`, `xendit_sandbox`       |
| `method`               | Create gateway payment           | e.g. `qris`, `va`, `ew`                    |
| `providerAccountId`    | Create gateway payment (optional)| Specific provider account to use            |
| `idempotencyKey`       | All create/mutate operations     | Consumer-generated unique key per operation |
| `metadata`             | Optional on any request          | Free-form JSON for consumer-side tracking   |

---

## Idempotency Keys

Every create or mutate operation **must** include an idempotency key. The key must be unique per operation within a merchant. If the same key is received again, the service returns the original response without re-executing the operation.

Recommended formats (these are examples — do not hard-code them in service logic):

```
aurapos:<tenantId>:<orderId>:create-intent
aurapos:<tenantId>:<orderId>:gateway-payment:<method>
transity:<tenantId>:<bookingId>:create-intent
transity:<tenantId>:<bookingId>:gateway-payment:<method>
kioskoin:<orderId>:create-intent
kioskoin:<orderId>:gateway-payment:<method>
```

---

## sourceApp Enforcement

The `sourceApp` field in request bodies must match the `sourceApp` registered for the authenticated API client. If `sourceApp` is omitted from a request body, the service fills it in automatically from the authenticated client's identity. If a mismatched value is sent, the request is rejected with `403 SOURCE_APP_MISMATCH`.

Consumer apps must never attempt to impersonate another app's `sourceApp`.

---

## Merchant Ownership Enforcement

A merchant must be registered as accessible to the authenticated API client via a client–merchant access grant (`po_client_merchant_access`). Requests to merchants outside this grant are rejected with `403 MERCHANT_ACCESS_DENIED`.

Consumer backends are responsible for:
1. Creating a merchant in Northflow when onboarding a new tenant.
2. Storing the resulting `merchantId` alongside their tenant record.
3. Including the correct `merchantId` on all subsequent requests for that tenant.

---

## Required Client Scopes

| Operation                    | Required global scope      |
|------------------------------|---------------------------|
| Create merchant              | `merchant:create`          |
| Get merchant                 | `merchant:read`            |
| Create provider account      | `provider_account:create`  |
| Get provider account         | `provider_account:read`    |
| Create payment intent        | `intent:create`            |
| Get intent status            | `intent:read`              |
| Get refundability            | `intent:read`              |
| Create gateway payment       | `payment:create`           |
| Refund transaction           | `payment:refund`           |
| Void transaction             | `payment:void`             |

Both the client's global scopes **and** the merchant grant scopes must allow the required scope. `*` on a layer means all scopes for that layer.

---

## Error Contract

All errors from the service use the following JSON envelope:

```json
{
  "ok": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable description.",
    "details": { }
  }
}
```

Over HTTP, `body.error` is serialized as the code string at the top level:

```json
{ "error": "UNAUTHORIZED", "message": "Missing authentication credential." }
```

### Error Codes

| Code                    | HTTP | Meaning                                                     |
|-------------------------|------|-------------------------------------------------------------|
| `UNAUTHORIZED`          | 401  | Missing or invalid credential                               |
| `MERCHANT_ACCESS_DENIED`| 403  | Client does not have a grant to the requested merchant      |
| `SOURCE_APP_MISMATCH`   | 403  | `sourceApp` in the request body does not match the client   |
| `SCOPE_DENIED`          | 403  | Client or grant does not have the required scope            |
| `VALIDATION_ERROR`      | 422  | Request body failed schema validation                       |
| `IDEMPOTENCY_CONFLICT`  | 409  | A different request body was sent with the same idempotency key |
| `NOT_FOUND`             | 404  | Requested resource does not exist or is not accessible      |

Consumer backends must handle these codes explicitly and not expose raw error details to end users.

### SDK Error Handling

The client SDK throws `PaymentOrchestrationClientError` on non-2xx responses:

```ts
import { PaymentOrchestrationClientError } from '@northflow/payment-orchestration-client-sdk';

try {
  await client.createPaymentIntent({ ... });
} catch (err) {
  if (err instanceof PaymentOrchestrationClientError) {
    console.log(err.status);       // HTTP status
    console.log(err.code);         // e.g. 'MERCHANT_ACCESS_DENIED'
    console.log(err.message);      // human-readable
    console.log(err.details);      // validation fields or structured details
  }
}
```

Network errors throw `PaymentOrchestrationNetworkError`.

---

## REST and SDK Equivalence

REST and SDK calls produce equivalent request semantics:

- Same `Authorization: Bearer <credential>` auth header
- Same `merchantId` and `sourceApp` behavior
- Same idempotency key behavior
- Same error codes on auth / ownership / scope failures

Transity uses the SDK; AuraPoS and Kioskoin use REST directly. Both paths call the same service behavior.

---

## Security Rules

1. Consumer frontends must not call Northflow directly.
2. Credentials must not be logged, exposed in error responses, or included in metadata.
3. `sourceApp` must not be spoofed — the service enforces it against the credential.
4. The legacy shared service token must not be used in new integrations.
5. `credentialsRef` (provider secret references) is write-only and never returned in API responses.
