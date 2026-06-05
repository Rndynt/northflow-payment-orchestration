/**
 * expireStale worker entry point — callable without starting Express.
 *
 * No cron scheduler is registered in Phase 8I. Deployments can schedule this module
 * with platform cron or a queue worker once extraction simulation is complete.
 */

import { loadEnv } from '../config/env.ts';
import { createContainer } from '../container.ts';
import type { ExpireStalePaymentTransactions } from '../application/use-cases/ExpireStalePaymentTransactions.ts';
import type { ExpireStalePaymentTransactionsInput } from '../application/use-cases/ExpireStalePaymentTransactions.ts';

export async function executeExpireStaleWorker(
  useCase: ExpireStalePaymentTransactions,
  input: ExpireStalePaymentTransactionsInput = {},
) {
  return useCase.execute(input);
}

export async function runExpireStaleWorker(input: ExpireStalePaymentTransactionsInput = {}) {
  const container = createContainer(loadEnv());
  if (!container.useCases.expireStalePaymentTransactions) {
    throw new Error('Expire stale use case is not wired.');
  }
  return executeExpireStaleWorker(container.useCases.expireStalePaymentTransactions, input);
}
