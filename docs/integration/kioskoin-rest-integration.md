# Kioskoin — Single-Merchant REST Integration Guide

Kioskoin is a single-merchant kiosk payment app. It calls Northflow via REST and operates
under a single fixed merchant identity — no multi-tenancy.

## Identity model

```
Kioskoin (sourceApp=kioskoin)
  │
  ├── API Client: kioskoin_prod
  │     └── Credential: nf.live.<credentialId>.<secret>
  │
  └── Merchant: Kioskoin Business  ← single fixed merchantId
        └── grant: clientId=kioskoin_prod, scopes=[intent:create, payment:create, intent:read, ...]
```

One credential. One merchant. Simpler than multi-tenant — `merchantId` is a constant.

## Environment variables

```bash
NORTHFLOW_BASE_URL=https://northflow.internal
NORTHFLOW_API_KEY=nf.live.<credentialId>.<secret>
NORTHFLOW_MERCHANT_ID=mer_kioskoin_prod          # fixed — never changes
NORTHFLOW_SOURCE_APP=kioskoin
```

## Required scopes for Kioskoin credential

```
merchant:read
provider_account:read
intent:create
intent:read
payment:create
payment:read
payment:void
payment_method:read
```

---

## One-time setup (run once during provisioning)

```bash
# 1. Create the merchant (run once during initial deployment)
MERCHANT=$(curl -s -X POST "$NORTHFLOW_BASE_URL/v1/merchants" \
  -H "Authorization: Bearer $NORTHFLOW_API_KEY" \
  -H "x-source-app: $NORTHFLOW_SOURCE_APP" \
  -H "Content-Type: application/json" \
  -d '{
    "externalRef": "kioskoin_main",
    "name": "Kioskoin Business",
    "currency": "IDR"
  }')

MERCHANT_ID=$(echo $MERCHANT | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['id'])")
echo "NORTHFLOW_MERCHANT_ID=$MERCHANT_ID"  # Save to your .env

# 2. Create provider account
PA=$(curl -s -X POST "$NORTHFLOW_BASE_URL/v1/merchants/$MERCHANT_ID/provider-accounts" \
  -H "Authorization: Bearer $NORTHFLOW_API_KEY" \
  -H "x-payment-merchant-id: $MERCHANT_ID" \
  -H "x-source-app: $NORTHFLOW_SOURCE_APP" \
  -H "Content-Type: application/json" \
  -d '{
    "merchantId": "'$MERCHANT_ID'",
    "provider": "xendit_sandbox",
    "externalAccountId": "xnd_acct_kioskoin",
    "environment": "production",
    "sourceApp": "kioskoin"
  }')

PA_ID=$(echo $PA | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['id'])")
echo "NORTHFLOW_PROVIDER_ACCOUNT_ID=$PA_ID"

# 3. Enable QRIS payment method
curl -s -X PUT "$NORTHFLOW_BASE_URL/v1/merchants/$MERCHANT_ID/provider-accounts/$PA_ID/methods/qris" \
  -H "Authorization: Bearer $NORTHFLOW_API_KEY" \
  -H "x-payment-merchant-id: $MERCHANT_ID" \
  -H "x-source-app: $NORTHFLOW_SOURCE_APP" \
  -H "Content-Type: application/json" \
  -d '{"methodType":"qris","displayName":"QRIS","status":"active","currency":"IDR","sortOrder":1}'
```

---

## Payment flow (kiosk transaction)

Since Kioskoin has a single merchant, `x-payment-merchant-id` is always the same value.

### Create payment intent

```bash
curl -X POST "$NORTHFLOW_BASE_URL/v1/payment-intents" \
  -H "Authorization: Bearer $NORTHFLOW_API_KEY" \
  -H "x-payment-merchant-id: $NORTHFLOW_MERCHANT_ID" \
  -H "x-source-app: $NORTHFLOW_SOURCE_APP" \
  -H "Content-Type: application/json" \
  -d '{
    "merchantId": "'$NORTHFLOW_MERCHANT_ID'",
    "sourceApp": "kioskoin",
    "externalPayableType": "kiosk_order",
    "externalPayableId": "'$ORDER_ID'",
    "currency": "IDR",
    "amountDue": '"$AMOUNT"',
    "idempotencyKey": "kiosk:'$ORDER_ID':intent"
  }'
```

### Initiate payment

```bash
curl -X POST "$NORTHFLOW_BASE_URL/v1/payment-intents/$INTENT_ID/gateway-payments" \
  -H "Authorization: Bearer $NORTHFLOW_API_KEY" \
  -H "x-payment-merchant-id: $NORTHFLOW_MERCHANT_ID" \
  -H "x-source-app: $NORTHFLOW_SOURCE_APP" \
  -H "Content-Type: application/json" \
  -d '{
    "merchantId": "'$NORTHFLOW_MERCHANT_ID'",
    "provider": "xendit_sandbox",
    "providerAccountId": "'$NORTHFLOW_PROVIDER_ACCOUNT_ID'",
    "method": "qris",
    "amount": '"$AMOUNT"',
    "sourceApp": "kioskoin",
    "idempotencyKey": "kiosk:'$ORDER_ID':payment:qris"
  }'
```

### Check status (poll every 3 seconds)

```bash
while true; do
  STATUS=$(curl -s "$NORTHFLOW_BASE_URL/v1/payment-intents/$INTENT_ID/status" \
    -H "Authorization: Bearer $NORTHFLOW_API_KEY" \
    -H "x-payment-merchant-id: $NORTHFLOW_MERCHANT_ID" \
    -H "x-source-app: $NORTHFLOW_SOURCE_APP" \
    | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['data']['status'])")
  echo "Status: $STATUS"
  if [[ "$STATUS" == "paid" || "$STATUS" == "failed" || "$STATUS" == "expired" ]]; then
    break
  fi
  sleep 3
done
```

### Void (cancel before settlement)

```bash
curl -X POST "$NORTHFLOW_BASE_URL/v1/payment-transactions/$TX_ID/void" \
  -H "Authorization: Bearer $NORTHFLOW_API_KEY" \
  -H "x-payment-merchant-id: $NORTHFLOW_MERCHANT_ID" \
  -H "x-source-app: $NORTHFLOW_SOURCE_APP" \
  -H "Content-Type: application/json" \
  -d '{
    "merchantId": "'$NORTHFLOW_MERCHANT_ID'",
    "transactionId": "'$TX_ID'",
    "sourceApp": "kioskoin",
    "idempotencyKey": "void:'$TX_ID'"
  }'
```

---

## Single-merchant advantages vs multi-tenant

| Aspect | Single-merchant (Kioskoin) | Multi-tenant (AuraPoS/Transity) |
|--------|---------------------------|----------------------------------|
| `merchantId` | Fixed env var | Dynamic, per-tenant |
| `x-payment-merchant-id` header | Always same value | Different per request |
| Provider account setup | Once at deploy | Once per onboarded merchant |
| Access grants | One grant | One grant per merchant |
| Credential rotation | Restarts all kiosk processes | Same, plus update merchant services |

---

## Security isolation (S1–S5)

Even though Kioskoin has only one merchant, the full S1–S5 security model applies:

| Guarantee | Mechanism |
|-----------|-----------|
| Kioskoin cannot access AuraPoS merchants | `sourceApp=kioskoin` bound to credential; cross-app access → 403 |
| Kioskoin cannot perform refunds without `payment:refund` scope | `requireScope('payment:refund')` on refund route |
| Credential expiry automatically locks kiosk | Expired credentials → 401 UNAUTHORIZED |
| AuraPoS credential cannot authenticate as Kioskoin | Credential → `clientId` → `sourceApp=aura_pos`, mismatch → 403 SOURCE_APP_MISMATCH |

---

## Credential rotation (operational)

```bash
# Create new credential while old one is still valid
NEW_CRED=$(curl -s -X POST "$NORTHFLOW_BASE_URL/v1/api-clients/$CLIENT_ID/credentials/rotate" \
  -H "Authorization: Bearer $NORTHFLOW_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"revokeOldCredentialId": "'$OLD_CREDENTIAL_ID'"}')

NEW_SECRET=$(echo $NEW_CRED | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['newCredential']['rawSecret'])")

# Update NORTHFLOW_API_KEY in your secret manager / kiosk config
# Restart kiosk processes
echo "New secret stored. Rotate environment and restart."
```

---

## Error quick-reference

| Code | Action |
|------|--------|
| `UNAUTHORIZED` | Check that `NORTHFLOW_API_KEY` is set correctly. Rotate if compromised. |
| `MERCHANT_ACCESS_DENIED` | Re-run onboarding — grant may have been revoked. |
| `SCOPE_DENIED` | Add missing scope to the Kioskoin credential via admin tooling. |
| `VALIDATION_ERROR` | Check request body fields — likely missing `idempotencyKey` or invalid `amountDue`. |
| `RATE_LIMITED` | Kiosk is polling too fast — increase poll interval to ≥ 3 seconds. |
