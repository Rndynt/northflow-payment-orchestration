/**
 * reconcile worker entry point — callable without starting Express.
 */

import { loadEnv } from '../config/env.ts';
import { createContainer } from '../container.ts';
import type { ReconcilePaymentIntentTotals } from '../application/use-cases/ReconcilePaymentIntentTotals.ts';

export interface ReconcileWorkerInput {
  merchantId: string;
  intentId: string;
}

export async function executeReconcileWorker(
  useCase: ReconcilePaymentIntentTotals,
  input: ReconcileWorkerInput,
) {
  return useCase.execute(input);
}

export async function runReconcileWorker(input: ReconcileWorkerInput) {
  const container = createContainer(loadEnv());
  return executeReconcileWorker(container.useCases.reconcilePaymentIntentTotals, input);
}
