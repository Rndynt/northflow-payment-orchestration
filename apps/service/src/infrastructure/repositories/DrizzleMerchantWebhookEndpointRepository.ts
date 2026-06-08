import { and, eq, sql } from 'drizzle-orm';
import type { MerchantWebhookEndpointRepository, CreateMerchantWebhookEndpointInput, MerchantWebhookEndpointStatus, MerchantWebhookEventType } from '@northflow/payment-orchestration-core';
import type { PoDb } from '../db.ts';
import { poMerchantWebhookEndpoints as t } from '../schema.ts';
import { mapWebhookEndpointRow } from './merchantWebhookMappers.ts';

export class DrizzleMerchantWebhookEndpointRepository implements MerchantWebhookEndpointRepository {
  constructor(private readonly db: PoDb) {}
  async create(input: CreateMerchantWebhookEndpointInput) {
    const now = new Date();
    const [row] = await this.db.insert(t).values({ ...input, metadata: input.metadata ?? {}, status: 'active', createdAt: now, updatedAt: now }).returning();
    if (!row) throw new Error('Failed to create merchant webhook endpoint.');
    return mapWebhookEndpointRow(row as any);
  }
  async findById(id: string, merchantId: string) {
    const [row] = await this.db.select().from(t).where(and(eq(t.id, id), eq(t.merchantId, merchantId))).limit(1);
    return row ? mapWebhookEndpointRow(row as any) : null;
  }
  async listByMerchant(merchantId: string) {
    const rows = await this.db.select().from(t).where(eq(t.merchantId, merchantId));
    return rows.map((r) => mapWebhookEndpointRow(r as any));
  }
  async listActiveByMerchantAndEvent(merchantId: string, eventType: MerchantWebhookEventType) {
    const rows = await this.db.select().from(t).where(and(eq(t.merchantId, merchantId), eq(t.status, 'active'), sql`${t.subscribedEvents} @> ${JSON.stringify([eventType])}::jsonb`));
    return rows.map((r) => mapWebhookEndpointRow(r as any));
  }
  async updateSecret(input: { id: string; merchantId: string; secretHash: string; secretPrefix: string }) {
    const [row] = await this.db.update(t).set({ secretHash: input.secretHash, secretPrefix: input.secretPrefix, updatedAt: new Date() }).where(and(eq(t.id, input.id), eq(t.merchantId, input.merchantId))).returning();
    if (!row) throw new Error(`Merchant webhook endpoint not found: ${input.id}`);
    return mapWebhookEndpointRow(row as any);
  }
  async updateStatus(input: { id: string; merchantId: string; status: MerchantWebhookEndpointStatus; disabledAt?: Date | null }) {
    const [row] = await this.db.update(t).set({ status: input.status, disabledAt: input.disabledAt ?? (input.status === 'disabled' ? new Date() : null), updatedAt: new Date() }).where(and(eq(t.id, input.id), eq(t.merchantId, input.merchantId))).returning();
    if (!row) throw new Error(`Merchant webhook endpoint not found: ${input.id}`);
    return mapWebhookEndpointRow(row as any);
  }
}
