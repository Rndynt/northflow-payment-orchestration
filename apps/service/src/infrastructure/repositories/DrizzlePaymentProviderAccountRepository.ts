/**
 * DrizzlePaymentProviderAccountRepository — Phase 8D real implementation.
 *
 * Implements PaymentProviderAccountRepository using Drizzle ORM against
 * the payment_orchestration_provider_accounts table.
 */

import { eq, and } from 'drizzle-orm';
import type {
  PaymentProviderAccountRepository,
  CreatePaymentProviderAccountInput,
} from '@northflow/payment-orchestration-core';
import type { PaymentProviderAccount } from '@northflow/payment-orchestration-core';
import type { PoDb } from '../db.ts';
import { paymentOrchestrationProviderAccounts as t } from '../schema.ts';
import { mapProviderAccountRow } from './mappers.ts';

export class DrizzlePaymentProviderAccountRepository
  implements PaymentProviderAccountRepository
{
  constructor(private readonly db: PoDb) {}

  async findById(
    id: string,
    merchantId: string,
  ): Promise<PaymentProviderAccount | null> {
    const rows = await this.db
      .select()
      .from(t)
      .where(and(eq(t.id, id), eq(t.merchantId, merchantId)))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return mapProviderAccountRow(row as any);
  }

  async findByMerchantAndProvider(
    merchantId: string,
    provider: string,
    environment?: string,
  ): Promise<PaymentProviderAccount | null> {
    const conditions = environment
      ? and(eq(t.merchantId, merchantId), eq(t.provider, provider), eq(t.environment, environment))
      : and(eq(t.merchantId, merchantId), eq(t.provider, provider));

    const rows = await this.db
      .select()
      .from(t)
      .where(conditions)
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return mapProviderAccountRow(row as any);
  }

  async create(
    input: CreatePaymentProviderAccountInput,
  ): Promise<PaymentProviderAccount> {
    const now = new Date();
    const rows = await this.db
      .insert(t)
      .values({
        id: input.id,
        merchantId: input.merchantId,
        provider: input.provider,
        environment: input.environment,
        providerAccountRef: input.providerAccountRef ?? null,
        credentialsRef: input.credentialsRef ?? null,
        publicConfig: (input.publicConfig ?? {}) as Record<string, unknown>,
        status: input.status ?? 'active',
        metadata: (input.metadata ?? {}) as Record<string, unknown>,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error('Failed to create provider account — no row returned');
    return mapProviderAccountRow(row as any);
  }

  async updateStatus(
    id: string,
    merchantId: string,
    status: PaymentProviderAccount['status'],
  ): Promise<PaymentProviderAccount> {
    const rows = await this.db
      .update(t)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(t.id, id), eq(t.merchantId, merchantId)))
      .returning();
    const row = rows[0];
    if (!row) throw new Error(`Provider account not found: ${id}`);
    return mapProviderAccountRow(row as any);
  }
}
