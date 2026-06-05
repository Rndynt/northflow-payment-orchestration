import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createProviderRegistry } from '../apps/service/src/infrastructure/providers/providerRegistry.ts';
import { createXenditSandboxHttpClient, loadXenditRuntimeConfig } from '../apps/service/src/infrastructure/providers/xenditHttpClient.ts';

describe('xendit runtime HTTP client policy', () => {
  test('loads disabled-by-default env policy without exposing token values', () => {
    const config = loadXenditRuntimeConfig({
      PAYMENT_ORCHESTRATION_XENDIT_CALLBACK_TOKEN: 'secret-token',
    } as NodeJS.ProcessEnv);
    assert.equal(config.enabled, false);
    assert.equal(config.callbackTokenConfigured, true);
    assert.equal(config.configured, false);
    assert.equal(JSON.stringify(config).includes('secret-token'), false);
  });

  test('disabled HTTP client fails with stable unconfigured code and no live network', async () => {
    const client = createXenditSandboxHttpClient({ enabled: false, fetchImpl: async () => {
      throw new Error('network must not be called');
    } });
    await assert.rejects(
      () => client({ method: 'POST', url: 'https://xendit.test', headers: {}, body: {} }),
      (error: any) => error.code === 'PROVIDER_HTTP_CLIENT_UNCONFIGURED',
    );
  });

  test('registry keeps xendit registered but unconfigured unless explicitly enabled', () => {
    const registry = createProviderRegistry('test', { xenditSandboxEnabled: false });
    assert.ok(registry.get('xendit_sandbox'));
    assert.ok(registry.get('fake_gateway'));
  });
});
