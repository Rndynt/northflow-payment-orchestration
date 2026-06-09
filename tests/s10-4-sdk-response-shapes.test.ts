/**
 * S10.4 — SDK response-shape contract test
 *
 * Verifies that the SDK correctly unwraps `{ ok: true, data: X }` service envelopes
 * and that the TypeScript types match the actual unwrapped shapes.
 *
 * These tests mock `fetch` to return the exact JSON a real service would produce,
 * then assert the SDK returns the correct unwrapped value.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PaymentOrchestrationClient } from '@northflow/payment-orchestration-client-sdk';

// ── helpers ───────────────────────────────────────────────────────────────────
function mockFetch(serviceJson: unknown) {
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(serviceJson), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
  return () => { globalThis.fetch = original; };
}

function mockFetchStatus(status: number, serviceJson: unknown) {
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(serviceJson), {
      status,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
  return () => { globalThis.fetch = original; };
}

const client = new PaymentOrchestrationClient({
  baseUrl: 'http://northflow.test',
  apiKey: 'nf.test.cred.secret',
  merchantId: 'mer_1',
  sourceApp: 'test',
});

// ── listProviderAccountMethods ────────────────────────────────────────────────
describe('S10.4 SDK response shapes', () => {

  describe('listProviderAccountMethods', () => {
    it('RS01: unwraps to ProviderAccountMethodResponse[] directly (not { data: [...] })', async () => {
      const methods = [
        { id: 'pm_1', merchantId: 'mer_1', providerAccountId: 'pa_1', method: 'qris', status: 'active' },
        { id: 'pm_2', merchantId: 'mer_1', providerAccountId: 'pa_1', method: 'ewallet', status: 'disabled' },
      ];
      const restore = mockFetch({ ok: true, data: methods });
      try {
        const result = await client.listProviderAccountMethods('mer_1', 'pa_1');
        // Must be array directly, NOT { data: [...] }
        assert.ok(Array.isArray(result), 'result should be an array');
        assert.equal(result.length, 2);
        assert.equal(result[0]!.method, 'qris');
        assert.equal((result as unknown as { data?: unknown }).data, undefined,
          'result must not have a nested .data property');
      } finally { restore(); }
    });
  });

  // ── upsertProviderAccountMethod ───────────────────────────────────────────
  describe('upsertProviderAccountMethod', () => {
    it('RS02: unwraps to { ...method, created: boolean } — created is preserved', async () => {
      const method = { id: 'pm_1', merchantId: 'mer_1', providerAccountId: 'pa_1', method: 'qris', status: 'active' };
      // Service now returns: { ok: true, data: { ...method, created: true } }
      const restore = mockFetchStatus(201, { ok: true, data: { ...method, created: true } });
      try {
        const result = await client.upsertProviderAccountMethod('mer_1', 'pa_1', 'qris', {
          methodType: 'qris',
          displayName: 'QRIS',
          currency: 'IDR',
          status: 'active',
        });
        assert.equal(result.method, 'qris', 'method field preserved');
        assert.equal(result.created, true, 'created=true preserved from envelope');
        assert.equal((result as unknown as { data?: unknown }).data, undefined,
          'result must not have a nested .data property');
      } finally { restore(); }
    });

    it('RS03: created=false on update', async () => {
      const method = { id: 'pm_1', merchantId: 'mer_1', providerAccountId: 'pa_1', method: 'qris', status: 'active' };
      const restore = mockFetchStatus(200, { ok: true, data: { ...method, created: false } });
      try {
        const result = await client.upsertProviderAccountMethod('mer_1', 'pa_1', 'qris', {
          methodType: 'qris',
          displayName: 'QRIS',
          currency: 'IDR',
          status: 'active',
        });
        assert.equal(result.created, false, 'created=false on update');
      } finally { restore(); }
    });
  });

  // ── syncProviderAccountMethods ────────────────────────────────────────────
  describe('syncProviderAccountMethods', () => {
    it('RS04: unwraps to { methods, syncedCount, skippedCount, message } directly', async () => {
      const innerData = {
        methods: [{ id: 'pm_1', method: 'qris' }],
        syncedCount: 1,
        skippedCount: 0,
        message: 'Sync completed.',
      };
      const restore = mockFetch({ ok: true, data: innerData });
      try {
        const result = await client.syncProviderAccountMethods('mer_1', 'pa_1');
        assert.equal(result.syncedCount, 1, 'syncedCount');
        assert.equal(result.skippedCount, 0, 'skippedCount');
        assert.equal(result.message, 'Sync completed.', 'message');
        assert.ok(Array.isArray(result.methods), 'methods is array');
        assert.equal((result as unknown as { data?: unknown }).data, undefined,
          'result must not have a nested .data property');
      } finally { restore(); }
    });
  });

  // ── getPaymentOptions ────────────────────────────────────────────────────
  describe('getPaymentOptions', () => {
    it('RS05: unwraps to { intentId, merchantId, currency, amountRemaining, options } directly', async () => {
      const innerData = {
        intentId: 'pi_1',
        merchantId: 'mer_1',
        currency: 'IDR',
        amountRemaining: 50000,
        options: [{ method: 'qris', methodType: 'qris', displayName: 'QRIS' }],
      };
      const restore = mockFetch({ ok: true, data: innerData });
      try {
        const result = await client.getPaymentOptions('pi_1');
        assert.equal(result.intentId, 'pi_1', 'intentId');
        assert.equal(result.currency, 'IDR', 'currency');
        assert.equal(result.amountRemaining, 50000, 'amountRemaining');
        assert.ok(Array.isArray(result.options), 'options is array');
        assert.equal((result as unknown as { data?: unknown }).data, undefined,
          'result must not have a nested .data property');
      } finally { restore(); }
    });
  });

  // ── Merchant webhook methods ─────────────────────────────────────────────
  describe('createMerchantWebhookEndpoint', () => {
    it('RS06: unwraps to { endpoint, rawSecret }', async () => {
      const data = {
        endpoint: { id: 'mwe_1', merchantId: 'mer_1', url: 'https://cb.test/', status: 'active', subscribedEvents: [], secretPrefix: 'nf_whs_te' },
        rawSecret: 'nf_whs_test_abc123xyz',
      };
      const restore = mockFetchStatus(201, { ok: true, data });
      try {
        const result = await client.createMerchantWebhookEndpoint('mer_1', { url: 'https://cb.test/' });
        assert.equal(result.endpoint.id, 'mwe_1');
        assert.equal(result.rawSecret, 'nf_whs_test_abc123xyz');
      } finally { restore(); }
    });
  });

  describe('listMerchantWebhookEndpoints', () => {
    it('RS07: unwraps to { endpoints: [...] }', async () => {
      const data = {
        endpoints: [
          { id: 'mwe_1', merchantId: 'mer_1', url: 'https://cb.test/', status: 'active' },
        ],
      };
      const restore = mockFetch({ ok: true, data });
      try {
        const result = await client.listMerchantWebhookEndpoints('mer_1');
        assert.ok(Array.isArray(result.endpoints));
        assert.equal(result.endpoints[0]!.id, 'mwe_1');
      } finally { restore(); }
    });
  });

  describe('listMerchantWebhookDeliveries', () => {
    it('RS08: unwraps to { deliveries: [...] }', async () => {
      const data = {
        deliveries: [
          { id: 'del_1', eventId: 'evt_1', endpointId: 'mwe_1', status: 'succeeded' },
        ],
      };
      const restore = mockFetch({ ok: true, data });
      try {
        const result = await client.listMerchantWebhookDeliveries('mer_1');
        assert.ok(Array.isArray(result.deliveries));
        assert.equal(result.deliveries[0]!.id, 'del_1');
      } finally { restore(); }
    });
  });

  // ── Error envelope unwrapping ────────────────────────────────────────────
  describe('error handling', () => {
    it('RS09: SDK throws PaymentOrchestrationClientError with code and status on 403', async () => {
      const restore = mockFetchStatus(403, {
        ok: false,
        error: { code: 'SCOPE_DENIED', message: 'Missing required scope: payment:create', details: null },
      });
      try {
        await assert.rejects(
          () => client.createPaymentIntent({ externalPayableType: 'order', externalPayableId: 'o_1', currency: 'IDR', amountDue: 1000 }),
          (err: { code?: string; status?: number }) => {
            assert.equal(err.code, 'SCOPE_DENIED');
            assert.equal(err.status, 403);
            return true;
          },
        );
      } finally { restore(); }
    });

    it('RS10: SDK throws PaymentOrchestrationClientError on 401 UNAUTHORIZED', async () => {
      const restore = mockFetchStatus(401, {
        ok: false,
        error: { code: 'UNAUTHORIZED', message: 'Credential not found or revoked.', details: null },
      });
      try {
        await assert.rejects(
          () => client.createMerchant({ externalRef: 'ref_1', name: 'Test', currency: 'IDR' }),
          (err: { code?: string; status?: number }) => {
            assert.equal(err.code, 'UNAUTHORIZED');
            assert.equal(err.status, 401);
            return true;
          },
        );
      } finally { restore(); }
    });
  });

  // ── URL construction ─────────────────────────────────────────────────────
  describe('URL construction', () => {
    it('RS11: webhook endpoint URL is merchantId-first', async () => {
      const calls: string[] = [];
      const original = globalThis.fetch;
      globalThis.fetch = (async (url: string | URL | Request) => {
        calls.push(String(url));
        return new Response(JSON.stringify({ ok: true, data: { endpoints: [] } }), { headers: { 'content-type': 'application/json' } });
      }) as typeof fetch;
      try {
        await client.listMerchantWebhookEndpoints('mer_abc');
        assert.ok(calls[0]!.includes('/v1/merchants/mer_abc/webhooks/endpoints'), calls[0]);
      } finally { globalThis.fetch = original; }
    });

    it('RS12: provider account method URL is merchantId/providerAccountId/methods/sync', async () => {
      const calls: string[] = [];
      const original = globalThis.fetch;
      globalThis.fetch = (async (url: string | URL | Request) => {
        calls.push(String(url));
        return new Response(JSON.stringify({ ok: true, data: { methods: [], syncedCount: 0, skippedCount: 0, message: '' } }), { headers: { 'content-type': 'application/json' } });
      }) as typeof fetch;
      try {
        await client.syncProviderAccountMethods('mer_1', 'pa_1');
        assert.ok(calls[0]!.includes('/v1/merchants/mer_1/provider-accounts/pa_1/methods/sync'), calls[0]);
      } finally { globalThis.fetch = original; }
    });
  });
});
