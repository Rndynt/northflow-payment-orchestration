import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
function read(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8');
}

test('S10.2.1 client SDK removed pre-launch aliases and argument guessing helpers', () => {
  const client = read('packages/client-sdk/src/client.ts');
  const index = read('packages/client-sdk/src/index.ts');
  const errors = read('packages/client-sdk/src/errors.ts');
  const types = read('packages/client-sdk/src/types.ts');

  assert.doesNotMatch(client, /refundTransaction\s*\(/);
  assert.doesNotMatch(client, /voidTransaction\s*\(/);
  assert.doesNotMatch(client, /PaymentEngineClient/);
  assert.doesNotMatch(index, /PaymentEngine/);
  assert.doesNotMatch(errors, /PaymentEngine/);
  assert.doesNotMatch(types, /PaymentEngineClientConfig/);
  assert.doesNotMatch(client, /resolveMerchantProviderAccountArgs|resolveDeleteProviderAccountMethodArgs|isLikelyProviderAccountId|isLikelyMerchantId/);

  assert.match(client, /listProviderAccountMethods\(merchantId: string, providerAccountId: string\)/);
  assert.match(client, /upsertProviderAccountMethod\(merchantId: string, providerAccountId: string, input: UpsertProviderAccountMethodRequest\)/);
  assert.match(client, /deleteProviderAccountMethod\(merchantId: string, providerAccountId: string, method: string\)/);
  assert.match(client, /syncProviderAccountMethods\(merchantId: string, providerAccountId: string\)/);
  assert.doesNotMatch(client, /listProviderAccountMethods\(providerAccountId: string\)/);
  assert.doesNotMatch(client, /upsertProviderAccountMethod\(providerAccountId: string, input:/);
  assert.doesNotMatch(client, /deleteProviderAccountMethod\(providerAccountId: string, method: string\)/);
  assert.doesNotMatch(client, /syncProviderAccountMethods\(providerAccountId: string\)/);
});

test('S10.2.1 core and service no longer expose Standalone compatibility shims', () => {
  for (const file of [
    'packages/core/src/domain/PaymentIntent.ts',
    'packages/core/src/domain/PaymentTransaction.ts',
    'packages/core/src/application/ports.ts',
    'packages/core/src/application/domain.ts',
    'packages/core/src/index.ts',
    'apps/service/src/infrastructure/providers/PaymentProviderAdapter.ts',
    'apps/service/src/infrastructure/providers/ManualProvider.ts',
    'apps/service/src/infrastructure/providers/FakeGatewayProvider.ts',
  ]) {
    assert.doesNotMatch(read(file), /Standalone[A-Z]|IStandalone/);
  }

  for (const removedShim of [
    'apps/service/src/infrastructure/providers/StandalonePaymentProvider.ts',
    'apps/service/src/infrastructure/providers/StandaloneManualProvider.ts',
    'apps/service/src/infrastructure/providers/StandaloneFakeGatewayProvider.ts',
  ]) {
    assert.equal(existsSync(join(ROOT, removedShim)), false, `${removedShim} should be removed`);
  }
});

test('S10.2.1 current docs and examples do not present removed SDK aliases or providerAccountId-first method calls', () => {
  for (const file of [
    'docs/payment-orchestration-sdk-contract.md',
    'docs/integration/client-integration-contract.md',
    'examples/merchant-backend/sdk-checkout-flow.ts',
    'examples/merchant-backend/README.md',
  ]) {
    const text = read(file);
    assert.doesNotMatch(text, /PaymentEngineClient|PaymentEngineClientError|PaymentEngineNetworkError|PaymentEngineClientConfig/);
    assert.doesNotMatch(text, /refundTransaction\s*\(/);
    assert.doesNotMatch(text, /voidTransaction\s*\(/);
    assert.doesNotMatch(text, /listProviderAccountMethods\([^,\n]+\)/);
    assert.doesNotMatch(text, /upsertProviderAccountMethod\([^,\n]+,\s*\{/);
    assert.doesNotMatch(text, /deleteProviderAccountMethod\([^,\n]+,\s*[^,\n]+\)/);
    assert.doesNotMatch(text, /syncProviderAccountMethods\([^,\n]+\)/);
  }
});
