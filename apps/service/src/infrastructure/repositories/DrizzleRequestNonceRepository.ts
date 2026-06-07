/**
 * DrizzleRequestNonceRepository — S9.4: nonce replay protection store.
 *
 * consume() is atomic: it attempts to INSERT the nonce row.
 * If the unique constraint (signing_key_id, nonce) is violated, it returns { consumed: false }.
 * Callers must treat non-consumed nonces as a replay attack and reject the request.
 *
 * cleanupExpired() deletes rows where expires_at < now. Safe to run on a schedule.
 */

import { lt } from 'drizzle-orm';
import type { PoDb } from '../db.ts';
import { poRequestNonces } from '../schema.ts';
import type { RequestNonceRepository, ConsumeNonceInput } from '@northflow/payment-orchestration-core';

export class DrizzleRequestNonceRepository implements RequestNonceRepository {
  constructor(private readonly db: PoDb) {}

  /**
   * consume — atomically insert the nonce row.
   * Returns { consumed: true } on success.
   * Returns { consumed: false } if the nonce was already used (unique constraint violation).
   * Throws on any other DB error — caller must fail closed.
   */
  async consume(input: ConsumeNonceInput): Promise<{ consumed: boolean }> {
    try {
      await this.db
        .insert(poRequestNonces)
        .values({
          id: input.id,
          clientId: input.clientId,
          signingKeyId: input.signingKeyId,
          nonce: input.nonce,
          timestamp: input.timestamp,
          expiresAt: input.expiresAt,
          metadata: {},
        });
      return { consumed: true };
    } catch (err: unknown) {
      const e = err as { code?: string; constraint?: string; message?: string };
      const isUnique =
        e.code === '23505' ||
        (e.constraint ?? '').includes('key_nonce_unique') ||
        (e.message ?? '').toLowerCase().includes('unique');
      if (isUnique) {
        return { consumed: false };
      }
      throw err;
    }
  }

  /**
   * cleanupExpired — delete nonce rows that have passed their expires_at.
   * Returns the number of deleted rows.
   */
  async cleanupExpired(now: Date): Promise<number> {
    const deleted = await this.db
      .delete(poRequestNonces)
      .where(lt(poRequestNonces.expiresAt, now))
      .returning({ id: poRequestNonces.id });
    return deleted.length;
  }
}
