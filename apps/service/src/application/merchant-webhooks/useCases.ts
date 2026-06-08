import { randomUUID } from 'crypto';
import type { MerchantWebhookEndpointRepository, MerchantWebhookDeliveryRepository, MerchantWebhookEventRepository, MerchantWebhookEventType } from '@northflow/payment-orchestration-core';
import { generateMerchantWebhookSecret } from './secret.ts';
import { encrypt } from '../../security/signingSecretProtector.ts';
import { MERCHANT_WEBHOOK_EVENT_TYPES } from './events.ts';

function validateUrl(url: string): void {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Webhook endpoint URL must be http or https.');
}
function events(input: unknown): MerchantWebhookEventType[] {
  const values = Array.isArray(input) && input.length > 0 ? input : MERCHANT_WEBHOOK_EVENT_TYPES;
  for (const value of values) if (!MERCHANT_WEBHOOK_EVENT_TYPES.includes(value as MerchantWebhookEventType)) throw new Error(`Unsupported webhook event type: ${String(value)}`);
  return values as MerchantWebhookEventType[];
}
function publicEndpoint(endpoint: any) {
  const { secretHash: _secretHash, ...rest } = endpoint;
  return rest;
}

export class CreateMerchantWebhookEndpoint {
  constructor(private readonly endpointRepo: MerchantWebhookEndpointRepository) {}
  async execute(input: { merchantId: string; url: string; subscribedEvents?: unknown; metadata?: Record<string, unknown> | null }) {
    validateUrl(input.url);
    const secret = generateMerchantWebhookSecret();
    const endpoint = await this.endpointRepo.create({
      id: `mwe_${randomUUID()}`,
      merchantId: input.merchantId,
      url: input.url,
      subscribedEvents: events(input.subscribedEvents),
      secretHash: encrypt(secret.rawSecret),
      secretPrefix: secret.secretPrefix,
      metadata: input.metadata ?? {},
    });
    return { endpoint: publicEndpoint(endpoint), rawSecret: secret.rawSecret };
  }
}
export class ListMerchantWebhookEndpoints {
  constructor(private readonly endpointRepo: MerchantWebhookEndpointRepository) {}
  async execute(input: { merchantId: string }) { return { endpoints: (await this.endpointRepo.listByMerchant(input.merchantId)).map(publicEndpoint) }; }
}
export class DisableMerchantWebhookEndpoint {
  constructor(private readonly endpointRepo: MerchantWebhookEndpointRepository) {}
  async execute(input: { merchantId: string; endpointId: string }) { return { endpoint: publicEndpoint(await this.endpointRepo.updateStatus({ id: input.endpointId, merchantId: input.merchantId, status: 'disabled', disabledAt: new Date() })) }; }
}
export class RotateMerchantWebhookEndpointSecret {
  constructor(private readonly endpointRepo: MerchantWebhookEndpointRepository) {}
  async execute(input: { merchantId: string; endpointId: string }) {
    const secret = generateMerchantWebhookSecret();
    const endpoint = await this.endpointRepo.updateSecret({ id: input.endpointId, merchantId: input.merchantId, secretHash: encrypt(secret.rawSecret), secretPrefix: secret.secretPrefix });
    return { endpoint: publicEndpoint(endpoint), rawSecret: secret.rawSecret };
  }
}
export class ListMerchantWebhookDeliveries {
  constructor(private readonly deliveryRepo: MerchantWebhookDeliveryRepository) {}
  async execute(input: { merchantId: string; endpointId?: string | null; limit?: number }) { return { deliveries: await this.deliveryRepo.listByMerchant(input) }; }
}
export class ReplayMerchantWebhookDeliveryOrEvent {
  constructor(private readonly eventRepo: MerchantWebhookEventRepository, private readonly endpointRepo: MerchantWebhookEndpointRepository, private readonly deliveryRepo: MerchantWebhookDeliveryRepository, private readonly maxAttempts: number) {}
  async execute(input: { merchantId: string; deliveryId?: string | null; eventId?: string | null }) {
    if (input.deliveryId) return { delivery: await this.deliveryRepo.requeue({ id: input.deliveryId, merchantId: input.merchantId }) };
    if (!input.eventId) throw new Error('deliveryId or eventId is required.');
    const event = await this.eventRepo.findById(input.eventId, input.merchantId);
    if (!event) throw new Error(`Merchant webhook event not found: ${input.eventId}`);
    const endpoints = await this.endpointRepo.listActiveByMerchantAndEvent(input.merchantId, event.eventType);
    const deliveries = [];
    for (const endpoint of endpoints) {
      deliveries.push(await this.deliveryRepo.create({ id: `del_${randomUUID()}`, eventId: event.id, endpointId: endpoint.id, merchantId: input.merchantId, maxAttempts: this.maxAttempts }));
    }
    return { deliveries };
  }
}
