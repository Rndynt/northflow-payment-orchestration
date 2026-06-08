# REST Quickstart

Call Northflow only from a merchant backend.

## Required headers

```http
Authorization: Bearer <NORTHFLOW_API_KEY>
x-payment-merchant-id: <merchantId>
x-source-app: <sourceApp>
Content-Type: application/json
```

Signed request headers (`x-nf-client-id`, `x-nf-key-id`, `x-nf-timestamp`, `x-nf-nonce`, `x-nf-signature`, `x-nf-signature-version`) are optional or required depending on Northflow service configuration.

## Create payment intent

```bash
curl -X POST "$NORTHFLOW_BASE_URL/v1/payment-intents" \
  -H "Authorization: Bearer $NORTHFLOW_API_KEY" \
  -H "x-payment-merchant-id: $NORTHFLOW_MERCHANT_ID" \
  -H "x-source-app: $NORTHFLOW_SOURCE_APP" \
  -H "Content-Type: application/json" \
  -d '{"merchantId":"mer_xxx","sourceApp":"checkout-backend","externalPayableType":"order","externalPayableId":"order_123","currency":"IDR","amountDue":125000,"idempotencyKey":"order:order_123:intent"}'
```

## Get payment options

```bash
curl "$NORTHFLOW_BASE_URL/v1/payment-intents/pi_xxx/payment-options" \
  -H "Authorization: Bearer $NORTHFLOW_API_KEY" \
  -H "x-payment-merchant-id: $NORTHFLOW_MERCHANT_ID" \
  -H "x-source-app: $NORTHFLOW_SOURCE_APP"
```

## Create gateway payment

```bash
curl -X POST "$NORTHFLOW_BASE_URL/v1/payment-intents/pi_xxx/gateway-payments" \
  -H "Authorization: Bearer $NORTHFLOW_API_KEY" \
  -H "x-payment-merchant-id: $NORTHFLOW_MERCHANT_ID" \
  -H "x-source-app: $NORTHFLOW_SOURCE_APP" \
  -H "Content-Type: application/json" \
  -d '{"merchantId":"mer_xxx","provider":"fake_gateway","providerAccountId":"pa_xxx","method":"qris","amount":125000,"idempotencyKey":"order:order_123:payment:qris"}'
```

## Get intent status

```bash
curl "$NORTHFLOW_BASE_URL/v1/payment-intents/pi_xxx/status" \
  -H "Authorization: Bearer $NORTHFLOW_API_KEY" \
  -H "x-payment-merchant-id: $NORTHFLOW_MERCHANT_ID" \
  -H "x-source-app: $NORTHFLOW_SOURCE_APP"
```

## Get refundability

```bash
curl "$NORTHFLOW_BASE_URL/v1/payment-intents/pi_xxx/refundability" \
  -H "Authorization: Bearer $NORTHFLOW_API_KEY" \
  -H "x-payment-merchant-id: $NORTHFLOW_MERCHANT_ID" \
  -H "x-source-app: $NORTHFLOW_SOURCE_APP"
```

## Refund payment transaction

```bash
curl -X POST "$NORTHFLOW_BASE_URL/v1/payment-transactions/tx_xxx/refund" \
  -H "Authorization: Bearer $NORTHFLOW_API_KEY" \
  -H "x-payment-merchant-id: $NORTHFLOW_MERCHANT_ID" \
  -H "x-source-app: $NORTHFLOW_SOURCE_APP" \
  -H "Content-Type: application/json" \
  -d '{"merchantId":"mer_xxx","amount":125000,"reason":"merchant-requested","idempotencyKey":"refund:tx_xxx:125000"}'
```

## Void payment transaction

```bash
curl -X POST "$NORTHFLOW_BASE_URL/v1/payment-transactions/tx_xxx/void" \
  -H "Authorization: Bearer $NORTHFLOW_API_KEY" \
  -H "x-payment-merchant-id: $NORTHFLOW_MERCHANT_ID" \
  -H "x-source-app: $NORTHFLOW_SOURCE_APP" \
  -H "Content-Type: application/json" \
  -d '{"merchantId":"mer_xxx","reason":"customer-cancelled","idempotencyKey":"void:tx_xxx"}'
```
