# AuraPoS — Multi-Tenant REST Integration Guide

AuraPoS is a multi-tenant POS platform. Each merchant using AuraPoS maps to one Northflow merchant.
AuraPoS uses a single API client credential for all its merchants; access per merchant is granted at
the `po_client_merchant_access` level.

## Identity model

```
AuraPoS (sourceApp=aura_pos)
  │
  ├── API Client: aura_pos_prod (one per environment)
  │     └── Credential: nf.live.<credentialId>.<secret>
  │
  ├── Merchant: Merchant A  → clientId=aura_pos_prod, grant scopes=[intent:create, payment:create, ...]
  ├── Merchant: Merchant B  → same clientId, separate grant
  └── Merchant: Merchant N  → same clientId, separate grant
```

One credential. Multiple merchant grants. Each merchant is isolated.

## Environment variables

```bash
NORTHFLOW_BASE_URL=https://northflow.internal
NORTHFLOW_API_KEY=nf.live.<credentialId>.<secret>    # Never share. Never log. Never expose to frontend.
NORTHFLOW_SOURCE_APP=aura_pos
```

## Required scopes for AuraPoS credential

```
merchant:create
merchant:read
provider_account:create
provider_account:read
intent:create
intent:read
payment:create
payment:read
payment:refund
payment:void
payment_method:read
webhook:manage
webhook:read
```

---

## Onboarding a new merchant (one-time per merchant)

### 1. Create the merchant

```bash
curl -X POST "$NORTHFLOW_BASE_URL/v1/merchants" \
  -H "Authorization: Bearer $NORTHFLOW_API_KEY" \
  -H "x-source-app: $NORTHFLOW_SOURCE_APP" \
  -H "Content-Type: application/json" \
  -d '{
    "externalRef": "aura_pos_merchant_42",
    "name": "Warung Pak Budi",
    "currency": "IDR"
  }'
```

**Store the returned `merchantId`** in your merchant record.

> Merchant access is automatically granted to the creating client when using a per-client credential.
> No separate access grant step is required.

### 2. Create a provider account for the merchant

```bash
curl -X POST "$NORTHFLOW_BASE_URL/v1/merchants/$MERCHANT_ID/provider-accounts" \
  -H "Authorization: Bearer $NORTHFLOW_API_KEY" \
  -H "x-payment-merchant-id: $MERCHANT_ID" \
  -H "x-source-app: $NORTHFLOW_SOURCE_APP" \
  -H "Content-Type: application/json" \
  -d '{
    "merchantId": "'$MERCHANT_ID'",
    "provider": "xendit_sandbox",
    "externalAccountId": "xnd_acct_xxxx",
    "environment": "production",
    "sourceApp": "aura_pos"
  }'
```

### 3. Configure payment methods

```bash
curl -X PUT "$NORTHFLOW_BASE_URL/v1/merchants/$MERCHANT_ID/provider-accounts/$PROVIDER_ACCOUNT_ID/methods/qris" \
  -H "Authorization: Bearer $NORTHFLOW_API_KEY" \
  -H "x-payment-merchant-id: $MERCHANT_ID" \
  -H "x-source-app: $NORTHFLOW_SOURCE_APP" \
  -H "Content-Type: application/json" \
  -d '{
    "methodType": "qris",
    "displayName": "QRIS",
    "status": "active",
    "currency": "IDR",
    "sortOrder": 1
  }'
```

---

## Payment flow (per-transaction, multi-tenant aware)

> Always include `x-payment-merchant-id` header for every merchant-scoped request.
> Never share a single payment intent across merchants.

### 1. Create payment intent

```bash
curl -X POST "$NORTHFLOW_BASE_URL/v1/payment-intents" \
  -H "Authorization: Bearer $NORTHFLOW_API_KEY" \
  -H "x-payment-merchant-id: $MERCHANT_ID" \
  -H "x-source-app: $NORTHFLOW_SOURCE_APP" \
  -H "Content-Type: application/json" \
  -d '{
    "merchantId": "'$MERCHANT_ID'",
    "sourceApp": "aura_pos",
    "externalPayableType": "order",
    "externalPayableId": "order_777",
    "currency": "IDR",
    "amountDue": 85000,
    "idempotencyKey": "order:order_777:intent"
  }'
```

### 2. Get available payment options

```bash
curl "$NORTHFLOW_BASE_URL/v1/payment-intents/$INTENT_ID/payment-options" \
  -H "Authorization: Bearer $NORTHFLOW_API_KEY" \
  -H "x-payment-merchant-id: $MERCHANT_ID" \
  -H "x-source-app: $NORTHFLOW_SOURCE_APP"
```

### 3. Initiate gateway payment

```bash
curl -X POST "$NORTHFLOW_BASE_URL/v1/payment-intents/$INTENT_ID/gateway-payments" \
  -H "Authorization: Bearer $NORTHFLOW_API_KEY" \
  -H "x-payment-merchant-id: $MERCHANT_ID" \
  -H "x-source-app: $NORTHFLOW_SOURCE_APP" \
  -H "Content-Type: application/json" \
  -d '{
    "merchantId": "'$MERCHANT_ID'",
    "provider": "xendit_sandbox",
    "providerAccountId": "'$PROVIDER_ACCOUNT_ID'",
    "method": "qris",
    "amount": 85000,
    "sourceApp": "aura_pos",
    "idempotencyKey": "order:order_777:payment:qris"
  }'
```

### 4. Poll status

```bash
curl "$NORTHFLOW_BASE_URL/v1/payment-intents/$INTENT_ID/status" \
  -H "Authorization: Bearer $NORTHFLOW_API_KEY" \
  -H "x-payment-merchant-id: $MERCHANT_ID" \
  -H "x-source-app: $NORTHFLOW_SOURCE_APP"
```

---

## Multi-tenant isolation guarantees (S1–S5)

| Guarantee | Mechanism |
|-----------|-----------|
| One AuraPoS client cannot read another app's merchants | `po_client_merchant_access` — client can only access merchants granted to it |
| AuraPoS Merchant A cannot read Merchant B's intents | `x-payment-merchant-id` header + merchant ownership check on every route |
| AuraPoS cannot spoof Transity or Kioskoin | `sourceApp=aura_pos` verified against credential; mismatch → 403 SOURCE_APP_MISMATCH |
| AuraPoS cannot perform actions beyond its granted scopes | Per-route `requireScope` + per-grant scope check → 403 SCOPE_DENIED |

---

## Error reference

| HTTP | Code | Cause |
|------|------|-------|
| 401 | `UNAUTHORIZED` | Missing, revoked, or expired API key |
| 403 | `MERCHANT_ACCESS_DENIED` | AuraPoS credential not granted access to the requested merchant |
| 403 | `SCOPE_DENIED` | Credential missing a required action scope |
| 403 | `SOURCE_APP_MISMATCH` | `sourceApp` in body does not match credential's registered sourceApp |
| 422 | `MERCHANT_NOT_FOUND` | merchantId does not exist |
| 429 | `RATE_LIMITED` | Too many requests — back off and retry with jitter |

---

## Security rules

1. **Never log** `NORTHFLOW_API_KEY`. Use a secrets manager (AWS SSM, Vault, GCP Secret Manager).
2. **Never expose** `NORTHFLOW_API_KEY` to the frontend, mobile app, or any client-side code.
3. **Always use HTTPS** in production.
4. **Rotate credentials** using `/v1/api-clients/:clientId/credentials/rotate` if compromise suspected.
5. **Idempotency keys are required** for all mutation operations to prevent duplicate charges.
