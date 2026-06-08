# Merchant webhook signature verification

Merchant outbound webhook signing is separate from provider webhook verification and separate from Northflow inbound API HMAC request signing.

## Headers

- `x-nf-webhook-id`
- `x-nf-webhook-delivery-id`
- `x-nf-webhook-type`
- `x-nf-webhook-timestamp`
- `x-nf-webhook-signature`
- `x-nf-webhook-signature-version: v1`

## Canonical signing string

```txt
<timestamp>.<eventId>.<deliveryId>.<rawJsonBody>
```

The signature is lowercase hex HMAC-SHA256 using the endpoint secret returned once on create or rotate.

## Endpoint administration authorization

Webhook endpoint administration is a backend/admin API operation. The API client must have merchant access for the target `merchantId` plus `webhook:manage` to create endpoints, disable endpoints, rotate endpoint secrets, or replay deliveries/events. Use `webhook:read` to list endpoints or delivery logs.

## TypeScript verification example

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifyNorthflowWebhook(input: {
  rawBody: string;
  secret: string;
  timestamp: string;
  eventId: string;
  deliveryId: string;
  signature: string;
}): boolean {
  const signingString = `${input.timestamp}.${input.eventId}.${input.deliveryId}.${input.rawBody}`;
  const expected = Buffer.from(
    createHmac('sha256', input.secret).update(signingString).digest('hex'),
    'hex',
  );
  const received = Buffer.from(input.signature, 'hex');
  return expected.length === received.length && timingSafeEqual(expected, received);
}
```

Use the raw request body bytes/string exactly as received. Store the secret only in backend secret storage; never expose it to frontend or public environment variables.
