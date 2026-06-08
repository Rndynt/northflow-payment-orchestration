import { randomUUID } from 'crypto';
import type { MerchantWebhookEventType, PaymentIntentDTO, PaymentTransactionDTO, MerchantWebhookEventRepository, MerchantWebhookEndpointRepository, MerchantWebhookDeliveryRepository } from '@northflow/payment-orchestration-core';

export const MERCHANT_WEBHOOK_EVENT_TYPES: MerchantWebhookEventType[] = [
  'payment_intent.requires_payment', 'payment_intent.partially_paid', 'payment_intent.paid', 'payment_intent.failed', 'payment_intent.expired', 'payment_intent.cancelled', 'payment_intent.refunded', 'payment_intent.voided',
  'payment_transaction.requires_action', 'payment_transaction.succeeded', 'payment_transaction.failed', 'payment_transaction.cancelled', 'payment_transaction.refunded', 'payment_transaction.voided',
];

export function eventTypeForIntentStatus(status: PaymentIntentDTO['status']): MerchantWebhookEventType | null {
  if (status === 'overpaid') return 'payment_intent.paid';
  if (['requires_payment', 'partially_paid', 'paid', 'failed', 'expired', 'cancelled', 'refunded', 'voided'].includes(status)) return `payment_intent.${status}` as MerchantWebhookEventType;
  return null;
}

export function eventTypeForTransactionStatus(status: PaymentTransactionDTO['status']): MerchantWebhookEventType | null {
  if (status === 'requires_action' || status === 'succeeded' || status === 'failed' || status === 'cancelled' || status === 'refunded' || status === 'voided') {
    return `payment_transaction.${status}` as MerchantWebhookEventType;
  }
  return null;
}

export class MerchantWebhookOutbox {
  constructor(
    private readonly endpointRepo: MerchantWebhookEndpointRepository,
    private readonly eventRepo: MerchantWebhookEventRepository,
    private readonly deliveryRepo: MerchantWebhookDeliveryRepository,
    private readonly options: { enabled: boolean; maxAttempts: number },
  ) {}

  async emitIntentStatus(input: { intent: PaymentIntentDTO; transaction?: PaymentTransactionDTO | null; dedupeSuffix?: string | null }): Promise<void> {
    const eventType = eventTypeForIntentStatus(input.intent.status);
    if (!eventType) return;
    await this.emit({ eventType, intent: input.intent, transaction: input.transaction ?? null, resourceType: 'payment_intent', resourceId: input.intent.id, dedupeKey: `intent:${input.intent.id}:${eventType}:${input.dedupeSuffix ?? input.intent.updatedAt.toISOString()}` });
  }

  async emitTransactionStatus(input: { transaction: PaymentTransactionDTO; intent?: PaymentIntentDTO | null; dedupeSuffix?: string | null }): Promise<void> {
    const eventType = eventTypeForTransactionStatus(input.transaction.status);
    if (!eventType) return;
    await this.emit({ eventType, intent: input.intent ?? null, transaction: input.transaction, resourceType: 'payment_transaction', resourceId: input.transaction.id, dedupeKey: `transaction:${input.transaction.id}:${eventType}:${input.dedupeSuffix ?? input.transaction.updatedAt.toISOString()}` });
  }

  private async emit(input: { eventType: MerchantWebhookEventType; intent: PaymentIntentDTO | null; transaction: PaymentTransactionDTO | null; resourceType: 'payment_intent' | 'payment_transaction'; resourceId: string; dedupeKey: string }): Promise<void> {
    if (!this.options.enabled) return;
    const merchantId = input.intent?.merchantId ?? input.transaction?.merchantId;
    if (!merchantId) return;
    const endpoints = await this.endpointRepo.listActiveByMerchantAndEvent(merchantId, input.eventType);
    if (endpoints.length === 0) return;
    const eventId = `evt_${randomUUID()}`;
    const createdAt = new Date();
    const payload = {
      id: eventId,
      type: input.eventType,
      createdAt: createdAt.toISOString(),
      merchantId,
      resource: { type: input.resourceType, id: input.resourceId },
      data: { intent: input.intent, transaction: input.transaction },
    };
    const result = await this.eventRepo.createOrGet({ id: eventId, merchantId, eventType: input.eventType, resourceType: input.resourceType, resourceId: input.resourceId, payload, dedupeKey: input.dedupeKey });
    if (!result.created) return;
    for (const endpoint of endpoints) {
      const existing = await this.deliveryRepo.findByEventAndEndpoint(result.event.id, endpoint.id);
      if (!existing) await this.deliveryRepo.create({ id: `del_${randomUUID()}`, eventId: result.event.id, endpointId: endpoint.id, merchantId, maxAttempts: this.options.maxAttempts });
    }
  }
}
