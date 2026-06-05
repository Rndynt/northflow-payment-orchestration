/**
 * DrizzlePaymentProviderEventRepository — Phase 8D real implementation.
 *
 * Implements PaymentProviderEventRepository using Drizzle ORM against
 * the payment_orchestration_provider_events table.
 *
 * Phase 8D: full implementation for Phase 8E/9 compatibility.
 * Webhook processing use case NOT yet wired in Phase 8D.
 */

import { eq, and, lt, sql, inArray } from 'drizzle-orm';
import type {
  PaymentProviderEventRepository,
  FindStalePendingInput,
} from '@northflow/payment-orchestration-core';
import type {
  PaymentProviderEventDTO,
  ReserveProviderEventInput,
} from '@northflow/payment-orchestration-core';
import type { PoDb } from '../db.ts';
import { paymentOrchestrationProviderEvents as t } from '../schema.ts';
import { mapProviderEventRow } from './mappers.ts';

export class DrizzlePaymentProviderEventRepository
  implements PaymentProviderEventRepository
{
  constructor(private readonly db: PoDb) {}

  async reserveEvent(
    input: ReserveProviderEventInput,
  ): Promise<PaymentProviderEventDTO> {
    const now = new Date();
    const rows = await this.db
      .insert(t)
      .values({
        id: input.id,
        merchantId: null,
        provider: input.provider,
        providerEventId: input.providerEventId,
        providerReference: input.providerReference ?? null,
        eventType: input.eventType,
        processingStatus: 'pending',
        processingAttempts: 0,
        lastError: null,
        rawHeaders: (input.rawHeaders ?? {}) as Record<string, unknown>,
        rawBody: (input.rawBody ?? null) as Record<string, unknown> | null,
        parsedPayload: (input.parsedPayload ?? null) as Record<string, unknown> | null,
        receivedAt: now,
        processedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error('Failed to reserve provider event — no row returned');
    return mapProviderEventRow(row as any);
  }

  async findByProviderEventId(
    provider: string,
    providerEventId: string,
  ): Promise<PaymentProviderEventDTO | null> {
    const rows = await this.db
      .select()
      .from(t)
      .where(
        and(eq(t.provider, provider), eq(t.providerEventId, providerEventId)),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return mapProviderEventRow(row as any);
  }

  async assignMerchant(eventId: string, merchantId: string): Promise<void> {
    await this.db
      .update(t)
      .set({ merchantId, updatedAt: new Date() })
      .where(eq(t.id, eventId));
  }

  async markProcessed(eventId: string): Promise<void> {
    const now = new Date();
    await this.db
      .update(t)
      .set({
        processingStatus: 'processed',
        processedAt: now,
        updatedAt: now,
      })
      .where(eq(t.id, eventId));
  }

  async markFailed(eventId: string, error: string): Promise<void> {
    await this.db
      .update(t)
      .set({
        processingStatus: 'failed',
        lastError: error,
        processingAttempts: sql`${t.processingAttempts} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(t.id, eventId));
  }

  async findStalePending(
    input: FindStalePendingInput,
  ): Promise<PaymentProviderEventDTO[]> {
    const cutoff = new Date(Date.now() - input.olderThanMinutes * 60 * 1000);
    const limit = input.limit ?? 100;
    const rows = await this.db
      .select()
      .from(t)
      .where(
        and(
          inArray(t.processingStatus, ['pending', 'failed']),
          lt(t.createdAt, cutoff),
        ),
      )
      .limit(limit);
    return rows.map((r) => mapProviderEventRow(r as any));
  }
}
