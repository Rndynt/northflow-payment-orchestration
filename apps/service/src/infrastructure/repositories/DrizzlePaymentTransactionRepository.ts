/**
 * DrizzlePaymentTransactionRepository — Phase 8D real implementation.
 *
 * Implements PaymentTransactionRepository using Drizzle ORM against
 * the payment_orchestration_transactions table.
 */

import { eq, and, sum, inArray, lte, isNotNull } from 'drizzle-orm';
import type {
  PaymentTransactionRepository,
  CreatePaymentTransactionInput,
  UpdateTransactionStatusInput,
  MarkSucceededIfConfirmableInput,
  MarkSucceededIfConfirmableResult,
} from '@northflow/payment-orchestration-core';
import type { StandalonePaymentTransactionDTO } from '@northflow/payment-orchestration-core';
import type { PoDb } from '../db.ts';
import { paymentOrchestrationTransactions as t } from '../schema.ts';
import { mapTransactionRow } from './mappers.ts';

export class DrizzlePaymentTransactionRepository
  implements PaymentTransactionRepository
{
  constructor(private readonly db: PoDb) {}

  async findById(
    id: string,
    merchantId: string,
  ): Promise<StandalonePaymentTransactionDTO | null> {
    const rows = await this.db
      .select()
      .from(t)
      .where(and(eq(t.id, id), eq(t.merchantId, merchantId)))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return mapTransactionRow(row as any);
  }

  async findByIntentId(
    intentId: string,
    merchantId: string,
  ): Promise<StandalonePaymentTransactionDTO[]> {
    const rows = await this.db
      .select()
      .from(t)
      .where(and(eq(t.intentId, intentId), eq(t.merchantId, merchantId)));
    return rows.map((r) => mapTransactionRow(r as any));
  }

  async findStalePendingTransactions(input: { now: Date; limit: number }): Promise<StandalonePaymentTransactionDTO[]> {
    const rows = await this.db
      .select()
      .from(t)
      .where(
        and(
          inArray(t.status, ['pending', 'requires_action']),
          isNotNull(t.expiresAt),
          lte(t.expiresAt, input.now),
        ),
      )
      .limit(input.limit);
    return rows.map((r) => mapTransactionRow(r as any));
  }

  async findByProviderReference(
    provider: string,
    providerReference: string,
  ): Promise<StandalonePaymentTransactionDTO | null> {
    const rows = await this.db
      .select()
      .from(t)
      .where(
        and(
          eq(t.provider, provider),
          eq(t.providerReference, providerReference),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return mapTransactionRow(row as any);
  }

  async create(
    input: CreatePaymentTransactionInput,
  ): Promise<StandalonePaymentTransactionDTO> {
    const now = new Date();
    const rows = await this.db
      .insert(t)
      .values({
        id: input.id,
        merchantId: input.merchantId,
        intentId: input.intentId,
        providerAccountId: input.providerAccountId ?? null,
        provider: input.provider,
        method: input.method,
        transactionType: input.transactionType,
        direction: input.direction,
        status: input.status,
        amount: input.amount,
        currency: input.currency ?? 'IDR',
        parentTransactionId: input.parentTransactionId ?? null,
        providerReference: input.providerReference ?? null,
        providerEventId: input.providerEventId ?? null,
        providerPaymentUrl: input.providerPaymentUrl ?? null,
        providerQrString: input.providerQrString ?? null,
        failureReason: input.failureReason ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        expiresAt: input.expiresAt ?? null,
        metadata: (input.metadata ?? {}) as Record<string, unknown>,
        rawProviderResponse: (input.rawProviderResponse ?? {}) as Record<string, unknown>,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error('Failed to create transaction — no row returned');
    return mapTransactionRow(row as any);
  }

  async updateStatus(
    input: UpdateTransactionStatusInput,
  ): Promise<StandalonePaymentTransactionDTO> {
    const rows = await this.db
      .update(t)
      .set({
        status: input.status,
        failureReason: input.failureReason ?? null,
        providerReference: input.providerReference ?? undefined,
        providerEventId: input.providerEventId ?? undefined,
        updatedAt: new Date(),
      })
      .where(and(eq(t.id, input.id), eq(t.merchantId, input.merchantId)))
      .returning();
    const row = rows[0];
    if (!row) throw new Error(`Transaction not found: ${input.id}`);
    return mapTransactionRow(row as any);
  }

  async sumSucceededRefundsByParent(parentTransactionId: string): Promise<number> {
    const result = await this.db
      .select({ total: sum(t.amount) })
      .from(t)
      .where(
        and(
          eq(t.parentTransactionId, parentTransactionId),
          eq(t.transactionType, 'refund'),
          eq(t.direction, 'outgoing'),
          eq(t.status, 'succeeded'),
        ),
      );
    return Number(result[0]?.total ?? 0);
  }

  /**
   * Atomically transitions a transaction to 'succeeded' only when it is
   * currently in 'requires_action' or 'pending' status.
   *
   * Uses a conditional UPDATE … WHERE id = ? AND merchant_id = ?
   * AND status IN ('requires_action', 'pending') RETURNING *
   *
   * This prevents concurrent confirms from double-crediting the intent:
   * only ONE concurrent caller gets changed=true; all others see changed=false
   * and must reload to determine the current status.
   */
  async markSucceededIfConfirmable(
    input: MarkSucceededIfConfirmableInput,
  ): Promise<MarkSucceededIfConfirmableResult> {
    const rows = await this.db
      .update(t)
      .set({ status: 'succeeded', updatedAt: new Date() })
      .where(
        and(
          eq(t.id, input.id),
          eq(t.merchantId, input.merchantId),
          inArray(t.status, ['requires_action', 'pending']),
        ),
      )
      .returning();
    const row = rows[0];
    if (!row) {
      return { transaction: null, changed: false };
    }
    return { transaction: mapTransactionRow(row as any), changed: true };
  }
}
