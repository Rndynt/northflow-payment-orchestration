/**
 * DrizzleClientMerchantAccessRepository — S1: client-to-merchant access grants.
 */

import { and, eq } from 'drizzle-orm';
import type { PoDb } from '../db.ts';
import { paymentOrchestrationClientMerchantAccess } from '../schema.ts';
import type { ClientMerchantAccessRepository, CreateClientMerchantAccessInput } from '@northflow/payment-orchestration-core';
import type { ClientMerchantAccessDTO, ClientMerchantAccessStatus } from '@northflow/payment-orchestration-core';

export class DrizzleClientMerchantAccessRepository implements ClientMerchantAccessRepository {
  constructor(private readonly db: PoDb) {}

  async findByClientAndMerchant(clientId: string, merchantId: string): Promise<ClientMerchantAccessDTO | null> {
    const rows = await this.db
      .select()
      .from(paymentOrchestrationClientMerchantAccess)
      .where(
        and(
          eq(paymentOrchestrationClientMerchantAccess.clientId, clientId),
          eq(paymentOrchestrationClientMerchantAccess.merchantId, merchantId),
        ),
      )
      .limit(1);
    return rows[0] ? this.#map(rows[0]) : null;
  }

  async findByClient(clientId: string): Promise<ClientMerchantAccessDTO[]> {
    const rows = await this.db
      .select()
      .from(paymentOrchestrationClientMerchantAccess)
      .where(eq(paymentOrchestrationClientMerchantAccess.clientId, clientId));
    return rows.map((r) => this.#map(r));
  }

  async create(input: CreateClientMerchantAccessInput): Promise<ClientMerchantAccessDTO> {
    const rows = await this.db
      .insert(paymentOrchestrationClientMerchantAccess)
      .values({
        id: input.id,
        clientId: input.clientId,
        merchantId: input.merchantId,
        scopes: input.scopes,
        status: 'active',
      })
      .returning();
    return this.#map(rows[0]);
  }

  async revoke(id: string): Promise<void> {
    await this.db
      .update(paymentOrchestrationClientMerchantAccess)
      .set({ status: 'revoked', revokedAt: new Date() })
      .where(eq(paymentOrchestrationClientMerchantAccess.id, id));
  }

  #map(row: typeof paymentOrchestrationClientMerchantAccess.$inferSelect): ClientMerchantAccessDTO {
    return {
      id: row.id,
      clientId: row.clientId,
      merchantId: row.merchantId,
      scopes: (row.scopes ?? []) as string[],
      status: row.status as ClientMerchantAccessStatus,
      createdAt: row.createdAt,
      revokedAt: row.revokedAt ?? null,
    };
  }
}
