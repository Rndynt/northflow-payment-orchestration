/**
 * DrizzlePaymentIdempotencyRepository — Phase 8D real implementation.
 *
 * Implements PaymentIdempotencyRepository using Drizzle ORM against
 * the payment_orchestration_idempotency_keys table.
 *
 * Uniqueness constraint: (merchantId, scope, idempotencyKey).
 * reserve() inserts with status 'processing'; conflicts bubble up as errors to caller.
 */

import { eq, and } from 'drizzle-orm';
import type {
  PaymentIdempotencyRepository,
} from '@northflow/payment-orchestration-core';
import type {
  PaymentIdempotencyKeyDTO,
  ReserveIdempotencyKeyInput,
  FindIdempotencyKeyInput,
  MarkIdempotencyCompletedInput,
  MarkIdempotencyFailedInput,
} from '@northflow/payment-orchestration-core';
import type { PoDb } from '../db.ts';
import { paymentOrchestrationIdempotencyKeys as t } from '../schema.ts';
import { mapIdempotencyKeyRow } from './mappers.ts';

export class DrizzlePaymentIdempotencyRepository
  implements PaymentIdempotencyRepository
{
  constructor(private readonly db: PoDb) {}

  async reserve(
    input: ReserveIdempotencyKeyInput,
  ): Promise<PaymentIdempotencyKeyDTO> {
    const now = new Date();
    const rows = await this.db
      .insert(t)
      .values({
        id: input.id,
        merchantId: input.merchantId,
        scope: input.scope,
        idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash,
        responseSnapshot: null,
        resourceType: null,
        resourceId: null,
        status: 'processing',
        createdAt: now,
        updatedAt: now,
        expiresAt: input.expiresAt ?? null,
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error('Failed to reserve idempotency key — no row returned');
    return mapIdempotencyKeyRow(row as any);
  }

  async find(
    input: FindIdempotencyKeyInput,
  ): Promise<PaymentIdempotencyKeyDTO | null> {
    const rows = await this.db
      .select()
      .from(t)
      .where(
        and(
          eq(t.merchantId, input.merchantId),
          eq(t.scope, input.scope),
          eq(t.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return mapIdempotencyKeyRow(row as any);
  }

  async markCompleted(input: MarkIdempotencyCompletedInput): Promise<void> {
    await this.db
      .update(t)
      .set({
        status: 'completed',
        responseSnapshot: input.responseSnapshot as Record<string, unknown>,
        resourceType: input.resourceType ?? null,
        resourceId: input.resourceId ?? null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(t.merchantId, input.merchantId),
          eq(t.scope, input.scope),
          eq(t.idempotencyKey, input.idempotencyKey),
        ),
      );
  }

  async markFailed(input: MarkIdempotencyFailedInput): Promise<void> {
    await this.db
      .update(t)
      .set({
        status: 'failed',
        responseSnapshot: { error: input.error } as Record<string, unknown>,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(t.merchantId, input.merchantId),
          eq(t.scope, input.scope),
          eq(t.idempotencyKey, input.idempotencyKey),
        ),
      );
  }
}
