/**
 * db — standalone DB connection for payment-orchestration-service.
 *
 * Phase 8D: wires a dedicated Drizzle/postgres.js connection for the
 * standalone payment_orchestration_* tables.
 *
 * DB URL resolution order:
 *   PAYMENT_ORCHESTRATION_DATABASE_URL → DATABASE_URL
 *
 * Design constraints:
 * - prepare: false  (NeonDB/PgBouncer-compatible — same as apps/api pattern)
 * - max: 3          (standalone service keeps a small pool)
 * - No AuraPoS session/tenant middleware imported here.
 * - Schema imported from service-local schema.ts (standalone payment_orchestration_* ownership).
 *
 * Migrations:
 *   Run manually: psql $DATABASE_URL -f apps/payment-orchestration-service/migrations/0001_payment_orchestration_initial.sql
 *   Do NOT auto-run migrations at startup.
 */

import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import {
  paymentOrchestrationMerchants,
  paymentOrchestrationProviderAccounts,
  paymentOrchestrationIntents,
  paymentOrchestrationTransactions,
  paymentOrchestrationProviderEvents,
  paymentOrchestrationIdempotencyKeys,
  paymentOrchestrationApiClients,
  paymentOrchestrationClientCredentials,
  paymentOrchestrationClientMerchantAccess,
} from './schema.ts';

export const poSchema = {
  paymentOrchestrationMerchants,
  paymentOrchestrationProviderAccounts,
  paymentOrchestrationIntents,
  paymentOrchestrationTransactions,
  paymentOrchestrationProviderEvents,
  paymentOrchestrationIdempotencyKeys,
  paymentOrchestrationApiClients,
  paymentOrchestrationClientCredentials,
  paymentOrchestrationClientMerchantAccess,
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
