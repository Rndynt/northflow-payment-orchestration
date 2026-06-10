# Northflow Client Integration Contract

This contract freezes the generic merchant backend integration model for SDK and REST consumers.

## Identity model

| Concept | Northflow entity |
| --- | --- |
| Merchant backend environment | API client credential |
| Payment owner | Merchant |
| Local payable | `externalPayableType` + `externalPayableId` |

One merchant backend environment should use one API client credential. One business or payment owner should map to one Northflow merchant.

## Authentication

Use a per-client API credential in backend-only code:

```http
Authorization: Bearer nf.<env>.<credentialId>.<secret>
x-payment-merchant-id: <merchantId>
x-source-app: <sourceApp>
```

The legacy service-token header is for controlled internal/development use only and should not be used for new merchant integrations.

## Required backend boundary

```txt
frontend -> merchant backend -> Northflow
```

Frontend clients must never receive Northflow API keys, raw signing secrets, provider credentials, database URLs, service tokens, or webhook secrets.

## Common request fields

| Field | Purpose |
| --- | --- |
| `merchantId` | Merchant ownership boundary. |
| `sourceApp` | Merchant backend identifier. |
| `externalTenantId` | Optional merchant-side tenant identifier. |
| `externalOutletId` | Optional merchant-side outlet identifier. |
| `externalPayableType` | Local payable type such as order or invoice. |
| `externalPayableId` | Local payable identifier. |
| `provider` | Provider adapter code. |
| `method` | Provider account method returned by payment options. |
| `providerAccountId` | Provider account selected from payment options. |
| `idempotencyKey` | Stable retry key for mutation operations. |

## Idempotency key examples

```txt
order:<orderId>:intent
order:<orderId>:payment:<method>
refund:<transactionId>:<amount>
void:<transactionId>
```

## Official SDK method names

- `createPaymentIntent`
- `getPaymentIntentStatus`
- `getRefundability`
- `createGatewayPayment`
- `refreshProviderStatus`
- `getPaymentOptions`
- `refundPaymentTransaction`
- `voidPaymentTransaction`
- `reconcilePaymentIntentTotals`
- `createMerchant`
- `getMerchant`
- `createProviderAccount`
- `getProviderAccount`
- `listProviderAccountMethods`
- `upsertProviderAccountMethod`
- `syncProviderAccountMethods`
- `createSigningKey`
- `listSigningKeys`
- `rotateSigningKey`
- `revokeSigningKey`
- `createMerchantWebhookEndpoint`
- `listMerchantWebhookEndpoints`
- `disableMerchantWebhookEndpoint`
- `rotateMerchantWebhookEndpointSecret`
- `listMerchantWebhookDeliveries`
- `replayMerchantWebhook`
- `confirmFakeGatewayPayment`
- `getReadiness`

## REST route families

Payment Intents & Transactions:
- `/v1/payment-intents`
- `/v1/payment-intents/:id/status`
- `/v1/payment-intents/:id/refundability`
- `/v1/payment-intents/:id/gateway-payments`
- `/v1/payment-intents/:id/reconcile`
- `/v1/payment-intents/:intentId/payment-options`
- `/v1/payment-transactions/:id/refresh-provider-status`
- `/v1/payment-transactions/:id/refund`
- `/v1/payment-transactions/:id/void`

Merchants & Provider Accounts:
- `/v1/merchants`
- `/v1/merchants/:id`
- `/v1/merchants/:merchantId/provider-accounts`
- `/v1/merchants/:merchantId/provider-accounts/:id`
- `/v1/merchants/:merchantId/provider-accounts/:providerAccountId/methods`
- `/v1/merchants/:merchantId/provider-accounts/:providerAccountId/methods/:method`
- `/v1/merchants/:merchantId/provider-accounts/:providerAccountId/methods/sync`
- `/v1/merchants/:merchantId/payment-methods`

Merchant Outbound Webhooks (S10.3):
- `/v1/merchants/:merchantId/webhooks/endpoints`
- `/v1/merchants/:merchantId/webhooks/endpoints/:endpointId/disable`
- `/v1/merchants/:merchantId/webhooks/endpoints/:endpointId/rotate-secret`
- `/v1/merchants/:merchantId/webhooks/deliveries`
- `/v1/merchants/:merchantId/webhooks/replay`

API Client Key Management:
- `/v1/api-clients/:clientId/signing-keys`
- `/v1/api-clients/:clientId/signing-keys/rotate`
- `/v1/api-clients/:clientId/signing-keys/:signingKeyId/revoke`
- `/v1/api-clients/:clientId/credentials`
- `/v1/api-clients/:clientId/credentials/rotate`
- `/v1/api-clients/:clientId/credentials/:credentialId/revoke`

Audit & Health:
- `/v1/audit-logs`
- `/health`
- `/version`
- `/ready`

## Current status model

Intent statuses are `requires_payment`, `partially_paid`, `paid`, `overpaid`, `refunded`, `voided`, `expired`, `cancelled`, and `failed`.

## Payment options

Render options returned by Northflow. Do not hardcode unsupported payment methods in the merchant frontend.

## Webhooks

Provider webhooks update Northflow. Merchant outbound webhook/callback delivery is available in S10.3 for backend-to-backend event delivery; polling remains supported.
