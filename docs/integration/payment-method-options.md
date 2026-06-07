# Payment Method Options — S7.5 Integration Guide

**Phase S7.5** adds a per-merchant-provider-account payment method catalog and intent-level payment option discovery.

## Overview

```
Provider Capability (adapter static)
         ↓  sync
po_provider_account_methods (DB)
         ↓  filter by intent currency + amount
Payment Options (consumer-facing)
         ↓  createGatewayPayment validates method
Payment Transaction
```

Three new layers:

| Layer | Entity | Purpose |
|-------|--------|---------|
| 1 | Provider capabilities | Static list declared by each adapter (`getPaymentMethodCapabilities`) |
| 2 | Provider account methods | Merchant-specific DB config (`po_provider_account_methods`) |
| 3 | Payment options | Filtered options for a specific intent (amount + currency match) |

## DB Table: `po_provider_account_methods`

| Column | Type | Description |
|--------|------|-------------|
| `id` | text PK | `pam_<uuid>` |
| `merchant_id` | text FK → po_merchants | |
| `provider_account_id` | text FK → po_provider_accounts | |
| `provider` | text | `fake_gateway`, `xendit_sandbox`, `manual` |
| `method` | text | e.g. `qris`, `va_bca`, `cash` |
| `method_type` | text | `qris` \| `virtual_account` \| `ewallet` \| `card` \| `retail_outlet` \| `manual` \| `other` |
| `provider_method_code` | text? | Provider-specific channel code |
| `display_name` | text | Human-readable name |
| `status` | text | `active` \| `disabled` \| `unsupported` |
| `currency` | text | e.g. `IDR` |
| `min_amount` | integer? | Minimum payment amount |
| `max_amount` | integer? | Maximum payment amount |
| `sort_order` | integer | Display sort order |
| `public_config` | jsonb | Config safe to expose to consumers |
| `provider_metadata` | jsonb | Provider-specific data, not exposed |
| `metadata` | jsonb | Merchant-set free-form metadata |

Unique constraint: `(provider_account_id, method)`.

## API Endpoints

### List methods for a provider account

```
GET /v1/merchants/:merchantId/provider-accounts/:providerAccountId/methods
Authorization: Bearer <apiKey>
```

Response:
```json
{
  "ok": true,
  "data": [
    {
      "id": "pam_...",
      "method": "qris",
      "methodType": "qris",
      "displayName": "QRIS",
      "status": "active",
      "currency": "IDR",
      "minAmount": 1,
      "maxAmount": 10000000,
      "sortOrder": 0
    }
  ]
}
```

Required scope: `payment_method:read` OR `provider_account:read`

### Upsert a payment method

```
PUT /v1/merchants/:merchantId/provider-accounts/:providerAccountId/methods/:method
Authorization: Bearer <apiKey>
Content-Type: application/json

{
  "methodType": "qris",
  "displayName": "QRIS Pembayaran",
  "status": "active",
  "currency": "IDR",
  "minAmount": 1000,
  "maxAmount": 5000000,
  "sortOrder": 1
}
```

Returns 201 on create, 200 on update.

Required scope: `payment_method:write` OR `provider_account:create`

### Sync methods from provider adapter

```
POST /v1/merchants/:merchantId/provider-accounts/:providerAccountId/methods/sync
Authorization: Bearer <apiKey>
```

Idempotent — safe to call repeatedly. Syncs the adapter's static capability catalog into the DB.
Manually-disabled methods are not re-enabled.

Response:
```json
{
  "ok": true,
  "data": {
    "methods": [...],
    "syncedCount": 6,
    "skippedCount": 0,
    "message": "Synced 6 method(s) from adapter capabilities."
  }
}
```

Required scope: `payment_method:sync` OR `provider_account:create`

### List active methods for a merchant (all provider accounts)

```
GET /v1/merchants/:merchantId/payment-methods
Authorization: Bearer <apiKey>
```

Returns only `status=active` methods across all provider accounts for the merchant.

Required scope: `payment_method:read` OR `provider_account:read` OR `intent:read`

### Get payment options for an intent

```
GET /v1/payment-intents/:intentId/payment-options?merchantId=mer_xxx
Authorization: Bearer <apiKey>
```

Returns methods filtered by intent currency and amount (respects min/max per method).
Use this before `createGatewayPayment` to discover valid channels.

Response:
```json
{
  "ok": true,
  "data": {
    "intentId": "intent_...",
    "merchantId": "mer_...",
    "currency": "IDR",
    "amountRemaining": 150000,
    "options": [
      {
        "method": "qris",
        "methodType": "qris",
        "displayName": "QRIS",
        "providerAccountId": "pa_...",
        "provider": "fake_gateway",
        "currency": "IDR",
        "minAmount": 1,
        "maxAmount": 10000000,
        "publicConfig": {}
      }
    ]
  }
}
```

Required scope: `payment_method:read` OR `intent:read`

## SDK Usage

```typescript
import { PaymentOrchestrationClient } from '@northflow/payment-orchestration-client-sdk';

const client = new PaymentOrchestrationClient({
  baseUrl: process.env.NORTHFLOW_BASE_URL,
  apiKey: process.env.NORTHFLOW_API_KEY,
  merchantId: 'mer_abc123',
});

// 1. Sync methods from adapter (usually done once at setup)
await client.syncProviderAccountMethods('mer_abc123', 'pa_abc123');

// 2. Discover options for an intent
const options = await client.getPaymentIntentPaymentOptions('intent_abc123');
console.log(options.options); // available methods

// 3. List methods for a provider account
const methods = await client.listProviderAccountMethods('mer_abc123', 'pa_abc123');

// 4. Manually configure a method
await client.upsertProviderAccountMethod('mer_abc123', 'pa_abc123', 'qris', {
  displayName: 'QRIS Custom',
  status: 'active',
  minAmount: 10000,
  maxAmount: 2000000,
});

// 5. List all active methods across provider accounts
const allMethods = await client.listMerchantPaymentMethods();
```

## Gateway Payment Validation

Methods originate from provider capabilities declared by each adapter (`getPaymentMethodCapabilities`).
`po_provider_account_methods` stores the enabled/allowed methods per merchant-provider-account combination.

When `providerAccountId` is provided to `createGatewayPayment`, the service validates the method against
the configured methods in `po_provider_account_methods`. This is **fail-closed**:

| Condition | Error code | HTTP status |
|-----------|-----------|-------------|
| No methods configured for provider account | `PAYMENT_METHODS_NOT_CONFIGURED` | 422 |
| Method not in configured list | `PAYMENT_METHOD_NOT_AVAILABLE` | 422 |
| Method status ≠ active (disabled or unsupported) | `PAYMENT_METHOD_DISABLED` | 422 |
| Currency mismatch | `PAYMENT_METHOD_CURRENCY_UNSUPPORTED` | 422 |
| Amount < minAmount | `PAYMENT_METHOD_AMOUNT_OUT_OF_RANGE` | 422 |
| Amount > maxAmount | `PAYMENT_METHOD_AMOUNT_OUT_OF_RANGE` | 422 |

> **Important**: If the provider account has no methods configured, the request is **rejected** with
> `PAYMENT_METHODS_NOT_CONFIGURED`. Consumer apps must sync or configure methods before accepting
> payments. Validation is only skipped when the `methodRepo` is not wired (legacy/test containers).

**Consumer apps must not hard-code provider method availability.** Always use the payment options
endpoint to discover available channels for a specific intent before calling `createGatewayPayment`.
The payment options endpoint is the only supported way to know what to display to the end user.

## Scopes Reference

| Scope | Description | Fallback (accepted) |
|-------|-------------|---------------------|
| `payment_method:read` | List/read methods | `provider_account:read`, `intent:read` |
| `payment_method:write` | Create/update methods | `provider_account:create` |
| `payment_method:sync` | Sync from provider | `provider_account:create` |

Clients with `*` wildcard scope or `internal` sourceApp bypass scope checks.

## Provider Capabilities

### FakeGateway (`fake_gateway`)
| method | methodType | currency | min | max |
|--------|-----------|----------|-----|-----|
| `qris` | qris | IDR | 1 | 10,000,000 |
| `va_bca` | virtual_account | IDR | 10,000 | 500,000,000 |
| `va_mandiri` | virtual_account | IDR | 10,000 | 500,000,000 |
| `va_bni` | virtual_account | IDR | 10,000 | 500,000,000 |
| `gopay` | ewallet | IDR | 1 | 2,000,000 |
| `redirect` | ewallet | IDR | 1 | ∞ |

### Manual (`manual`)
| method | methodType | currency |
|--------|-----------|----------|
| `cash` | manual | IDR |
| `bank_transfer` | manual | IDR |
| `manual` | manual | IDR |

### Xendit Sandbox (`xendit_sandbox`)
| method | methodType | currency | min | max |
|--------|-----------|----------|-----|-----|
| `qris` | qris | IDR | 1,500 | 10,000,000 |
| `va_bca` | virtual_account | IDR | 10,000 | 500,000,000 |
| `va_mandiri` | virtual_account | IDR | 10,000 | 500,000,000 |
| `va_bni` | virtual_account | IDR | 10,000 | 500,000,000 |
| `va_permata` | virtual_account | IDR | 10,000 | 500,000,000 |
| `ewallet_ovo` | ewallet | IDR | 1,000 | 10,000,000 |
| `invoice` | other | IDR | 1,000 | ∞ |
