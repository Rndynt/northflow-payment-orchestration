import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as serviceSchema from '../apps/service/src/infrastructure/schema.ts';

describe('payment orchestration schema boundary', () => {
  test('service-local owned schema exports payment orchestration tables', () => {
    assert.ok(serviceSchema.paymentOrchestrationMerchants);
    assert.ok(serviceSchema.paymentOrchestrationProviderAccounts);
    assert.ok(serviceSchema.paymentOrchestrationIntents);
    assert.ok(serviceSchema.paymentOrchestrationTransactions);
    assert.ok(serviceSchema.paymentOrchestrationTransactions.expiresAt);
    assert.ok(serviceSchema.paymentOrchestrationProviderEvents);
    assert.ok(serviceSchema.paymentOrchestrationIdempotencyKeys);
  });

  test('standalone repositories import through service-local schema boundary', () => {
    const repoDir = join(process.cwd(), 'apps/service/src/infrastructure/repositories');
    const violations = readdirSync(repoDir)
      .filter((name) => name.endsWith('.ts'))
      .filter((name) => readFileSync(join(repoDir, name), 'utf8').includes('shared/schema'));
    assert.deepEqual(violations, []);
  });
});
