# Consumer B — SDK Integration Guide

> Consumer: Consumer B backend  
> Method: `@northflow/payment-orchestration-client-sdk`  
> See also: [Client Integration Contract](client-integration-contract.md)

---

## Identity Mapping

| Consumer B concept  | Northflow concept      |
|-------------------|------------------------|
| Consumer B tenant   | Merchant               |
| Booking / trip    | Payment intent         |
| Consumer B backend  | API client credential  |

Consumer B must store the Northflow `merchantId` alongside each tenant record.

---

## SDK Installation

```bash
pnpm add @northflow/payment-orchestration-client-sdk
# or
npm install @northflow/payment-orchestration-client-sdk
```

---

## Client Initialization

```ts
import { PaymentOrchestrationClient } from '@northflow/payment-orchestration-client-sdk';

const northflow = new PaymentOrchestrationClient({
  baseUrl: process.env.NORTHFLOW_BASE_URL!,
  apiKey: process.env.NORTHFLOW_API_KEY!,   // nf.live.<credentialId>.<secret>
});
```

`apiKey` is sent as `Authorization: Bearer <apiKey>` automatically. Do not pass it in metadata or logs.

The SDK can also be constructed with a default `merchantId` when the backend serves a single tenant:

```ts
const northflow = new PaymentOrchestrationClient({
  baseUrl: process.env.NORTHFLOW_BASE_URL!,
  apiKey: process.env.NORTHFLOW_API_KEY!,
  merchantId: tenant.northflowMerchantId,
  // sourceApp is inferred from the credential — do not override it
});
```

---

## Merchant Onboarding

```ts
const merchant = await northflow.createMerchant({
  name: 'Shuttle Express',
  legalName: 'PT Shuttle Express Indonesia',
  sourceApp: 'consumer-b',
  externalRef: 'tenant-shuttle-express',
});

// Persist merchant.id alongside the Consumer B tenant
await db.tenant.update({ northflowMerchantId: merchant.id });
```

---

## Create Provider Account

```ts
const providerAccount = await northflow.createProviderAccount(merchant.id, {
  provider: 'xendit_sandbox',
  environment: 'sandbox',
  providerAccountRef: 'xendit-account-id-here',
  credentialsRef: 'secret-store://xendit/consumer-b/api-key',
});
```

`credentialsRef` is write-only — it is never returned in responses.

---

## Create Payment Intent

```ts
const intent = await northflow.createPaymentIntent({
  merchantId: tenant.northflowMerchantId,
  sourceApp: 'consumer-b',
  externalTenantId: tenant.id,
  externalPayableType: 'booking',
  externalPayableId: booking.id,
  currency: 'IDR',
  amountDue: booking.totalFare,
  idempotencyKey: `consumer-b:${tenant.id}:${booking.id}:create-intent`,
});
```

Store `intent.id` linked to the booking record.

---

## Create Gateway Payment

```ts
const payment = await northflow.createGatewayPayment(intent.id, {
  merchantId: tenant.northflowMerchantId,
  provider: 'xendit_sandbox',
  method: 'qris',
  amount: booking.totalFare,
  providerAccountId: providerAccount.id,
  idempotencyKey: `consumer-b:${tenant.id}:${booking.id}:gateway-payment:qris`,
});

// Present to customer
if (payment.transaction.providerQrString) {
  displayQrCode(payment.transaction.providerQrString);
}
if (payment.transaction.providerPaymentUrl) {
  redirectTo(payment.transaction.providerPaymentUrl);
}
```

---

## Get Payment Intent Status

Poll until `isTerminal` is `true`.

```ts
const status = await northflow.getPaymentIntentStatus(intent.id, {
  merchantId: tenant.northflowMerchantId,
});

if (status.isTerminal && status.intent.status === 'paid') {
  await confirmBooking(booking.id);
}
if (status.intent.status === 'expired') {
  await cancelBooking(booking.id);
}
```

---

## Error Handling

```ts
import {
  PaymentOrchestrationClientError,
  PaymentOrchestrationNetworkError,
} from '@northflow/payment-orchestration-client-sdk';

try {
  const intent = await northflow.createPaymentIntent({ ... });
} catch (err) {
  if (err instanceof PaymentOrchestrationClientError) {
    switch (err.code) {
      case 'UNAUTHORIZED':
        // Credential invalid or revoked — alert ops, do not retry
        break;
      case 'MERCHANT_ACCESS_DENIED':
        // merchantId not linked to this client — check tenant mapping
        break;
      case 'IDEMPOTENCY_CONFLICT':
        // Different body sent with same idempotency key — check integration logic
        break;
      case 'VALIDATION_ERROR':
        // Check err.details for field-level errors
        break;
      default:
        // Unexpected error — log err.status, err.code, err.message
    }
  } else if (err instanceof PaymentOrchestrationNetworkError) {
    // DNS, connection refused, timeout — retry with backoff
  }
}
```

SDK preserves:
- `err.status` — HTTP status code
- `err.code` — machine-readable error code
- `err.message` — human-readable description
- `err.details` — structured validation details (if available)

---

## SDK vs REST Equivalence

The SDK sends the same `Authorization: Bearer` header, the same `merchantId` / `sourceApp` payload fields, and the same `idempotencyKey` as a direct REST call. Error codes on auth / ownership / scope failures are identical.

---

## Required Client Scopes for Consumer B

```
merchant:create
merchant:read
provider_account:create
provider_account:read
intent:create
intent:read
payment:create
```

Consumer B does not require `payment:refund` or `payment:void` unless it handles refunds directly.
