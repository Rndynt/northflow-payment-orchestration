# SDK Quickstart

Backend-only TypeScript example for a merchant backend.

## Install and import

```ts
import {
  PaymentOrchestrationClient,
  PaymentOrchestrationClientError,
} from "@northflow/payment-orchestration-client-sdk";
```

## Client setup

```ts
const northflow = new PaymentOrchestrationClient({
  baseUrl: process.env.NORTHFLOW_BASE_URL!,
  apiKey: process.env.NORTHFLOW_API_KEY!,
  merchantId: process.env.NORTHFLOW_MERCHANT_ID!,
  sourceApp: process.env.NORTHFLOW_SOURCE_APP ?? "checkout-backend",
  signing: process.env.NORTHFLOW_SIGNING_SECRET
    ? {
        enabled: true,
        clientId: process.env.NORTHFLOW_CLIENT_ID!,
        keyId: process.env.NORTHFLOW_SIGNING_KEY_ID!,
        secret: process.env.NORTHFLOW_SIGNING_SECRET!,
      }
    : undefined,
});
```

Never run this client in browser, mobile, POS frontend, or public client code.

## Create payment intent

```ts
const intent = await northflow.createPaymentIntent({
  sourceApp: "checkout-backend",
  externalPayableType: "order",
  externalPayableId: order.id,
  currency: "IDR",
  amountDue: order.totalAmount,
  idempotencyKey: `order:${order.id}:intent`,
});
```

## Get payment options

```ts
const options = await northflow.getPaymentOptions(intent.id);
```

## Create gateway payment

```ts
const payment = await northflow.createGatewayPayment(intent.id, {
  provider: selected.provider,
  providerAccountId: selected.providerAccountId,
  method: selected.method,
  amount: order.totalAmount,
  idempotencyKey: `order:${order.id}:payment:${selected.method}`,
});
```

Return only safe payment instructions such as `providerPaymentUrl` or `providerQrString` from the merchant backend to the frontend.

## Poll status

```ts
const status = await northflow.getPaymentIntentStatus(intent.id);
if (status.intent.status === "paid") {
  await markOrderPaid(order.id);
}
```

## Refund transaction

```ts
const refundability = await northflow.getRefundability(intent.id);
const tx = refundability.transactions[0];
if (tx && tx.amountRefundable > 0) {
  await northflow.refundPaymentTransaction(tx.transactionId, {
    amount: tx.amountRefundable,
    reason: "merchant-requested",
    idempotencyKey: `refund:${tx.transactionId}:${tx.amountRefundable}`,
  });
}
```

## Void transaction

```ts
await northflow.voidPaymentTransaction(payment.transaction.id, {
  reason: "customer-cancelled",
  idempotencyKey: `void:${payment.transaction.id}`,
});
```

## Error handling

```ts
try {
  await northflow.createPaymentIntent({
    externalPayableType: "order",
    externalPayableId: order.id,
    currency: "IDR",
    amountDue: order.totalAmount,
    idempotencyKey: `order:${order.id}:intent`,
  });
} catch (err) {
  if (err instanceof PaymentOrchestrationClientError) {
    if (err.status === 401 || err.status === 403) throw new Error("Northflow access denied");
    if (err.status === 429) throw new Error("Northflow rate limit exceeded");
    if (err.status >= 500) throw new Error("Northflow temporarily unavailable");
  }
  throw err;
}
```

## Onboarding/admin methods

The SDK also exposes admin integration methods for server-side tooling: `createMerchant`, `getMerchant`, `createProviderAccount`, `getProviderAccount`, provider-account method management, signing-key management, `confirmFakeGatewayPayment`, and `getReadiness`.
