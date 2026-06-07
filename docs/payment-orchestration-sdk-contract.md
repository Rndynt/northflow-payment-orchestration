# Payment Orchestration Client SDK — Contract

**Package:** `@northflow/payment-orchestration-client-sdk`  
**Phase:** 8K — SDK/API Contract Freeze  
**Status:** FROZEN  
**Last updated:** 2026-06-05

---

## Overview

A typed, fetch-compatible HTTP client for the `@northflow/payment-orchestration-service` standalone API.

- No React dependency
- No legacy tenant/session dependency
- No `@northflow/payment-orchestration-core` dependency (self-contained for portability)
- Node 18+ / modern browsers

---

## Installation

```bash
# From monorepo root (workspace)
pnpm add @northflow/payment-orchestration-client-sdk
```

---

## Configuration

```ts
import { PaymentOrchestrationClient } from '@northflow/payment-orchestration-client-sdk';

const client = new PaymentOrchestrationClient({
  baseUrl: 'http://localhost:5100',            // required
  serviceToken: process.env.PAYMENT_ORCHESTRATION_SERVICE_TOKEN, // injected as x-payment-orchestration-service-token
  merchantId: 'merchant-uuid',                 // optional — auto-injected into request bodies + headers
  sourceApp: 'consumer-a',                        // optional — injected as x-source-app
});
```

### `PaymentOrchestrationClientConfig`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `baseUrl` | `string` | Yes | Base URL of the payment-orchestration-service (no trailing slash). |
| `serviceToken` | `string` | No | Injected as `x-payment-orchestration-service-token` header. Required for all `/v1/...` routes except webhooks. |
| `merchantId` | `string` | No | Default merchant ID. Auto-injected into POST bodies and `x-payment-merchant-id` header when not explicitly provided. |
| `sourceApp` | `string` | No | Injected as `x-source-app` header. |

---

## Frozen Method Contract

### `createMerchant(input)`

**Route:** `POST /v1/merchants`  
**Auth:** service token required

```ts
async createMerchant(input: CreateMerchantRequest): Promise<MerchantResponse>
```

Creates or returns an existing merchant (idempotent by `sourceApp + externalRef`).

---

### `createProviderAccount(merchantId, input)`

**Route:** `POST /v1/merchants/:merchantId/provider-accounts`  
**Auth:** service token required

```ts
async createProviderAccount(merchantId: string, input: CreateProviderAccountRequest): Promise<ProviderAccountResponse>
```

Creates a payment provider account for a merchant. `credentialsRef` is accepted in input but never echoed in responses.

---

### `createPaymentIntent(input)`

**Route:** `POST /v1/payment-intents`  
**Auth:** service token required

```ts
async createPaymentIntent(input: CreatePaymentIntentRequest): Promise<PaymentIntentResponse>
```

Creates a new payment intent. `merchantId` from input or falls back to `config.merchantId`.

---

### `getPaymentIntentStatus(intentId, options?)`

**Route:** `GET /v1/payment-intents/:intentId/status`  
**Auth:** service token required

```ts
async getPaymentIntentStatus(intentId: string, options?: { merchantId?: string }): Promise<PaymentIntentStatusResponse>
```

Returns the current status of a payment intent, including computed fields (`isTerminal`, `requiresAction`, `canRetryPayment`).

---

### `createGatewayPayment(intentId, input)`

**Route:** `POST /v1/payment-intents/:intentId/gateway-payments`  
**Auth:** service token required

```ts
async createGatewayPayment(intentId: string, input: CreateGatewayPaymentRequest): Promise<GatewayPaymentResponse>
```

Initiates a gateway payment for an existing intent. Supports idempotency key. Returns the created transaction + updated intent.

---

### `getRefundability(intentId, options?)`

**Route:** `GET /v1/payment-intents/:intentId/refundability`  
**Auth:** service token required

```ts
async getRefundability(intentId: string, options?: { merchantId?: string }): Promise<RefundabilityResponse>
```

Returns the total refundable amount and per-transaction breakdown.

---

### `reconcilePaymentIntentTotals(intentId, input?)`

**Route:** `POST /v1/payment-intents/:intentId/reconcile`  
**Auth:** service token required

```ts
async reconcilePaymentIntentTotals(intentId: string, input?: ReconcilePaymentIntentTotalsRequest): Promise<ReconcilePaymentIntentTotalsResponse>
```

Crash-recovery endpoint. Recomputes intent totals from actual transaction state. Returns `changed: true` if drift was detected and corrected.

---

### `refreshProviderStatus(transactionId, input?)`

**Route:** `POST /v1/payment-transactions/:transactionId/refresh-provider-status`  
**Auth:** service token required

```ts
async refreshProviderStatus(transactionId: string, input?: RefreshProviderStatusRequest): Promise<RefreshProviderStatusResponse>
```

Polls the payment provider for the current status of a transaction and updates the DB if changed.

---

### `getReadiness()`

**Route:** `GET /ready`  
**Auth:** none required

```ts
async getReadiness(): Promise<ReadinessResponse>
```

Returns runtime readiness: DB configuration status, registered providers, Xendit sandbox config. Does not expose secrets.

---

## Error Handling

All non-2xx responses throw `PaymentOrchestrationClientError`:

```ts
import { PaymentOrchestrationClientError, PaymentOrchestrationNetworkError } from '@northflow/payment-orchestration-client-sdk';

try {
  await client.createPaymentIntent({ ... });
} catch (err) {
  if (err instanceof PaymentOrchestrationClientError) {
    console.log(err.status);    // HTTP status (e.g. 422)
    console.log(err.code);      // Machine-readable error code (e.g. 'OVERPAYMENT_REJECTED')
    console.log(err.message);   // Human-readable message
    console.log(err.details);   // Structured details (e.g. validation field errors), or null
  }
  if (err instanceof PaymentOrchestrationNetworkError) {
    // DNS failure, connection refused, timeout
    console.log(err.cause);
  }
}
```

### Error classes

| Class | Description |
|-------|-------------|
| `PaymentOrchestrationClientError` | Service returned a non-2xx response. Has `status`, `code`, `details`, `serviceError`. |
| `PaymentOrchestrationNetworkError` | HTTP request failed at transport level. Has `cause`. |

### Deprecated aliases (Phase 8B, removal planned)

| Deprecated | Use instead |
|------------|-------------|
| `PaymentEngineClient` | `PaymentOrchestrationClient` |
| `PaymentEngineClientError` | `PaymentOrchestrationClientError` |
| `PaymentEngineNetworkError` | `PaymentOrchestrationNetworkError` |
| `PaymentEngineClientConfig` | `PaymentOrchestrationClientConfig` |

---

## Request Headers

| Header | Value | Set by |
|--------|-------|--------|
| `Content-Type` | `application/json` | Always |
| `x-payment-orchestration-service-token` | `config.serviceToken` | When configured |
| `x-payment-merchant-id` | `config.merchantId` | When configured |
| `x-source-app` | `config.sourceApp` | When configured |

---

## Idempotency Key Support

`createGatewayPayment` accepts an `idempotencyKey` in the request body. Same key + same params → HTTP 200 + `idempotentReplay: true`. Same key + different params → `IDEMPOTENCY_CONFLICT`.

---

## SDK Versioning

The SDK follows the same `@northflow/payment-orchestration-*` version line. Phase 8K freezes the public method/type contract; no breaking changes will be made without a major version bump.

## Legacy parity hardening: refund/void SDK methods

### `refundPaymentTransaction(transactionId, input)`

Route: `POST /v1/payment-transactions/:transactionId/refund`

```ts
await client.refundPaymentTransaction('tx_123', {
  amount: 5000,
  reason: 'customer_return',
  idempotencyKey: 'refund-order-1-line-2',
});
```

The SDK injects `merchantId` from `PaymentOrchestrationClientConfig.merchantId` into the request body when omitted. The response includes `refundTransaction`, `intent`, `providerRefunded`, `idempotentReplay`, and optional `refundableRemaining`.

### `voidPaymentTransaction(transactionId, input?)`

Route: `POST /v1/payment-transactions/:transactionId/void`

```ts
await client.voidPaymentTransaction('tx_123', {
  reason: 'customer_cancelled',
  idempotencyKey: 'void-order-1-attempt-1',
});
```

The SDK injects `merchantId` into the body when omitted. The response includes `transaction`, nullable `intent`, `providerCancelled`, and `idempotentReplay`.

Refund/void idempotency conflicts are surfaced as `PaymentOrchestrationClientError` with code `IDEMPOTENCY_CONFLICT`. Provider capability failures surface as `PROVIDER_REFUND_UNSUPPORTED` or `PROVIDER_CANCEL_UNSUPPORTED`. Manual provider operations can succeed offline; FakeGateway is deterministic dev/test; Xendit sandbox returns unsupported for refund/cancel until real sandbox adapter methods are added.
