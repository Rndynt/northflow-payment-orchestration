# Transity — Multi-Tenant SDK Integration Guide

Transity is a multi-tenant payment platform that calls Northflow using the TypeScript SDK.
Like AuraPoS, Transity uses one API client credential per environment, with per-merchant access grants.

## Identity model

```
Transity (sourceApp=transity)
  │
  ├── API Client: transity_prod (one per environment)
  │     └── Credential: nf.live.<credentialId>.<secret>
  │
  ├── Merchant: Tenant A  → clientId=transity_prod, grant scopes=[intent:create, payment:create, ...]
  ├── Merchant: Tenant B  → same clientId, separate grant
  └── Merchant: Tenant N  → same clientId, separate grant
```

## Installation

```bash
# The SDK is a local workspace package within the monorepo
# For standalone use, build and publish @northflow/payment-orchestration-client-sdk
import { PaymentOrchestrationClient } from '@northflow/payment-orchestration-client-sdk';
```

## SDK client setup

```typescript
import { PaymentOrchestrationClient } from '@northflow/payment-orchestration-client-sdk';

// One client instance per environment. Re-use across requests.
// Never create a new client per request — it's stateless and safe to share.
const northflow = new PaymentOrchestrationClient({
  baseUrl: process.env.NORTHFLOW_BASE_URL!,
  apiKey: process.env.NORTHFLOW_API_KEY!,   // nf.live.<credentialId>.<secret>
  sourceApp: 'transity',
  // merchantId can be set per-call; leave blank here for multi-tenant usage
});
```

For multi-tenant use, pass `merchantId` in each call rather than at construction time:

```typescript
// Per-request: override merchantId
const status = await northflow.getPaymentIntentStatus(intentId, { merchantId: tenantMerchantId });
```

---

## Onboarding a new tenant merchant (one-time)

```typescript
// 1. Create merchant
const merchant = await northflow.createMerchant({
  externalRef: `transity_tenant_${tenantId}`,
  name: tenant.businessName,
  currency: 'IDR',
  sourceApp: 'transity',
});
// Store merchant.id in your tenant record

// 2. Create provider account
const providerAccount = await northflow.createProviderAccount(merchant.id, {
  merchantId: merchant.id,
  provider: 'xendit_sandbox',
  externalAccountId: tenant.xenditAccountId,
  environment: 'production',
  sourceApp: 'transity',
});

// 3. Configure payment methods
await northflow.upsertProviderAccountMethod(merchant.id, providerAccount.id, 'qris', {
  methodType: 'qris',
  displayName: 'QRIS',
  status: 'active',
  currency: 'IDR',
  sortOrder: 1,
});

await northflow.upsertProviderAccountMethod(merchant.id, providerAccount.id, 'virtual_account_bca', {
  methodType: 'virtual_account',
  displayName: 'Transfer Bank BCA',
  status: 'active',
  currency: 'IDR',
  sortOrder: 2,
});
```

---

## Payment flow (per transaction)

```typescript
async function processPayment(tenantMerchantId: string, order: Order) {
  // 1. Create payment intent — idempotent on (externalPayableType, externalPayableId)
  const intent = await northflow.createPaymentIntent({
    merchantId: tenantMerchantId,
    sourceApp: 'transity',
    externalPayableType: 'order',
    externalPayableId: order.id,
    currency: 'IDR',
    amountDue: order.totalAmount,
    idempotencyKey: `order:${order.id}:intent`,
  });

  // 2. Get available payment options for this intent + merchant
  const { options } = await northflow.getPaymentOptions(intent.id, { merchantId: tenantMerchantId });

  // 3. Render options to user and wait for method selection...
  const selectedOption = options[0]!;

  // 4. Initiate gateway payment
  const payment = await northflow.createGatewayPayment({
    intentId: intent.id,
    merchantId: tenantMerchantId,
    provider: selectedOption.provider,
    providerAccountId: selectedOption.providerAccountId,
    method: selectedOption.method,
    amount: order.totalAmount,
    sourceApp: 'transity',
    idempotencyKey: `order:${order.id}:payment:${selectedOption.method}`,
  });

  // 5. Return payment action/redirect info to frontend
  return { intentId: intent.id, action: payment.action };
}
```

## Polling status

```typescript
async function waitForPayment(intentId: string, tenantMerchantId: string): Promise<string> {
  for (let i = 0; i < 30; i++) {
    const { status } = await northflow.getPaymentIntentStatus(intentId, { merchantId: tenantMerchantId });
    if (['paid', 'partially_paid', 'failed', 'expired', 'cancelled'].includes(status)) {
      return status;
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  return 'timeout';
}
```

## Refund

```typescript
async function refundTransaction(transactionId: string, tenantMerchantId: string, amount: number) {
  return northflow.refundPaymentTransaction({
    transactionId,
    merchantId: tenantMerchantId,
    amount,
    reason: 'customer_request',
    sourceApp: 'transity',
    idempotencyKey: `refund:${transactionId}:${amount}`,
  });
}
```

---

## Error handling

```typescript
import {
  PaymentOrchestrationClientError,
  PaymentOrchestrationNetworkError,
} from '@northflow/payment-orchestration-client-sdk';

try {
  await northflow.createPaymentIntent({ ... });
} catch (err) {
  if (err instanceof PaymentOrchestrationClientError) {
    switch (err.code) {
      case 'UNAUTHORIZED':
        // Credential invalid, revoked, or expired — rotate key
        break;
      case 'MERCHANT_ACCESS_DENIED':
        // This credential is not granted access to the merchant — check onboarding
        break;
      case 'SCOPE_DENIED':
        // Credential missing required scope — check credential configuration
        break;
      case 'RATE_LIMITED':
        // Back off with exponential jitter
        break;
      default:
        // Log err.code, err.message, err.status for debugging
    }
  } else if (err instanceof PaymentOrchestrationNetworkError) {
    // Network failure — retry with backoff
  }
}
```

---

## Multi-tenant isolation guarantees (S1–S5)

| Guarantee | Mechanism |
|-----------|-----------|
| Transity cannot access AuraPoS or Kioskoin merchants | Credential bound to `sourceApp=transity` — cross-app access rejected at auth layer |
| Tenant A cannot read Tenant B's payment intents | Per-request `merchantId` checked against `po_client_merchant_access` |
| Transity cannot spoof another sourceApp | `sourceApp` in request body verified against credential's registered `sourceApp` |
| SDK always sends correct auth headers | SDK auto-injects `Authorization: Bearer <apiKey>` and `x-payment-merchant-id` |

---

## Webhook integration (S10.3)

Register a webhook endpoint per merchant to receive real-time payment events:

```typescript
const { endpoint, rawSecret } = await northflow.createMerchantWebhookEndpoint(tenantMerchantId, {
  url: `https://api.transity.io/webhooks/northflow/${tenantMerchantId}`,
  subscribedEvents: [
    'payment_intent.paid',
    'payment_intent.failed',
    'payment_intent.expired',
    'payment_transaction.succeeded',
    'payment_transaction.failed',
  ],
});

// Store rawSecret securely — it is returned ONCE ONLY.
// Use it to verify incoming webhook HMAC signatures.
await secretManager.store(`northflow_webhook_secret_${tenantMerchantId}`, rawSecret);
```

See `webhook-signature-verification.md` for payload verification.

---

## Security rules

1. **Never expose `apiKey`** to the frontend or mobile layer.
2. **Never log `apiKey`** or `rawSecret` — use structured secret storage.
3. **Separate credentials per environment** — do not share production credentials with staging.
4. **Use idempotency keys** on all mutation calls (`createPaymentIntent`, `createGatewayPayment`, `refundPaymentTransaction`, `voidPaymentTransaction`).
5. **Handle `RATE_LIMITED` with exponential backoff** — do not retry immediately.
