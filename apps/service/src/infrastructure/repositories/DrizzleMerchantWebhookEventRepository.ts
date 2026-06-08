import { and, eq } from 'drizzle-orm';
import type { MerchantWebhookEventRepository, CreateMerchantWebhookEventInput } from '@northflow/payment-orchestration-core';
import type { PoDb } from '../db.ts';
import { poMerchantWebhookEvents as t } from '../schema.ts';
import { mapWebhookEventRow } from './merchantWebhookMappers.ts';

export class DrizzleMerchantWebhookEventRepository implements MerchantWebhookEventRepository {
  constructor(private readonly db: PoDb) {}
  async createOrGet(input: CreateMerchantWebhookEventInput) {
    const existing = await this.db.select().from(t).where(and(eq(t.merchantId, input.merchantId), eq(t.dedupeKey, input.dedupeKey))).limit(1);
    if (existing[0]) return { event: mapWebhookEventRow(existing[0] as any), created: false };
    const [row] = await this.db.insert(t).values(input as any).returning();
    if (!row) throw new Error('Failed to create merchant webhook event.');
    return { event: mapWebhookEventRow(row as any), created: true };
  }
  async findById(id: string, merchantId: string) {
    const [row] = await this.db.select().from(t).where(and(eq(t.id, id), eq(t.merchantId, merchantId))).limit(1);
    return row ? mapWebhookEventRow(row as any) : null;
  }
}
