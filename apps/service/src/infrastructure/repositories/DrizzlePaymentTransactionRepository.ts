/**
 * DrizzlePaymentTransactionRepository — Phase 8D real implementation.
 *
 * Implements PaymentTransactionRepository using Drizzle ORM against
 * the po_transactions table.
 */

import { eq, and, sum, inArray, lte, isNotNull, sql } from 'drizzle-orm';
import type {
  PaymentTransactionRepository,
  CreatePaymentTransactionInput,
  UpdateTransactionStatusInput,
  MarkSucceededIfConfirmableInput,
  MarkSucceededIfConfirmableResult,
  ApplySucceededPaymentInput,
  ApplySucceededPaymentResult,
  ApplySucceededRefundInput,
  ApplySucceededRefundResult,
} from '@northflow/payment-orchestration-core';
import type { StandalonePaymentTransactionDTO } from '@northflow/payment-orchestration-core';
import type { PoDb } from '../db.ts';
import {
  poTransactions as t,
  poIntents as intents,
} from '../schema.ts';
import { mapIntentRow, mapTransactionRow } from './mappers.ts';

export class DrizzlePaymentTransactionRepository
  implements PaymentTransactionRepository
{
  constructor(private readonly db: PoDb) {}



  async applySucceededPayment(
    input: ApplySucceededPaymentInput,
  ): Promise<ApplySucceededPaymentResult> {
    return await this.db.transaction(async (txDb) => {
      const now = new Date();
      const txRows = await txDb
        .update(t)
        .set({ status: 'succeeded', updatedAt: now })
        .where(
          and(
            eq(t.id, input.transactionId),
            eq(t.merchantId, input.merchantId),
            inArray(t.status, ['requires_action', 'pending']),
          ),
        )
        .returning();
      const changedTx = txRows[0];
      if (!changedTx) {
        const existingRows = await txDb
          .select()
          .from(t)
          .where(and(eq(t.id, input.transactionId), eq(t.merchantId, input.merchantId)))
          .limit(1);
        const existing = existingRows[0];
        if (existing?.status === 'succeeded') {
          const intentRows = await txDb
            .select()
            .from(intents)
            .where(and(eq(intents.id, input.intentId), eq(intents.merchantId, input.merchantId)))
            .limit(1);
          const intent = intentRows[0];
          if (!intent) throw new Error(`Payment intent not found: ${input.intentId}`);
          return {
            transaction: mapTransactionRow(existing as any),
            intent: mapIntentRow(intent as any),
            changed: false,
            alreadySucceeded: true,
          };
        }
        throw Object.assign(new Error('Transaction is not confirmable.'), {
          statusCode: 422,
          code: 'INVALID_TRANSACTION_STATUS',
        });
      }

      const intentRows = await txDb
        .update(intents)
        .set({
          amountPaid: sql`${intents.amountPaid} + ${input.amount}`,
          amountRemaining: sql`${intents.amountRemaining} - ${input.amount}`,
          status: sql`CASE
            WHEN ${intents.amountPaid} + ${input.amount} > ${intents.amountDue} THEN 'overpaid'
            WHEN ${intents.amountPaid} + ${input.amount} >= ${intents.amountDue} THEN 'paid'
            WHEN ${intents.amountPaid} + ${input.amount} > 0 THEN 'partially_paid'
            ELSE 'requires_payment'
          END`,
          updatedAt: now,
        })
        .where(
          and(
            eq(intents.id, input.intentId),
            eq(intents.merchantId, input.merchantId),
            sql`${intents.amountRemaining} >= ${input.amount}`,
          ),
        )
        .returning();
      const intent = intentRows[0];
      if (!intent) {
        throw Object.assign(new Error('Confirming this transaction would cause overpayment.'), {
          statusCode: 422,
          code: 'OVERPAYMENT_REJECTED',
        });
      }
      return {
        transaction: mapTransactionRow(changedTx as any),
        intent: mapIntentRow(intent as any),
        changed: true,
        alreadySucceeded: false,
      };
    });
  }

  async applySucceededRefund(
    input: ApplySucceededRefundInput,
  ): Promise<ApplySucceededRefundResult> {
    return await this.db.transaction(async (txDb) => {
      const now = new Date();
      const refundRows = await txDb
        .update(t)
        .set({
          status: 'succeeded',
          failureReason: null,
          providerReference: input.providerReference ?? undefined,
          rawProviderResponse: input.rawProviderResponse !== undefined
            ? (input.rawProviderResponse ?? {}) as Record<string, unknown>
            : undefined,
          updatedAt: now,
        })
        .where(and(eq(t.id, input.refundTransactionId), eq(t.merchantId, input.merchantId)))
        .returning();
      const refund = refundRows[0];
      if (!refund) throw new Error(`Refund transaction not found: ${input.refundTransactionId}`);

      const intentRows = await txDb
        .update(intents)
        .set({
          amountRefunded: sql`${intents.amountRefunded} + ${input.amount}`,
          status: sql`CASE
            WHEN ${intents.amountPaid} > 0 AND ${intents.amountRefunded} + ${input.amount} >= ${intents.amountPaid} THEN 'refunded'
            ELSE ${intents.status}
          END`,
          updatedAt: now,
        })
        .where(
          and(
            eq(intents.id, input.intentId),
            eq(intents.merchantId, input.merchantId),
            sql`${intents.amountRefunded} + ${input.amount} <= ${intents.amountPaid}`,
          ),
        )
        .returning();
      const intent = intentRows[0];
      if (!intent) {
        throw Object.assign(new Error('Refund exceeds refundable amount.'), {
          statusCode: 422,
          code: 'REFUND_EXCEEDS_REFUNDABLE',
        });
      }
      return {
        refundTransaction: mapTransactionRow(refund as any),
        intent: mapIntentRow(intent as any),
      };
    });
  }

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

  async findByMerchantIdempotencyKey(
    merchantId: string,
    idempotencyKey: string,
  ): Promise<StandalonePaymentTransactionDTO | null> {
    const rows = await this.db
      .select()
      .from(t)
      .where(and(eq(t.merchantId, merchantId), eq(t.idempotencyKey, idempotencyKey)))
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
        idempotencyKey: input.idempotencyKey !== undefined ? input.idempotencyKey : undefined,
        metadata: input.metadata !== undefined ? (input.metadata ?? {}) as Record<string, unknown> : undefined,
        rawProviderResponse: input.rawProviderResponse !== undefined ? (input.rawProviderResponse ?? {}) as Record<string, unknown> : undefined,
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
