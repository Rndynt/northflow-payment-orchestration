import { createHmac, timingSafeEqual } from 'crypto';

export function buildMerchantWebhookSigningString(input: { timestamp: string; eventId: string; deliveryId: string; rawJsonBody: string }): string {
  return `${input.timestamp}.${input.eventId}.${input.deliveryId}.${input.rawJsonBody}`;
}

export function signMerchantWebhook(input: { secret: string; timestamp: string; eventId: string; deliveryId: string; rawJsonBody: string }): string {
  return createHmac('sha256', input.secret).update(buildMerchantWebhookSigningString(input)).digest('hex');
}

export function verifyMerchantWebhookSignature(input: { secret: string; signature: string; timestamp: string; eventId: string; deliveryId: string; rawJsonBody: string }): boolean {
  const expected = Buffer.from(signMerchantWebhook(input), 'hex');
  const received = Buffer.from(input.signature, 'hex');
  return expected.length === received.length && timingSafeEqual(expected, received);
}
