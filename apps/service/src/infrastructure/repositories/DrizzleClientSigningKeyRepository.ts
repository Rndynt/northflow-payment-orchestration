/**
 * DrizzleClientSigningKeyRepository — S9.4: HMAC signing key CRUD.
 *
 * Security invariants:
 *   - secretCiphertext is stored as-is (already encrypted by signingSecretProtector).
 *   - secretCiphertext is NEVER returned in responses or exposed outside this repo + protector.
 *   - Raw signing secrets are never stored here — only ciphertext.
 *   - Safe view (ClientSigningKeyDTO) omits secretCiphertext entirely.
 */

import { eq, desc } from 'drizzle-orm';
import type { PoDb } from '../db.ts';
import { poClientSigningKeys } from '../schema.ts';
import type {
  ClientSigningKeyRepository,
  CreateClientSigningKeyInput,
} from '@northflow/payment-orchestration-core';
import type { ClientSigningKeyDTO, ClientSigningKeyStatus } from '@northflow/payment-orchestration-core';

export class DrizzleClientSigningKeyRepository implements ClientSigningKeyRepository {
  constructor(private readonly db: PoDb) {}

  async create(input: CreateClientSigningKeyInput): Promise<ClientSigningKeyDTO> {
    const rows = await this.db
      .insert(poClientSigningKeys)
      .values({
        id: input.id,
        clientId: input.clientId,
        keyPrefix: input.keyPrefix,
        secretCiphertext: input.secretCiphertext,
        secretKeyVersion: input.secretKeyVersion ?? null,
        status: 'active',
        expiresAt: input.expiresAt ?? null,
        metadata: (input.metadata ?? {}) as Record<string, unknown>,
      })
      .returning();
    return this.#mapSafe(rows[0]!);
  }

  async findById(id: string): Promise<ClientSigningKeyDTO | null> {
    const rows = await this.db
      .select()
      .from(poClientSigningKeys)
      .where(eq(poClientSigningKeys.id, id))
      .limit(1);
    return rows[0] ? this.#mapSafe(rows[0]) : null;
  }

  /**
   * findByPrefix — returns matching rows as safe view.
   * Callers that need to decrypt must use findByPrefixWithCiphertext.
   */
  async findByPrefix(prefix: string): Promise<ClientSigningKeyDTO[]> {
    const rows = await this.db
      .select()
      .from(poClientSigningKeys)
      .where(eq(poClientSigningKeys.keyPrefix, prefix));
    return rows.map((r) => this.#mapSafe(r));
  }

  /**
   * findByPrefixWithCiphertext — returns rows including secretCiphertext for auth middleware.
   * Must only be called by the auth middleware; never exposed via API responses.
   */
  async findByPrefixWithCiphertext(prefix: string): Promise<Array<ClientSigningKeyDTO & { secretCiphertext: string; secretKeyVersion: string | null }>> {
    const rows = await this.db
      .select()
      .from(poClientSigningKeys)
      .where(eq(poClientSigningKeys.keyPrefix, prefix));
    return rows.map((r) => ({
      ...this.#mapSafe(r),
      secretCiphertext: r.secretCiphertext,
      secretKeyVersion: r.secretKeyVersion ?? null,
    }));
  }

  async listByClientId(clientId: string): Promise<ClientSigningKeyDTO[]> {
    const rows = await this.db
      .select()
      .from(poClientSigningKeys)
      .where(eq(poClientSigningKeys.clientId, clientId))
      .orderBy(desc(poClientSigningKeys.createdAt));
    return rows.map((r) => this.#mapSafe(r));
  }

  async revoke(id: string, at: Date): Promise<void> {
    await this.db
      .update(poClientSigningKeys)
      .set({ status: 'revoked', revokedAt: at })
      .where(eq(poClientSigningKeys.id, id));
  }

  async touchLastUsed(id: string, at: Date): Promise<void> {
    await this.db
      .update(poClientSigningKeys)
      .set({ lastUsedAt: at })
      .where(eq(poClientSigningKeys.id, id));
  }

  /**
   * #mapSafe — maps a DB row to the safe public DTO (no secretCiphertext).
   */
  #mapSafe(row: typeof poClientSigningKeys.$inferSelect): ClientSigningKeyDTO {
    return {
      id: row.id,
      clientId: row.clientId,
      keyPrefix: row.keyPrefix,
      status: row.status as ClientSigningKeyStatus,
      expiresAt: row.expiresAt ?? null,
      lastUsedAt: row.lastUsedAt ?? null,
      createdAt: row.createdAt,
      revokedAt: row.revokedAt ?? null,
      metadata: (row.metadata as Record<string, unknown>) ?? {},
    };
  }
}
