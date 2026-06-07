/**
 * DrizzleProviderAccountMethodRepository — S7.5 real implementation.
 *
 * Implements ProviderAccountPaymentMethodRepository using Drizzle ORM against
 * the po_provider_account_methods table.
 *
 * upsert is implemented as INSERT … ON CONFLICT (provider_account_id, method) DO UPDATE
 * to remain idempotent across sync runs.
 */

import { eq, and } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import type {
  ProviderAccountPaymentMethodRepository,
  UpsertProviderAccountMethodInput,
} from '@northflow/payment-orchestration-core';
import type { ProviderAccountPaymentMethod, ProviderAccountPaymentMethodStatus } from '@northflow/payment-orchestration-core';
import type { PoDb } from '../db.ts';
import { poProviderAccountMethods as t } from '../schema.ts';
import { mapProviderAccountMethodRow } from './mappers.ts';

export class DrizzleProviderAccountMethodRepository
  implements ProviderAccountPaymentMethodRepository
{
  constructor(private readonly db: PoDb) {}

  async findById(id: string): Promise<ProviderAccountPaymentMethod | null> {
    const rows = await this.db.select().from(t).where(eq(t.id, id)).limit(1);
    const row = rows[0];
    if (!row) return null;
    return mapProviderAccountMethodRow(row as any);
  }

  async listByMerchant(merchantId: string): Promise<ProviderAccountPaymentMethod[]> {
    const rows = await this.db
      .select()
      .from(t)
      .where(eq(t.merchantId, merchantId))
      .orderBy(t.sortOrder, t.method);
    return rows.map((r) => mapProviderAccountMethodRow(r as any));
  }

  async listByProviderAccount(providerAccountId: string): Promise<ProviderAccountPaymentMethod[]> {
    const rows = await this.db
      .select()
      .from(t)
      .where(eq(t.providerAccountId, providerAccountId))
      .orderBy(t.sortOrder, t.method);
    return rows.map((r) => mapProviderAccountMethodRow(r as any));
  }

  async findByProviderAccountAndMethod(
    providerAccountId: string,
    method: string,
  ): Promise<ProviderAccountPaymentMethod | null> {
    const rows = await this.db
      .select()
      .from(t)
      .where(and(eq(t.providerAccountId, providerAccountId), eq(t.method, method)))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return mapProviderAccountMethodRow(row as any);
  }

  async upsert(input: UpsertProviderAccountMethodInput): Promise<ProviderAccountPaymentMethod> {
    const now = new Date();
    const id = input.id ?? `pam_${randomUUID()}`;

    const rows = await this.db
      .insert(t)
      .values({
        id,
        merchantId: input.merchantId,
        providerAccountId: input.providerAccountId,
        provider: input.provider,
        method: input.method,
        methodType: input.methodType,
        providerMethodCode: input.providerMethodCode ?? null,
        displayName: input.displayName,
        status: input.status ?? 'active',
        currency: input.currency ?? 'IDR',
        minAmount: input.minAmount ?? null,
        maxAmount: input.maxAmount ?? null,
        sortOrder: input.sortOrder ?? 0,
        publicConfig: (input.publicConfig ?? {}) as Record<string, unknown>,
        providerMetadata: (input.providerMetadata ?? {}) as Record<string, unknown>,
        metadata: (input.metadata ?? {}) as Record<string, unknown>,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [t.providerAccountId, t.method],
        set: {
          methodType: input.methodType,
          providerMethodCode: input.providerMethodCode ?? null,
          displayName: input.displayName,
          // Do NOT override status on upsert unless explicitly set — preserve manual disable
          currency: input.currency ?? 'IDR',
          minAmount: input.minAmount ?? null,
          maxAmount: input.maxAmount ?? null,
          sortOrder: input.sortOrder ?? 0,
          publicConfig: (input.publicConfig ?? {}) as Record<string, unknown>,
          providerMetadata: (input.providerMetadata ?? {}) as Record<string, unknown>,
          metadata: (input.metadata ?? {}) as Record<string, unknown>,
          updatedAt: now,
        },
      })
      .returning();

    const row = rows[0];
    if (!row) throw new Error('Failed to upsert provider account method — no row returned');
    return mapProviderAccountMethodRow(row as any);
  }

  async updateStatus(
    id: string,
    status: ProviderAccountPaymentMethodStatus,
  ): Promise<ProviderAccountPaymentMethod> {
    const rows = await this.db
      .update(t)
      .set({ status, updatedAt: new Date() })
      .where(eq(t.id, id))
      .returning();
    const row = rows[0];
    if (!row) throw new Error(`Provider account method not found: ${id}`);
    return mapProviderAccountMethodRow(row as any);
  }
}
