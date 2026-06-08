import { and, asc, eq, sql } from 'drizzle-orm';
import type { MerchantWebhookDeliveryRepository, CreateMerchantWebhookDeliveryInput } from '@northflow/payment-orchestration-core';
import type { PoDb } from '../db.ts';
import { poMerchantWebhookDeliveries as t } from '../schema.ts';
import { mapWebhookDeliveryRow } from './merchantWebhookMappers.ts';

export class DrizzleMerchantWebhookDeliveryRepository implements MerchantWebhookDeliveryRepository {
  constructor(private readonly db: PoDb) {}
  async create(input: CreateMerchantWebhookDeliveryInput) {
    const now = new Date();
    const [row] = await this.db.insert(t).values({ ...input, nextAttemptAt: input.nextAttemptAt ?? now, createdAt: now, updatedAt: now }).returning();
    if (!row) throw new Error('Failed to create merchant webhook delivery.');
    return mapWebhookDeliveryRow(row as any);
  }
  async findById(id: string, merchantId: string) {
    const [row] = await this.db.select().from(t).where(and(eq(t.id, id), eq(t.merchantId, merchantId))).limit(1);
    return row ? mapWebhookDeliveryRow(row as any) : null;
  }
  async listByMerchant(input: { merchantId: string; endpointId?: string | null; limit?: number }) {
    const where = input.endpointId ? and(eq(t.merchantId, input.merchantId), eq(t.endpointId, input.endpointId)) : eq(t.merchantId, input.merchantId);
    const rows = await this.db.select().from(t).where(where).orderBy(asc(t.createdAt)).limit(input.limit ?? 100);
    return rows.map((r) => mapWebhookDeliveryRow(r as any));
  }
  async findByEventAndEndpoint(eventId: string, endpointId: string) {
    const [row] = await this.db.select().from(t).where(and(eq(t.eventId, eventId), eq(t.endpointId, endpointId))).limit(1);
    return row ? mapWebhookDeliveryRow(row as any) : null;
  }
  async claimDue(input: { now: Date; limit: number }) {
    const limit = Math.max(0, Math.floor(input.limit));
    if (limit === 0) return [];

    const result = await this.db.execute(sql`
      WITH due AS (
        SELECT id
        FROM po_merchant_webhook_deliveries
        WHERE status IN ('queued', 'failed')
          AND next_attempt_at <= ${input.now}
        ORDER BY next_attempt_at ASC, created_at ASC, id ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE po_merchant_webhook_deliveries AS d
      SET status = 'delivering',
          attempt_count = d.attempt_count + 1,
          last_attempt_at = ${input.now},
          updated_at = ${input.now}
      FROM due
      WHERE d.id = due.id
      RETURNING
        d.id,
        d.event_id AS "eventId",
        d.endpoint_id AS "endpointId",
        d.merchant_id AS "merchantId",
        d.status,
        d.attempt_count AS "attemptCount",
        d.max_attempts AS "maxAttempts",
        d.next_attempt_at AS "nextAttemptAt",
        d.last_attempt_at AS "lastAttemptAt",
        d.last_response_status AS "lastResponseStatus",
        d.last_response_body_truncated AS "lastResponseBodyTruncated",
        d.last_error AS "lastError",
        d.created_at AS "createdAt",
        d.updated_at AS "updatedAt",
        d.delivered_at AS "deliveredAt"
    `);
    const rows = Array.isArray(result) ? result : (result as any).rows;
    return rows.map((r: any) => mapWebhookDeliveryRow(r));
  }
  async markSucceeded(input: { id: string; merchantId: string; responseStatus: number; responseBodyTruncated: string | null; now: Date }) {
    const [row] = await this.db.update(t).set({ status: 'succeeded', lastResponseStatus: input.responseStatus, lastResponseBodyTruncated: input.responseBodyTruncated, lastError: null, deliveredAt: input.now, updatedAt: input.now }).where(and(eq(t.id, input.id), eq(t.merchantId, input.merchantId))).returning();
    if (!row) throw new Error(`Merchant webhook delivery not found: ${input.id}`);
    return mapWebhookDeliveryRow(row as any);
  }
  async markFailed(input: { id: string; merchantId: string; responseStatus?: number | null; responseBodyTruncated?: string | null; error?: string | null; nextAttemptAt: Date; now: Date }) {
    const [row] = await this.db.update(t).set({ status: 'failed', lastResponseStatus: input.responseStatus ?? null, lastResponseBodyTruncated: input.responseBodyTruncated ?? null, lastError: input.error ?? null, nextAttemptAt: input.nextAttemptAt, updatedAt: input.now }).where(and(eq(t.id, input.id), eq(t.merchantId, input.merchantId))).returning();
    if (!row) throw new Error(`Merchant webhook delivery not found: ${input.id}`);
    return mapWebhookDeliveryRow(row as any);
  }
  async markDead(input: { id: string; merchantId: string; responseStatus?: number | null; responseBodyTruncated?: string | null; error?: string | null; now: Date }) {
    const [row] = await this.db.update(t).set({ status: 'dead', lastResponseStatus: input.responseStatus ?? null, lastResponseBodyTruncated: input.responseBodyTruncated ?? null, lastError: input.error ?? null, updatedAt: input.now }).where(and(eq(t.id, input.id), eq(t.merchantId, input.merchantId))).returning();
    if (!row) throw new Error(`Merchant webhook delivery not found: ${input.id}`);
    return mapWebhookDeliveryRow(row as any);
  }
  async requeue(input: { id: string; merchantId: string; nextAttemptAt?: Date }) {
    const now = new Date();
    const [row] = await this.db.update(t).set({ status: 'queued', nextAttemptAt: input.nextAttemptAt ?? now, updatedAt: now }).where(and(eq(t.id, input.id), eq(t.merchantId, input.merchantId))).returning();
    if (!row) throw new Error(`Merchant webhook delivery not found: ${input.id}`);
    return mapWebhookDeliveryRow(row as any);
  }
}
