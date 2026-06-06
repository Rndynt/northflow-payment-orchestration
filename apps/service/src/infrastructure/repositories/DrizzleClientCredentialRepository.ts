/**
 * DrizzleClientCredentialRepository — S1: client credential CRUD.
 *
 * Never stores or returns raw credential material — only prefix + hash.
 */

import { eq } from 'drizzle-orm';
import type { PoDb } from '../db.ts';
import { poClientCredentials } from '../schema.ts';
import type { ClientCredentialRepository, CreateClientCredentialInput } from '@northflow/payment-orchestration-core';
import type { ClientCredentialDTO, ClientCredentialStatus } from '@northflow/payment-orchestration-core';

export class DrizzleClientCredentialRepository implements ClientCredentialRepository {
  constructor(private readonly db: PoDb) {}

  async findByPrefix(prefix: string): Promise<ClientCredentialDTO[]> {
    const rows = await this.db
      .select()
      .from(poClientCredentials)
      .where(eq(poClientCredentials.credentialPrefix, prefix));
    return rows.map((r) => this.#map(r));
  }

  async findById(id: string): Promise<ClientCredentialDTO | null> {
    const rows = await this.db
      .select()
      .from(poClientCredentials)
      .where(eq(poClientCredentials.id, id))
      .limit(1);
    return rows[0] ? this.#map(rows[0]) : null;
  }

  async create(input: CreateClientCredentialInput): Promise<ClientCredentialDTO> {
    const rows = await this.db
      .insert(poClientCredentials)
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
      .update(poClientCredentials)
      .set({ status: 'revoked', revokedAt: new Date() })
      .where(eq(poClientCredentials.id, id));
  }

  async touchLastUsed(id: string, at: Date): Promise<void> {
    await this.db
      .update(poClientCredentials)
      .set({ lastUsedAt: at })
      .where(eq(poClientCredentials.id, id));
  }

  #map(row: typeof poClientCredentials.$inferSelect): ClientCredentialDTO {
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
