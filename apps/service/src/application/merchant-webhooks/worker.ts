import type { MerchantWebhookDeliveryRepository, MerchantWebhookEndpointRepository, MerchantWebhookEventRepository } from '@northflow/payment-orchestration-core';
import { signMerchantWebhook } from './signing.ts';
import { decrypt } from '../../security/signingSecretProtector.ts';

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ status: number; text(): Promise<string> }>;

const BACKOFF_MS = [0, 60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];

export class DeliverMerchantWebhooks {
  constructor(
    private readonly endpointRepo: MerchantWebhookEndpointRepository,
    private readonly eventRepo: MerchantWebhookEventRepository,
    private readonly deliveryRepo: MerchantWebhookDeliveryRepository,
    private readonly options: { timeoutMs: number; responseBodyLimit: number; fetchImpl?: FetchLike },
  ) {}

  async execute(input: { now?: Date; limit?: number } = {}) {
    const now = input.now ?? new Date();
    const deliveries = await this.deliveryRepo.claimDue({ now, limit: input.limit ?? 25 });
    const results = [];
    for (const delivery of deliveries) {
      const event = await this.eventRepo.findById(delivery.eventId, delivery.merchantId);
      const endpoint = await this.endpointRepo.findById(delivery.endpointId, delivery.merchantId);
      if (!event || !endpoint || endpoint.status !== 'active') {
        results.push(await this.fail(delivery, 'Webhook event or active endpoint not found.', null, null, now));
        continue;
      }
      const rawJsonBody = JSON.stringify(event.payload);
      const timestamp = String(now.getTime());
      const rawSecret = decrypt(endpoint.secretHash);
      const signature = signMerchantWebhook({ secret: rawSecret, timestamp, eventId: event.id, deliveryId: delivery.id, rawJsonBody });
      try {
        new URL(endpoint.url);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
        const response = await (this.options.fetchImpl ?? fetch)(endpoint.url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'user-agent': 'Northflow-Webhook/1.0',
            'x-nf-webhook-id': event.id,
            'x-nf-webhook-delivery-id': delivery.id,
            'x-nf-webhook-type': event.eventType,
            'x-nf-webhook-timestamp': timestamp,
            'x-nf-webhook-signature': signature,
            'x-nf-webhook-signature-version': 'v1',
          },
          body: rawJsonBody,
          signal: controller.signal,
        } as any);
        clearTimeout(timer);
        const body = truncate(await response.text(), this.options.responseBodyLimit);
        if (response.status >= 200 && response.status < 300) {
          results.push(await this.deliveryRepo.markSucceeded({ id: delivery.id, merchantId: delivery.merchantId, responseStatus: response.status, responseBodyTruncated: body, now }));
        } else {
          results.push(await this.fail(delivery, `Merchant endpoint returned HTTP ${response.status}.`, response.status, body, now));
        }
      } catch (err) {
        results.push(await this.fail(delivery, err instanceof Error ? err.message : String(err), null, null, now));
      }
    }
    return { processed: results.length, deliveries: results };
  }

  private async fail(delivery: any, error: string, status: number | null, body: string | null, now: Date) {
    if (delivery.attemptCount >= delivery.maxAttempts) {
      return this.deliveryRepo.markDead({ id: delivery.id, merchantId: delivery.merchantId, responseStatus: status, responseBodyTruncated: body, error, now });
    }
    const backoff = BACKOFF_MS[Math.min(delivery.attemptCount, BACKOFF_MS.length - 1)] ?? BACKOFF_MS.at(-1)!;
    return this.deliveryRepo.markFailed({ id: delivery.id, merchantId: delivery.merchantId, responseStatus: status, responseBodyTruncated: body, error, nextAttemptAt: new Date(now.getTime() + backoff), now });
  }
}

export function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : value.slice(0, limit);
}
