/**
 * db — standalone DB connection for payment-orchestration-service.
 *
 * Tables use the po_* prefix (shortened from payment_orchestration_*).
 *
 * Design constraints:
 * - prepare: false  (NeonDB/PgBouncer-compatible)
 * - max: 3          (standalone service keeps a small pool)
 *
 * DB URL resolution order:
 *   PAYMENT_ORCHESTRATION_DATABASE_URL → DATABASE_URL
 *
 * Migrations:
 *   pnpm db:migrate   (official — Drizzle managed)
 *   pnpm db:generate  (generate diff after schema changes)
 */

import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import {
  poMerchants,
  poProviderAccounts,
  poIntents,
  poTransactions,
  poProviderEvents,
  poIdempotencyKeys,
  poApiClients,
  poClientCredentials,
  poClientMerchantAccess,
} from './schema.ts';

export const poSchema = {
  poMerchants,
  poProviderAccounts,
  poIntents,
  poTransactions,
  poProviderEvents,
  poIdempotencyKeys,
  poApiClients,
  poClientCredentials,
  poClientMerchantAccess,
};

export type PoDb = ReturnType<typeof createPoDb>;

export function createPoDb(dbUrl: string) {
  if (!dbUrl) {
    throw new Error(
      '[payment-orchestration-service/db] DATABASE_URL or ' +
        'PAYMENT_ORCHESTRATION_DATABASE_URL is required.',
    );
  }
  const sql = postgres(dbUrl, {
    max: 3,
    idle_timeout: 10,
    connect_timeout: 10,
    max_lifetime: 60 * 30,
    prepare: false,
    transform: { undefined: null },
  });
  return drizzle(sql, { schema: poSchema });
}
