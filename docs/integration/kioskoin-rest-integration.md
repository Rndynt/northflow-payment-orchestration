# Consumer C — REST Integration Guide

> Consumer: Consumer C backend  
> Method: Direct REST API  
> See also: [Client Integration Contract](client-integration-contract.md)

---

## Identity Mapping

| Consumer C concept  | Northflow concept      |
|-------------------|------------------------|
| Consumer C merchant | Merchant               |
| OTC order         | Payment intent         |
| Consumer C backend  | API client credential  |

Consumer C must store the Northflow `merchantId` alongside each merchant record.

---

## Credential Setup

Consumer C backend receives one per-client credential per environment:

```
nf.live.<credentialId>.<secret>
```

Store this as a secret in the Consumer C backend. Never log or expose it.

---

## Auth Header

All API requests must include:

```
Authorization: Bearer nf.live.<consumer-c-credential>
```

---

## Merchant Onboarding

Create a Northflow merchant when a new Consumer C merchant is onboarded.

```http
POST /v1/merchants
Authorization: Bearer nf.live.<consumer-c-credential>
Content-Type: application/json

{
  "name": "Warung Serba Ada",
  "sourceApp": "consumer-c",
  "externalRef": "merchant-kiosk-001"
}
```

Response `201 Created`:

```json
{
  "ok": true,
  "data": {
    "id": "mer_ksk001",
    "name": "Warung Serba Ada",
    "legalName": null,
    "status": "active",
    "metadata": {}
  }
}
```

Store `mer_ksk001` as `northflow_merchant_id` on the Consumer C merchant record.

---

## Create Provider Account

```http
POST /v1/merchants/mer_ksk001/provider-accounts
Authorization: Bearer nf.live.<consumer-c-credential>
Content-Type: application/json

{
  "provider": "xendit_sandbox",
  "environment": "sandbox",
  "providerAccountRef": "xendit-account-id-here",
  "credentialsRef": "secret-store://xendit/consumer-c/api-key"
}
```

Response `201 Created`:

```json
{
  "ok": true,
  "data": {
    "id": "pa_ksk789",
    "merchantId": "mer_ksk001",
    "provider": "xendit_sandbox",
    "environment": "sandbox",
    "status": "active",
    "publicConfig": {},
    "metadata": {}
  }
}
```

---

## Create Payment Intent

Create a payment intent when an OTC order requires payment.

```http
POST /v1/payment-intents
Authorization: Bearer nf.live.<consumer-c-credential>
Content-Type: application/json

{
  "merchantId": "mer_ksk001",
  "sourceApp": "consumer-c",
  "externalPayableType": "otc_order",
  "externalPayableId": "otc-order-555",
  "currency": "IDR",
  "amountDue": 25000,
  "allowPartial": false,
  "idempotencyKey": "consumer-c:otc-order-555:create-intent"
}
```

Note: Consumer C OTC orders do not require `externalTenantId` or `externalOutletId`.

Response `201 Created`:

```json
{
  "ok": true,
  "data": {
    "id": "intent_ksk456",
    "merchantId": "mer_ksk001",
    "externalPayableType": "otc_order",
    "externalPayableId": "otc-order-555",
    "currency": "IDR",
    "amountDue": 25000,
    "amountPaid": 0,
    "amountRefunded": 0,
    "amountRemaining": 25000,
    "status": "requires_payment",
    "allowPartial": false,
    "expiresAt": null,
    "createdAt": "2026-06-07T10:00:00.000Z",
    "updatedAt": "2026-06-07T10:00:00.000Z"
  }
}
```

---

## Create Gateway Payment

```http
POST /v1/payment-intents/intent_ksk456/gateway-payments
Authorization: Bearer nf.live.<consumer-c-credential>
Content-Type: application/json

{
  "merchantId": "mer_ksk001",
  "provider": "xendit_sandbox",
  "method": "qris",
  "amount": 25000,
  "providerAccountId": "pa_ksk789",
  "idempotencyKey": "consumer-c:otc-order-555:gateway-payment:qris"
}
```

Response `201 Created`:

```json
{
  "ok": true,
  "data": {
    "transaction": {
      "id": "tx_ksk321",
      "intentId": "intent_ksk456",
      "merchantId": "mer_ksk001",
      "provider": "xendit_sandbox",
      "method": "qris",
      "status": "requires_action",
      "amount": 25000,
      "currency": "IDR",
      "providerQrString": "00020101...",
      "createdAt": "2026-06-07T10:00:01.000Z",
      "updatedAt": "2026-06-07T10:00:01.000Z"
    },
    "intent": { "...": "..." },
    "idempotentReplay": false
  }
}
```

---

## Get Payment Intent Status

```http
GET /v1/payment-intents/intent_ksk456/status?merchantId=mer_ksk001
Authorization: Bearer nf.live.<consumer-c-credential>
```

Response `200 OK`:

```json
{
  "ok": true,
  "data": {
    "intent": { "status": "paid", "amountPaid": 25000, "...": "..." },
    "latestTransaction": { "status": "succeeded", "...": "..." },
    "isTerminal": true,
    "requiresAction": false,
    "canRetryPayment": false
  }
}
```

---

## Required Client Scopes for Consumer C

```
merchant:create
merchant:read
provider_account:create
provider_account:read
intent:create
intent:read
payment:create
```

---

## Error Handling

| Code                    | Consumer C action                              |
|-------------------------|----------------------------------------------|
| `UNAUTHORIZED`          | Rotate credential; alert ops                 |
| `MERCHANT_ACCESS_DENIED`| Check merchant → northflowMerchantId mapping |
| `SOURCE_APP_MISMATCH`   | Bug in integration — sourceApp must be `consumer-c` |
| `SCOPE_DENIED`          | Credential missing scope; contact Northflow ops |
| `VALIDATION_ERROR`      | Fix request body — check `details` field     |
| `IDEMPOTENCY_CONFLICT`  | Different request sent with same key — check logic |
| `NOT_FOUND`             | Check merchantId / intentId                  |
