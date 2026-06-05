import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { executeExpireStaleWorker } from '../apps/service/src/workers/expireStale.ts';
import { executeReconcileWorker } from '../apps/service/src/workers/reconcile.ts';

describe('payment orchestration operations workers', () => {
  test('expire stale worker is callable without Express', async () => {
    const result = await executeExpireStaleWorker({ execute: async () => ({ expiredIntents: 0, expiredTransactions: 0, skippedTransactions: 0, summaries: [] }) } as any, { limit: 1 });
    assert.equal(result.expiredIntents, 0);
  });

  test('reconcile worker is callable without Express', async () => {
    const result = await executeReconcileWorker({ execute: async (input: any) => ({ intent: { id: input.intentId }, transactions: [], changed: false }) } as any, { merchantId: 'merchant_1', intentId: 'intent_1' });
    assert.equal(result.intent.id, 'intent_1');
  });
});
