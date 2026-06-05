import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { createApp } from '../apps/service/src/app.ts';
import type { ServiceContainer } from '../apps/service/src/container.ts';
import { createProviderRegistry } from '../apps/service/src/infrastructure/providers/providerRegistry.ts';

async function getJson(app: ReturnType<typeof createApp>, path: string) {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as AddressInfo;
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`);
    return { status: response.status, body: await response.json() as any };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('payment orchestration readiness endpoint', () => {
  test('reports provider readiness without exposing secrets or raw env values', async () => {
    const container = {
      config: {
        port: 5100,
        nodeEnv: 'test',
        serviceToken: 'service-secret',
        dbUrl: 'postgres://user:password@example/db',
        version: 'test',
        phase: '8I',
        xenditSandboxEnabled: false,
        xenditBaseUrl: 'https://api.xendit.co',
        xenditCallbackTokenConfigured: true,
      },
      db: {} as any,
      repos: {} as any,
      providerRegistry: createProviderRegistry('test', { xenditSandboxEnabled: false }),
      useCases: {} as any,
    } satisfies ServiceContainer;

    const { status, body } = await getJson(createApp(container), '/ready');
    const serialized = JSON.stringify(body);
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.providers.xendit_sandbox.registered, true);
    assert.equal(body.providers.xendit_sandbox.configured, false);
    assert.equal(serialized.includes('service-secret'), false);
    assert.equal(serialized.includes('password'), false);
  });
});
