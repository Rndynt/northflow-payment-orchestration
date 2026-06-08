import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { signMerchantWebhook, verifyMerchantWebhookSignature } from '../apps/service/src/application/merchant-webhooks/signing.ts';
import { MerchantWebhookOutbox } from '../apps/service/src/application/merchant-webhooks/events.ts';
import { DeliverMerchantWebhooks } from '../apps/service/src/application/merchant-webhooks/worker.ts';
import { DrizzleMerchantWebhookDeliveryRepository } from '../apps/service/src/infrastructure/repositories/DrizzleMerchantWebhookDeliveryRepository.ts';
import type { MerchantWebhookDeliveryDTO, MerchantWebhookEndpointDTO, MerchantWebhookEventDTO } from '@northflow/payment-orchestration-core';

process.env['PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_SECRET'] = '12345678901234567890123456789012';

class EndpointRepo {
  rows: MerchantWebhookEndpointDTO[] = [];
  async create(input: any) { const row = { ...input, status: 'active', metadata: input.metadata ?? {}, createdAt: new Date(), updatedAt: new Date(), disabledAt: null }; this.rows.push(row); return row; }
  async findById(id: string, merchantId: string) { return this.rows.find((r) => r.id === id && r.merchantId === merchantId) ?? null; }
  async listByMerchant(merchantId: string) { return this.rows.filter((r) => r.merchantId === merchantId); }
  async listActiveByMerchantAndEvent(merchantId: string, eventType: any) { return this.rows.filter((r) => r.merchantId === merchantId && r.status === 'active' && r.subscribedEvents.includes(eventType)); }
  async updateSecret(input: any) { const row = await this.findById(input.id, input.merchantId); Object.assign(row!, input, { updatedAt: new Date() }); return row!; }
  async updateStatus(input: any) { const row = await this.findById(input.id, input.merchantId); Object.assign(row!, { status: input.status, disabledAt: input.disabledAt ?? null, updatedAt: new Date() }); return row!; }
}
class EventRepo {
  rows: MerchantWebhookEventDTO[] = [];
  async createOrGet(input: any) { const existing = this.rows.find((r) => r.merchantId === input.merchantId && r.dedupeKey === input.dedupeKey); if (existing) return { event: existing, created: false }; const row = { ...input, createdAt: new Date() }; this.rows.push(row); return { event: row, created: true }; }
  async findById(id: string, merchantId: string) { return this.rows.find((r) => r.id === id && r.merchantId === merchantId) ?? null; }
}
class DeliveryRepo {
  rows: MerchantWebhookDeliveryDTO[] = [];
  async create(input: any) { const now = new Date(); const row = { ...input, status: 'queued', attemptCount: 0, nextAttemptAt: input.nextAttemptAt ?? now, lastAttemptAt: null, lastResponseStatus: null, lastResponseBodyTruncated: null, lastError: null, createdAt: now, updatedAt: now, deliveredAt: null }; this.rows.push(row); return row; }
  async findById(id: string, merchantId: string) { return this.rows.find((r) => r.id === id && r.merchantId === merchantId) ?? null; }
  async listByMerchant(input: any) { return this.rows.filter((r) => r.merchantId === input.merchantId && (!input.endpointId || r.endpointId === input.endpointId)); }
  async findByEventAndEndpoint(eventId: string, endpointId: string) { return this.rows.find((r) => r.eventId === eventId && r.endpointId === endpointId) ?? null; }
  async claimDue(input: any) { return this.rows.filter((r) => ['queued', 'failed'].includes(r.status) && r.nextAttemptAt <= input.now).slice(0, input.limit).map((r) => Object.assign(r, { status: 'delivering', attemptCount: r.attemptCount + 1, lastAttemptAt: input.now })); }
  async markSucceeded(input: any) { const r = (await this.findById(input.id, input.merchantId))!; return Object.assign(r, { status: 'succeeded', lastResponseStatus: input.responseStatus, lastResponseBodyTruncated: input.responseBodyTruncated, deliveredAt: input.now }); }
  async markFailed(input: any) { const r = (await this.findById(input.id, input.merchantId))!; return Object.assign(r, { status: 'failed', lastResponseStatus: input.responseStatus ?? null, lastResponseBodyTruncated: input.responseBodyTruncated ?? null, lastError: input.error ?? null, nextAttemptAt: input.nextAttemptAt }); }
  async markDead(input: any) { const r = (await this.findById(input.id, input.merchantId))!; return Object.assign(r, { status: 'dead', lastError: input.error ?? null }); }
  async requeue(input: any) { const r = (await this.findById(input.id, input.merchantId))!; return Object.assign(r, { status: 'queued', nextAttemptAt: input.nextAttemptAt ?? new Date() }); }
}

const intent: any = { id: 'pi_1', merchantId: 'mer_1', status: 'paid', updatedAt: new Date('2026-06-08T00:00:00.000Z') };
const tx: any = { id: 'tx_1', merchantId: 'mer_1', intentId: 'pi_1', status: 'succeeded', updatedAt: new Date('2026-06-08T00:00:00.000Z') };

test('signature generation is deterministic and verifiable', () => {
  const input = { secret: 'nfwhsec_test', timestamp: '1791417600000', eventId: 'evt_1', deliveryId: 'del_1', rawJsonBody: '{"ok":true}' };
  assert.equal(signMerchantWebhook(input), signMerchantWebhook(input));
  assert.equal(verifyMerchantWebhookSignature({ ...input, signature: signMerchantWebhook(input) }), true);
});

test('outbox creates stable envelope, skips disabled endpoints, and dedupes transitions', async () => {
  const endpoints = new EndpointRepo(); const events = new EventRepo(); const deliveries = new DeliveryRepo();
  await endpoints.create({ id: 'mwe_1', merchantId: 'mer_1', url: 'https://merchant.example/webhook', subscribedEvents: ['payment_intent.paid'], secretHash: 'cipher', secretPrefix: 'nfwhsec_' });
  await endpoints.create({ id: 'mwe_2', merchantId: 'mer_1', url: 'https://merchant.example/disabled', subscribedEvents: ['payment_intent.paid'], secretHash: 'cipher', secretPrefix: 'nfwhsec_', status: 'disabled' });
  await endpoints.updateStatus({ id: 'mwe_2', merchantId: 'mer_1', status: 'disabled', disabledAt: new Date() });
  const outbox = new MerchantWebhookOutbox(endpoints as any, events as any, deliveries as any, { enabled: true, maxAttempts: 5 });
  await outbox.emitIntentStatus({ intent, transaction: tx, dedupeSuffix: 'same' });
  await outbox.emitIntentStatus({ intent, transaction: tx, dedupeSuffix: 'same' });
  assert.equal(events.rows.length, 1);
  assert.equal(deliveries.rows.length, 1);
  assert.equal(events.rows[0]!.payload.type, 'payment_intent.paid');
  assert.deepEqual(events.rows[0]!.payload.resource, { type: 'payment_intent', id: 'pi_1' });
});

test('delivery worker succeeds, retries non-2xx, marks dead, and truncates response bodies', async () => {
  const endpoints = new EndpointRepo(); const events = new EventRepo(); const deliveries = new DeliveryRepo();
  const { encrypt } = await import('../apps/service/src/security/signingSecretProtector.ts');
  await endpoints.create({ id: 'mwe_1', merchantId: 'mer_1', url: 'https://merchant.example/webhook', subscribedEvents: ['payment_intent.paid'], secretHash: encrypt('nfwhsec_test'), secretPrefix: 'nfwhsec_' });
  const event = (await events.createOrGet({ id: 'evt_1', merchantId: 'mer_1', eventType: 'payment_intent.paid', resourceType: 'payment_intent', resourceId: 'pi_1', payload: { id: 'evt_1', type: 'payment_intent.paid', createdAt: '2026-06-08T00:00:00.000Z', merchantId: 'mer_1', resource: { type: 'payment_intent', id: 'pi_1' }, data: { intent, transaction: tx } }, dedupeKey: 'd1' })).event;
  await deliveries.create({ id: 'del_ok', eventId: event.id, endpointId: 'mwe_1', merchantId: 'mer_1', maxAttempts: 5, nextAttemptAt: new Date('2026-06-08T00:00:00.000Z') });
  let worker = new DeliverMerchantWebhooks(endpoints as any, events as any, deliveries as any, { timeoutMs: 1000, responseBodyLimit: 4, fetchImpl: async () => ({ status: 204, text: async () => 'success-body' }) });
  await worker.execute({ now: new Date('2026-06-08T00:00:00.000Z') });
  assert.equal((await deliveries.findById('del_ok', 'mer_1'))!.status, 'succeeded');
  assert.equal((await deliveries.findById('del_ok', 'mer_1'))!.lastResponseBodyTruncated, 'succ');

  await deliveries.create({ id: 'del_retry', eventId: event.id, endpointId: 'mwe_1', merchantId: 'mer_1', maxAttempts: 5, nextAttemptAt: new Date('2026-06-08T00:00:00.000Z') });
  worker = new DeliverMerchantWebhooks(endpoints as any, events as any, deliveries as any, { timeoutMs: 1000, responseBodyLimit: 10, fetchImpl: async () => ({ status: 500, text: async () => 'error' }) });
  await worker.execute({ now: new Date('2026-06-08T00:00:00.000Z') });
  assert.equal((await deliveries.findById('del_retry', 'mer_1'))!.status, 'failed');

  await deliveries.create({ id: 'del_dead', eventId: event.id, endpointId: 'mwe_1', merchantId: 'mer_1', maxAttempts: 1, nextAttemptAt: new Date('2026-06-08T00:00:00.000Z') });
  await worker.execute({ now: new Date('2026-06-08T00:00:00.000Z') });
  assert.equal((await deliveries.findById('del_dead', 'mer_1'))!.status, 'dead');
});


test('Drizzle delivery claim limits the database update to selected due rows', async () => {
  const now = new Date('2026-06-08T00:00:00.000Z');
  const earlier = new Date('2026-06-07T23:59:00.000Z');
  const later = new Date('2026-06-08T00:01:00.000Z');
  const source = readFileSync('apps/service/src/infrastructure/repositories/DrizzleMerchantWebhookDeliveryRepository.ts', 'utf8');
  assert.match(source, /WITH\s+due\s+AS/i, 'claimDue should select due IDs before updating deliveries');
  assert.match(source, /LIMIT\s+\$\{limit\}/, 'claimDue should bind the SQL LIMIT before the update');
  assert.match(source, /FOR\s+UPDATE\s+SKIP\s+LOCKED/i, 'claimDue should lock selected due rows for concurrent workers');
  assert.doesNotMatch(source, /rows\.slice\(0,\s*input\.limit\)/, 'claimDue must not slice after mass-updating due rows');

  const rows: MerchantWebhookDeliveryDTO[] = [
    { id: 'del_1', eventId: 'evt_1', endpointId: 'mwe_1', merchantId: 'mer_1', status: 'queued', attemptCount: 0, maxAttempts: 5, nextAttemptAt: earlier, lastAttemptAt: null, lastResponseStatus: null, lastResponseBodyTruncated: null, lastError: null, createdAt: earlier, updatedAt: earlier, deliveredAt: null },
    { id: 'del_2', eventId: 'evt_2', endpointId: 'mwe_1', merchantId: 'mer_1', status: 'queued', attemptCount: 0, maxAttempts: 5, nextAttemptAt: now, lastAttemptAt: null, lastResponseStatus: null, lastResponseBodyTruncated: null, lastError: null, createdAt: now, updatedAt: now, deliveredAt: null },
    { id: 'del_3', eventId: 'evt_3', endpointId: 'mwe_1', merchantId: 'mer_1', status: 'failed', attemptCount: 2, maxAttempts: 5, nextAttemptAt: now, lastAttemptAt: null, lastResponseStatus: 500, lastResponseBodyTruncated: 'err', lastError: 'server error', createdAt: later, updatedAt: later, deliveredAt: null },
  ];
  const fakeDb = {
    execute: async () => {
      return rows
        .filter((r) => ['queued', 'failed'].includes(r.status) && r.nextAttemptAt <= now)
        .sort((a, b) => a.nextAttemptAt.getTime() - b.nextAttemptAt.getTime() || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
        .slice(0, 1)
        .map((r) => Object.assign(r, { status: 'delivering' as const, attemptCount: r.attemptCount + 1, lastAttemptAt: now, updatedAt: now }));
    },
  };

  const claimed = await new DrizzleMerchantWebhookDeliveryRepository(fakeDb as any).claimDue({ now, limit: 1 });
  assert.equal(claimed.length, 1);
  assert.equal(claimed[0]!.id, 'del_1');
  assert.equal(claimed[0]!.status, 'delivering');
  assert.equal(claimed[0]!.attemptCount, 1);

  const delivering = rows.filter((r) => r.status === 'delivering');
  assert.equal(delivering.length, 1, 'only the selected row should become delivering');
  assert.equal(rows.find((r) => r.id === 'del_2')!.status, 'queued');
  assert.equal(rows.find((r) => r.id === 'del_2')!.attemptCount, 0);
  assert.equal(rows.find((r) => r.id === 'del_3')!.status, 'failed');
  assert.equal(rows.find((r) => r.id === 'del_3')!.attemptCount, 2);
});

test('docs do not instruct frontend/public env secret usage and provider codes remain unchanged', () => {
  const docs = readFileSync('docs/integration/merchant-outbound-webhooks.md', 'utf8') + readFileSync('docs/integration/webhook-signature-verification.md', 'utf8');
  assert.match(docs, /webhook:manage/);
  assert.match(docs, /webhook:read/);
  assert.match(docs, /merchant access for the target `merchantId`/i);
  assert.doesNotMatch(docs, /NEXT_PUBLIC_.*WEBHOOK|VITE_.*WEBHOOK|frontend.*PAYMENT_ORCHESTRATION.*SECRET/i);
  const providers = readFileSync('apps/service/src/infrastructure/providers/providerRegistry.ts', 'utf8');
  assert.match(providers, /manual/);
  assert.match(providers, /fake_gateway/);
  assert.match(providers, /xendit_sandbox/);
});
