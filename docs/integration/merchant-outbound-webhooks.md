# Merchant outbound webhooks

Northflow can deliver merchant-facing outbound callbacks after provider webhooks, fake-gateway confirmations, refunds, voids, or status workers change payment state. Polling remains supported; outbound webhooks are an event-driven complement for merchant backends.

## Setup

Create an endpoint from a backend/admin context only:

```http
POST /v1/merchants/{merchantId}/webhooks/endpoints
```

The response returns `rawSecret` once. Store it in a backend secret manager. List responses, delivery logs, and rotations expose only `secretPrefix` metadata and never the raw secret.

## Payload envelope

```json
{
  "id": "evt_xxx",
  "type": "payment_intent.paid",
  "createdAt": "2026-06-08T00:00:00.000Z",
  "merchantId": "mer_xxx",
  "resource": { "type": "payment_intent", "id": "pi_xxx" },
  "data": { "intent": {}, "transaction": null }
}
```

Implemented event types:

- `payment_intent.requires_payment`
- `payment_intent.partially_paid`
- `payment_intent.paid` (`overpaid` maps to this conservative paid event)
- `payment_intent.failed`
- `payment_intent.expired`
- `payment_intent.cancelled`
- `payment_intent.refunded`
- `payment_intent.voided`
- `payment_transaction.requires_action`
- `payment_transaction.succeeded`
- `payment_transaction.failed`
- `payment_transaction.cancelled`
- `payment_transaction.refunded`
- `payment_transaction.voided`

## Delivery and retry

Northflow sends backend-to-backend HTTP `POST` requests with `Content-Type: application/json` and `User-Agent: Northflow-Webhook/1.0`. Any HTTP 2xx is success. Network errors, timeouts, invalid URLs, disabled endpoints, and non-2xx responses fail the attempt.

Retry schedule: immediate worker tick, +1 minute, +5 minutes, +15 minutes, +1 hour, then `dead` after max attempts. Response bodies are truncated before storage.

Run due deliveries manually:

```bash
pnpm --filter @northflow/payment-orchestration-service worker deliver-merchant-webhooks --limit 25
```

Replay one delivery or event:

```http
POST /v1/merchants/{merchantId}/webhooks/replay
```

Body: `{ "deliveryId": "del_xxx" }` or `{ "eventId": "evt_xxx" }`.

## Local testing

Use `manual` or `fake_gateway` provider flows from a merchant backend or API client. Do not put webhook secrets in frontend, public, or browser-exposed environment variables.
