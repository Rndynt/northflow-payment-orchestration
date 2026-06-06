/**
 * DrizzlePaymentMerchantRepository — Phase 8D real implementation.
 *
 * Implements PaymentMerchantRepository using Drizzle ORM against
 * the payment_orchestration_merchants table in service-local schema.ts.
 */

import { eq, and } from 'drizzle-orm';
import type {
  PaymentMerchantRepository,
  CreatePaymentMerchantInput,
} from '@northflow/payment-orchestration-core';
import type { PaymentMerchant } from '@northflow/payment-orchestration-core';
import type { PoDb } from '../db.ts';
import { poMerchants as t } from '../schema.ts';
import { mapMerchantRow } from './mappers.ts';

export class DrizzlePaymentMerchantRepository implements PaymentMerchantRepository {
  constructor(private readonly db: PoDb) {}

  async findById(id: string): Promise<PaymentMerchant | null> {
    const rows = await this.db
      .select()
      .from(t)
      .where(eq(t.id, id))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return mapMerchantRow(row as any);
  }

  async findByExternalRef(input: {
    sourceApp: string;
    externalRef: string;
  }): Promise<PaymentMerchant | null> {
    const rows = await this.db
      .select()
      .from(t)
      .where(
        and(
          eq(t.sourceApp, input.sourceApp),
          eq(t.externalRef, input.externalRef),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return mapMerchantRow(row as any);
  }

  async create(input: CreatePaymentMerchantInput): Promise<PaymentMerchant> {
    const now = new Date();
    const rows = await this.db
      .insert(t)
      .values({
        id: input.id,
        name: input.name,
        legalName: input.legalName ?? null,
        externalRef: input.externalRef ?? null,
        sourceApp: input.sourceApp ?? null,
        status: input.status ?? 'active',
        metadata: (input.metadata ?? {}) as Record<string, unknown>,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error('Failed to create merchant — no row returned');
    return mapMerchantRow(row as any);
  }

  async updateStatus(
    id: string,
    status: PaymentMerchant['status'],
  ): Promise<PaymentMerchant> {
    const rows = await this.db
      .update(t)
      .set({ status, updatedAt: new Date() })
      .where(eq(t.id, id))
      .returning();
    const row = rows[0];
    if (!row) throw new Error(`Merchant not found: ${id}`);
    return mapMerchantRow(row as any);
  }
}
