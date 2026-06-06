/**
 * DrizzlePaymentIntentRepository — Phase 8D real implementation.
 *
 * Implements PaymentIntentRepository using Drizzle ORM against
 * the po_intents table.
 */

import { eq, and, lte, inArray } from 'drizzle-orm';
import type {
  PaymentIntentRepository,
  CreatePaymentIntentDbInput,
  UpdateIntentTotalsInput,
  UpdateIntentStatusInput,
  FindByExternalPayableInput,
} from '@northflow/payment-orchestration-core';
import type { StandalonePaymentIntentDTO } from '@northflow/payment-orchestration-core';
import type { PoDb } from '../db.ts';
import { poIntents as t } from '../schema.ts';
import { mapIntentRow } from './mappers.ts';

export class DrizzlePaymentIntentRepository implements PaymentIntentRepository {
  constructor(private readonly db: PoDb) {}

  async findById(
    id: string,
    merchantId: string,
  ): Promise<StandalonePaymentIntentDTO | null> {
    const rows = await this.db
      .select()
      .from(t)
      .where(and(eq(t.id, id), eq(t.merchantId, merchantId)))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return mapIntentRow(row as any);
  }

  async findByExternalPayable(
    input: FindByExternalPayableInput,
  ): Promise<StandalonePaymentIntentDTO | null> {
    const conditions = input.sourceApp
      ? and(
          eq(t.merchantId, input.merchantId),
          eq(t.externalPayableType, input.externalPayableType),
          eq(t.externalPayableId, input.externalPayableId),
          eq(t.sourceApp, input.sourceApp),
        )
      : and(
          eq(t.merchantId, input.merchantId),
          eq(t.externalPayableType, input.externalPayableType),
          eq(t.externalPayableId, input.externalPayableId),
        );

    const rows = await this.db
      .select()
      .from(t)
      .where(conditions)
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return mapIntentRow(row as any);
  }

  async create(
    input: CreatePaymentIntentDbInput,
  ): Promise<StandalonePaymentIntentDTO> {
    const now = new Date();
    const amountDue = input.amountDue;
    const rows = await this.db
      .insert(t)
      .values({
        id: input.id,
        merchantId: input.merchantId,
        providerAccountId: input.providerAccountId ?? null,
        sourceApp: input.sourceApp ?? null,
        externalTenantId: input.externalTenantId ?? null,
        externalOutletId: input.externalOutletId ?? null,
        externalLocationId: input.externalLocationId ?? null,
        externalPayableType: input.externalPayableType,
        externalPayableId: input.externalPayableId,
        amountDue,
        amountPaid: 0,
        amountRefunded: 0,
        amountRemaining: amountDue,
        currency: input.currency ?? 'IDR',
        status: 'requires_payment',
        allowPartial: input.allowPartial ?? false,
        expiresAt: input.expiresAt ?? null,
        metadata: (input.metadata ?? {}) as Record<string, unknown>,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error('Failed to create payment intent — no row returned');
    return mapIntentRow(row as any);
  }

  async updateTotals(
    input: UpdateIntentTotalsInput,
  ): Promise<StandalonePaymentIntentDTO> {
    const rows = await this.db
      .update(t)
      .set({
        amountPaid: input.amountPaid,
        amountRefunded: input.amountRefunded,
        amountRemaining: input.amountRemaining,
        updatedAt: new Date(),
      })
      .where(and(eq(t.id, input.id), eq(t.merchantId, input.merchantId)))
      .returning();
    const row = rows[0];
    if (!row) throw new Error(`Payment intent not found: ${input.id}`);
    return mapIntentRow(row as any);
  }

  async findExpiredActive(input: { now: Date; limit: number }): Promise<StandalonePaymentIntentDTO[]> {
    const rows = await this.db
      .select()
      .from(t)
      .where(
        and(
          lte(t.expiresAt, input.now),
          inArray(t.status, ['requires_payment', 'partially_paid']),
        ),
      )
      .limit(input.limit);
    return rows.map((r) => mapIntentRow(r as any));
  }

  async updateStatus(
    input: UpdateIntentStatusInput,
  ): Promise<StandalonePaymentIntentDTO> {
    const rows = await this.db
      .update(t)
      .set({ status: input.status, updatedAt: new Date() })
      .where(and(eq(t.id, input.id), eq(t.merchantId, input.merchantId)))
      .returning();
    const row = rows[0];
    if (!row) throw new Error(`Payment intent not found: ${input.id}`);
    return mapIntentRow(row as any);
  }
}
