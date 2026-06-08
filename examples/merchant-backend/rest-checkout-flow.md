# REST Checkout Flow

Run these commands from a merchant backend or backend-only operational shell.

```bash
curl -X POST "$NORTHFLOW_BASE_URL/v1/payment-intents" \
  -H "Authorization: Bearer $NORTHFLOW_API_KEY" \
  -H "x-payment-merchant-id: $NORTHFLOW_MERCHANT_ID" \
  -H "x-source-app: $NORTHFLOW_SOURCE_APP" \
  -H "Content-Type: application/json" \
  -d '{"merchantId":"mer_xxx","sourceApp":"checkout-backend","externalPayableType":"order","externalPayableId":"order_123","currency":"IDR","amountDue":125000,"idempotencyKey":"order:order_123:intent"}'

curl "$NORTHFLOW_BASE_URL/v1/payment-intents/pi_xxx/payment-options" \
  -H "Authorization: Bearer $NORTHFLOW_API_KEY" \
  -H "x-payment-merchant-id: $NORTHFLOW_MERCHANT_ID" \
  -H "x-source-app: $NORTHFLOW_SOURCE_APP"

curl -X POST "$NORTHFLOW_BASE_URL/v1/payment-intents/pi_xxx/gateway-payments" \
  -H "Authorization: Bearer $NORTHFLOW_API_KEY" \
  -H "x-payment-merchant-id: $NORTHFLOW_MERCHANT_ID" \
  -H "x-source-app: $NORTHFLOW_SOURCE_APP" \
  -H "Content-Type: application/json" \
  -d '{"merchantId":"mer_xxx","provider":"fake_gateway","providerAccountId":"pa_xxx","method":"qris","amount":125000,"idempotencyKey":"order:order_123:payment:qris"}'
```
