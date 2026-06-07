# FakeGateway Smoke Test Guide — payment-orchestration-service Phase 8D

Quick reference for manually verifying the standalone service end-to-end with `curl`.

## Prerequisites

```bash
export BASE_URL=http://localhost:5100
export TOKEN=dev-token-change-me
# Set PAYMENT_ORCHESTRATION_SERVICE_TOKEN=dev-token-change-me in your .env
```

## Step 1 — Health check (no auth required)

```bash
curl -s $BASE_URL/health | jq .
# Expected: { "ok": true, "status": "healthy", "phase": "8D" }
```

## Step 2 — Create Merchant

```bash
curl -s -X POST $BASE_URL/v1/merchants \
  -H "Content-Type: application/json" \
  -H "x-payment-orchestration-service-token: $TOKEN" \
  -d '{"name":"Warung Demo","sourceApp":"consumer-a","externalRef":"tenant-demo-001"}' | jq .
```

**Save the `id` field** as `MERCHANT_ID`.

## Step 3 — Create Provider Account (FakeGateway)

```bash
curl -s -X POST $BASE_URL/v1/merchants/$MERCHANT_ID/provider-accounts \
  -H "Content-Type: application/json" \
  -H "x-payment-orchestration-service-token: $TOKEN" \
  -d '{"provider":"fake_gateway","environment":"sandbox"}' | jq .
```

## Step 4 — Create Payment Intent

```bash
curl -s -X POST $BASE_URL/v1/payment-intents \
  -H "Content-Type: application/json" \
  -H "x-payment-orchestration-service-token: $TOKEN" \
  -d "{
    \"merchantId\": \"$MERCHANT_ID\",
    \"externalPayableType\": \"order\",
    \"externalPayableId\": \"order-demo-001\",
    \"currency\": \"IDR\",
    \"amountDue\": 100000
  }" | jq .
```

**Save the `id` field** as `INTENT_ID`.

## Step 5a — Gateway Payment (QRIS — requires_action)

```bash
curl -s -X POST $BASE_URL/v1/payment-intents/$INTENT_ID/gateway-payments \
  -H "Content-Type: application/json" \
  -H "x-payment-orchestration-service-token: $TOKEN" \
  -d "{
    \"merchantId\": \"$MERCHANT_ID\",
    \"provider\": \"fake_gateway\",
    \"method\": \"qris\",
    \"amount\": 100000,
    \"metadata\": {\"scenario\": \"qris\"}
  }" | jq .
```

**Save `data.transaction.id`** as `TX_ID`. Status should be `requires_action`.

## Step 5b — Confirm FakeGateway Payment (dev only)

```bash
curl -s -X POST $BASE_URL/v1/dev/fake-gateway/transactions/$TX_ID/confirm \
  -H "Content-Type: application/json" \
  -H "x-payment-orchestration-service-token: $TOKEN" \
  -d "{\"merchantId\": \"$MERCHANT_ID\"}" | jq .
```

Expected: `data.transaction.status = "succeeded"`, `data.intent.status = "paid"`.

## Step 6 — Poll Intent Status

```bash
curl -s "$BASE_URL/v1/payment-intents/$INTENT_ID/status?merchantId=$MERCHANT_ID" \
  -H "x-payment-orchestration-service-token: $TOKEN" | jq .
```

Expected: `data.intent.status = "paid"`, `isTerminal = true`, `canRetryPayment = false`.

## Step 7 — Check Refundability

```bash
curl -s "$BASE_URL/v1/payment-intents/$INTENT_ID/refundability?merchantId=$MERCHANT_ID" \
  -H "x-payment-orchestration-service-token: $TOKEN" | jq .
```

Expected: `data.totalRefundable = 100000`.

## Alternative: Immediate Success Scenario

Use `"metadata": {"scenario": "immediate_success"}` in Step 5a.
No confirmation step needed — intent transitions to `paid` immediately.

## Scenario Reference

| scenario           | Transaction status | Intent after TX | Confirm needed? |
|--------------------|--------------------|-----------------|-----------------|
| qris (default)     | requires_action    | requires_payment| ✅ Yes           |
| immediate_success  | succeeded          | paid            | ❌ No            |
| immediate_failure  | failed             | requires_payment| ❌ No            |
| redirect           | requires_action    | requires_payment| ✅ Yes           |
| va                 | requires_action    | requires_payment| ✅ Yes           |
| payment_code       | requires_action    | requires_payment| ✅ Yes           |
| pending_expiry     | requires_action    | requires_payment| ✅ Yes           |
