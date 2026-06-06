/**
 * DrizzleClientCredentialRepository — S1: client credential CRUD.
 *
 * Never stores or returns raw credential material — only prefix + hash.
 */

import { eq } from 'drizzle-orm';
import type { PoDb } from '../db.ts';
import { paymentOrchestrationClientCredentials } from '../schema.ts';
import type { ClientCredentialRepository, CreateClientCredentialInput } from '@northflow/payment-orchestration-core';
import type { ClientCredentialDTO, ClientCredentialStatus } from '@northflow/payment-orchestration-core';

export class DrizzleClientCredentialRepository implements ClientCredentialRepository {
  constructor(private readonly db: PoDb) {}

  async findByPrefix(prefix: string): Promise<ClientCredentialDTO[]> {
    const rows = await this.db
      .select()
      .from(paymentOrchestrationClientCredentials)
      .where(eq(paymentOrchestrationClientCredentials.credentialPrefix, prefix));
    return rows.map((r) => this.#map(r));
  }

  async findById(id: string): Promise<ClientCredentialDTO | null> {
    const rows = await this.db
      .select()
      .from(paymentOrchestrationClientCredentials)
      .where(eq(paymentOrchestrationClientCredentials.id, id))
      .limit(1);
    return rows[0] ? this.#map(rows[0]) : null;
  }

  async create(input: CreateClientCredentialInput): Promise<ClientCredentialDTO> {
    const rows = await this.db
      .insert(paymentOrchestrationClientCredentials)
      .values({
        id: input.id,
        clientId: input.clientId,
        credentialPrefix: input.credentialPrefix,
        credentialHash: input.credentialHash,
        status: 'active',
        expiresAt: input.expiresAt ?? null,
      })
      .returning();
    return this.#map(rows[0]);
  }

  async revoke(id: string): Promise<void> {
    await this.db
      .update(paymentOrchestrationClientCredentials)
      .set({ status: 'revoked', revokedAt: new Date() })
      .where(eq(paymentOrchestrationClientCredentials.id, id));
  }

  async touchLastUsed(id: string, at: Date): Promise<void> {
    await this.db
      .update(paymentOrchestrationClientCredentials)
      .set({ lastUsedAt: at })
      .where(eq(paymentOrchestrationClientCredentials.id, id));
  }

  #map(row: typeof paymentOrchestrationClientCredentials.$inferSelect): ClientCredentialDTO {
    return {
      id: row.id,
      clientId: row.clientId,
      credentialPrefix: row.credentialPrefix,
      credentialHash: row.credentialHash,
      status: row.status as ClientCredentialStatus,
      expiresAt: row.expiresAt ?? null,
      lastUsedAt: row.lastUsedAt ?? null,
      createdAt: row.createdAt,
      revokedAt: row.revokedAt ?? null,
    };
  }
}
