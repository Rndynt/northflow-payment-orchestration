/**
 * Standalone payment-orchestration worker runner.
 *
 * Runs without Express and prints JSON summaries. Operations intentionally avoid
 * real provider network calls unless a specific future worker explicitly opts in.
 */

import { loadEnv } from '../config/env.ts';
import { createContainer } from '../container.ts';
import type { ServiceContainer } from '../container.ts';

export type WorkerOperation = 'expire-stale' | 'reconcile-intent' | 'reprocess-provider-events' | 'all-safe';

export interface WorkerDispatchInput {
  operation: WorkerOperation;
  merchantId?: string;
  intentId?: string;
  olderThanMinutes?: number;
  limit?: number;
  now?: Date;
}

export interface WorkerDispatchResult {
  operation: WorkerOperation;
  ok: boolean;
  results: Record<string, unknown>;
}

export async function dispatchWorkerOperation(
  container: Pick<ServiceContainer, 'useCases'>,
  input: WorkerDispatchInput,
): Promise<WorkerDispatchResult> {
  const results: Record<string, unknown> = {};

  if (input.operation === 'expire-stale' || input.operation === 'all-safe') {
    if (!container.useCases.expireStalePaymentTransactions) {
      throw new Error('Expire stale use case is not wired.');
    }
    results['expireStale'] = await container.useCases.expireStalePaymentTransactions.execute({
      now: input.now,
      limit: input.limit,
    });
  }

  if (input.operation === 'reprocess-provider-events' || input.operation === 'all-safe') {
    if (!container.useCases.reprocessProviderEvents) {
      throw new Error('Reprocess provider events use case is not wired.');
    }
    results['reprocessProviderEvents'] = await container.useCases.reprocessProviderEvents.execute({
      olderThanMinutes: input.olderThanMinutes,
      limit: input.limit,
    });
  }

  if (input.operation === 'reconcile-intent') {
    if (!input.merchantId || !input.intentId) {
      throw new Error('reconcile-intent requires --merchant-id and --intent-id.');
    }
    results['reconcileIntent'] = await container.useCases.reconcilePaymentIntentTotals.execute({
      merchantId: input.merchantId,
      intentId: input.intentId,
    });
  }

  return { operation: input.operation, ok: true, results };
}

function parseArgs(argv: string[]): WorkerDispatchInput {
  const [operationRaw, ...rest] = argv;
  const operation = operationRaw as WorkerOperation | undefined;
  if (!operation || !['expire-stale', 'reconcile-intent', 'reprocess-provider-events', 'all-safe'].includes(operation)) {
    throw new Error('Usage: run.ts <expire-stale|reconcile-intent|reprocess-provider-events|all-safe> [--merchant-id id] [--intent-id id] [--limit n] [--older-than-minutes n] [--now iso]');
  }

  const input: WorkerDispatchInput = { operation };
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    const next = rest[i + 1];
    if (arg === '--merchant-id') { input.merchantId = next; i += 1; }
    else if (arg === '--intent-id') { input.intentId = next; i += 1; }
    else if (arg === '--limit') { input.limit = Number(next); i += 1; }
    else if (arg === '--older-than-minutes') { input.olderThanMinutes = Number(next); i += 1; }
    else if (arg === '--now') { input.now = new Date(String(next)); i += 1; }
    else throw new Error(`Unknown worker argument: ${arg}`);
  }
  return input;
}

export async function runWorkerCli(argv = process.argv.slice(2)): Promise<void> {
  const input = parseArgs(argv);
  const container = createContainer(loadEnv());
  const result = await dispatchWorkerOperation(container, input);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1]?.endsWith('/workers/run.ts') || process.argv[1]?.endsWith('\\workers\\run.ts')) {
  runWorkerCli().catch((err) => {
    const message = err?.message ?? String(err);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message }, null, 2)}\n`);
    process.exitCode = 1;
  });
}
