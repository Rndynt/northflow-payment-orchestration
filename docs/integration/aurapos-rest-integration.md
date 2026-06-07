# AuraPoS — REST Integration Guide

> Consumer: AuraPoS backend  
> Method: Direct REST API  
> See also: [Client Integration Contract](client-integration-contract.md)

---

## Identity Mapping

| AuraPoS concept | Northflow concept      |
|-----------------|------------------------|
| AuraPoS tenant  | Merchant               |
| Outlet/location | `externalOutletId`     |
| POS order       | Payment intent         |
| AuraPoS backend env | API client credential |

AuraPoS must store the Northflow `merchantId` alongside each tenant record. One tenant = one merchant.

---

## Credential Setup

AuraPoS backend receives one per-client credential per environment from Northflow operations:

```
nf.live.<credentialId>.<secret>
```

Store this as a secret in the AuraPoS backend (e.g. environment variable). Never log or expose it.

---

## Auth Header

All API requests must include:

```
Authorization: Bearer nf.live.<credentialId>.<secret>
```

---

## Merchant Onboarding

Create a Northflow merchant when a new AuraPoS tenant is onboarded.

```http
POST /v1/merchants
Authorization: Bearer nf.live.<aurapos-credential>
Content-Type: application/json

{
  "name": "Kopi Nusantara",
  "legalName": "PT Kopi Nusantara Indonesia",
  "sourceApp": "aurapos",
  "externalRef": "tenant-001"
}
```

Response `201 Created`:

```json
{
  "ok": true,
  "data": {
    "id": "mer_abc123",
    "name": "Kopi Nusantara",
    "legalName": "PT Kopi Nusantara Indonesia",
    "status": "active",
    "metadata": {}
  }
}
```

Store `mer_abc123` as `northflow_merchant_id` on the AuraPoS tenant record.

---

## Create Provider Account

Link a payment provider to the merchant. One provider account per provider × environment.

```http
POST /v1/merchants/mer_abc123/provider-accounts
Authorization: Bearer nf.live.<aurapos-credential>
Content-Type: application/json

{
  "provider": "xendit_sandbox",
  "environment": "sandbox",
  "providerAccountRef": "xendit-account-id-here",
  "credentialsRef": "secret-store://xendit/tenant-001/api-key"
}
```

Response `201 Created`:

```json
{
  "ok": true,
  "data": {
    "id": "pa_xyz789",
    "merchantId": "mer_abc123",
    "provider": "xendit_sandbox",
    "environment": "sandbox",
    "providerAccountRef": "xendit-account-id-here",
    "status": "active",
    "publicConfig": {},
    "metadata": {}
  }
}
```

Note: `credentialsRef` is write-only and is never returned in responses.

---

## Create Payment Intent

Create a payment intent when a POS order requires payment.

```http
POST /v1/payment-intents
Authorization: Bearer nf.live.<aurapos-credential>
Content-Type: application/json

{
  "merchantId": "mer_abc123",
  "sourceApp": "aurapos",
  "externalTenantId": "tenant-001",
  "externalOutletId": "outlet-42",
  "externalPayableType": "pos_order",
  "externalPayableId": "order-789",
  "currency": "IDR",
  "amountDue": 75000,
  "allowPartial": false,
  "idempotencyKey": "aurapos:tenant-001:order-789:create-intent"
}
```

Response `201 Created`:

```json
{
  "ok": true,
  "data": {
    "id": "intent_def456",
    "merchantId": "mer_abc123",
    "externalPayableType": "pos_order",
    "externalPayableId": "order-789",
    "currency": "IDR",
    "amountDue": 75000,
    "amountPaid": 0,
    "amountRefunded": 0,
    "amountRemaining": 75000,
    "status": "requires_payment",
    "allowPartial": false,
    "expiresAt": null,
    "createdAt": "2026-06-07T10:00:00.000Z",
    "updatedAt": "2026-06-07T10:00:00.000Z"
  }
}
```

Store `intent_def456` linked to the POS order.

---

## Create Gateway Payment

Initiate a payment through the provider.

```http
POST /v1/payment-intents/intent_def456/gateway-payments
Authorization: Bearer nf.live.<aurapos-credential>
Content-Type: application/json

{
  "merchantId": "mer_abc123",
  "provider": "xendit_sandbox",
  "method": "qris",
  "amount": 75000,
  "providerAccountId": "pa_xyz789",
  "idempotencyKey": "aurapos:tenant-001:order-789:gateway-payment:qris"
}
```

Response `201 Created`:

```json
{
  "ok": true,
  "data": {
    "transaction": {
      "id": "tx_ghi012",
      "intentId": "intent_def456",
      "merchantId": "mer_abc123",
      "provider": "xendit_sandbox",
      "method": "qris",
      "status": "requires_action",
      "amount": 75000,
      "currency": "IDR",
      "providerPaymentUrl": null,
      "providerQrString": "00020101...",
      "createdAt": "2026-06-07T10:00:01.000Z",
      "updatedAt": "2026-06-07T10:00:01.000Z"
    },
    "intent": { "...": "..." },
    "idempotentReplay": false
  }
}
```

Display `providerQrString` or `providerPaymentUrl` to the customer.

---

## Get Payment Intent Status

Poll for payment completion.

```http
GET /v1/payment-intents/intent_def456/status?merchantId=mer_abc123
Authorization: Bearer nf.live.<aurapos-credential>
```

Response `200 OK`:

```json
{
  "ok": true,
  "data": {
    "intent": { "status": "paid", "amountPaid": 75000, "...": "..." },
    "latestTransaction": { "status": "succeeded", "...": "..." },
    "isTerminal": true,
    "requiresAction": false,
    "canRetryPayment": false
  }
}
```

---

## Get Refundability

Check how much can be refunded on a paid intent.

```http
GET /v1/payment-intents/intent_def456/refundability?merchantId=mer_abc123
Authorization: Bearer nf.live.<aurapos-credential>
```

Response `200 OK`:

```json
{
  "ok": true,
  "data": {
    "intentId": "intent_def456",
    "merchantId": "mer_abc123",
    "totalRefundable": 75000,
    "currency": "IDR",
    "transactions": [
      {
        "transactionId": "tx_ghi012",
        "amount": 75000,
        "amountAlreadyRefunded": 0,
        "amountRefundable": 75000,
        "provider": "xendit_sandbox",
        "method": "qris"
      }
    ]
  }
}
```

---

## Refund Transaction

Refund a succeeded transaction.

```http
POST /v1/payment-transactions/tx_ghi012/refund
Authorization: Bearer nf.live.<aurapos-credential>
Content-Type: application/json

{
  "merchantId": "mer_abc123",
  "amount": 75000,
  "reason": "customer_request",
  "idempotencyKey": "aurapos:tenant-001:order-789:refund:full"
}
```

Response `200 OK`:

```json
{
  "ok": true,
  "data": {
    "refundTransaction": { "id": "tx_refund001", "status": "succeeded", "...": "..." },
    "intent": { "status": "refunded", "...": "..." },
    "refundableRemaining": 0,
    "providerRefunded": true,
    "idempotentReplay": false
  }
}
```

---

## Void Transaction

Cancel a pending or requires_action transaction.

```http
POST /v1/payment-transactions/tx_ghi012/void
Authorization: Bearer nf.live.<aurapos-credential>
Content-Type: application/json

{
  "merchantId": "mer_abc123",
  "reason": "order_cancelled",
  "idempotencyKey": "aurapos:tenant-001:order-789:void"
}
```

Response `200 OK`:

```json
{
  "ok": true,
  "data": {
    "transaction": { "id": "tx_ghi012", "status": "cancelled", "...": "..." },
    "intent": { "status": "requires_payment", "...": "..." },
    "providerCancelled": true,
    "idempotentReplay": false
  }
}
```

---

## Required Client Scopes for AuraPoS

```
merchant:create
merchant:read
provider_account:create
provider_account:read
intent:create
intent:read
payment:create
payment:refund
payment:void
```

---

## Error Handling

| Code                    | AuraPoS action                               |
|-------------------------|----------------------------------------------|
| `UNAUTHORIZED`          | Rotate credential; alert ops                 |
| `MERCHANT_ACCESS_DENIED`| Check tenant → merchantId mapping            |
| `SOURCE_APP_MISMATCH`   | Bug in integration — fix sourceApp value     |
| `SCOPE_DENIED`          | Credential missing required scope; contact Northflow ops |
| `VALIDATION_ERROR`      | Fix request body — check `details` field     |
| `IDEMPOTENCY_CONFLICT`  | Different request body sent with same key — check logic |
| `NOT_FOUND`             | Check merchantId / intentId / transactionId  |
