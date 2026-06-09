import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PaymentOrchestrationClient } from '../packages/client-sdk/src/client.ts';
import { PaymentOrchestrationClientError } from '../packages/client-sdk/src/errors.ts';
import type {
  CreatePaymentIntentRequest,
  CreateGatewayPaymentRequest,
  RefundPaymentTransactionRequest,
} from '../packages/client-sdk/src/types.ts';

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify({ ok: status < 400, data }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('S10.2 SDK exposes official integration methods only', () => {
  const client = new PaymentOrchestrationClient({ baseUrl: 'http://northflow.test' });
  for (const method of [
    'createPaymentIntent',
    'getPaymentIntentStatus',
    'getRefundability',
    'createGatewayPayment',
    'refreshProviderStatus',
    'getPaymentOptions',
    'refundPaymentTransaction',
    'voidPaymentTransaction',
    'reconcilePaymentIntentTotals',
    'createMerchant',
    'getMerchant',
    'createProviderAccount',
    'getProviderAccount',
    'listProviderAccountMethods',
    'upsertProviderAccountMethod',
    'syncProviderAccountMethods',
    'createSigningKey',
    'listSigningKeys',
    'rotateSigningKey',
    'revokeSigningKey',
    'createMerchantWebhookEndpoint',
    'listMerchantWebhookEndpoints',
    'disableMerchantWebhookEndpoint',
    'rotateMerchantWebhookEndpointSecret',
    'listMerchantWebhookDeliveries',
    'replayMerchantWebhook',
    'confirmFakeGatewayPayment',
    'getReadiness',
  ]) {
    assert.equal(typeof (client as unknown as Record<string, unknown>)[method], 'function', method);
  }

  for (const removed of ['refundTransaction', 'voidTransaction', 'deleteProviderAccountMethod']) {
    assert.equal((client as unknown as Record<string, unknown>)[removed], undefined, `${removed} should not exist on SDK client`);
  }
});

test('S10.2 SDK injects merchantId into configured mutation bodies', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return jsonResponse({ id: 'pi_1', merchantId: 'mer_1', status: 'requires_payment' });
  }) as typeof fetch;

  try {
    const client = new PaymentOrchestrationClient({
      baseUrl: 'http://northflow.test/',
      apiKey: 'nf.test.cred.secret',
      merchantId: 'mer_1',
      sourceApp: 'checkout-backend',
    });
    await client.createPaymentIntent({
      externalPayableType: 'order',
      externalPayableId: 'order_1',
      currency: 'IDR',
      amountDue: 1000,
    });

    assert.equal(calls[0]!.url, 'http://northflow.test/v1/payment-intents');
    assert.equal((calls[0]!.init.headers as Record<string, string>)['authorization'], 'Bearer nf.test.cred.secret');
    assert.equal((calls[0]!.init.headers as Record<string, string>)['x-payment-merchant-id'], 'mer_1');
    assert.equal((calls[0]!.init.headers as Record<string, string>)['x-source-app'], 'checkout-backend');
    assert.equal(JSON.parse(String(calls[0]!.init.body)).merchantId, 'mer_1');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('S10.2 SDK request interfaces accept plain object shapes without index signatures', () => {
  const intent: CreatePaymentIntentRequest = {
    externalPayableType: 'order',
    externalPayableId: 'order_1',
    currency: 'IDR',
    amountDue: 1000,
  };
  const payment: CreateGatewayPaymentRequest = { provider: 'fake_gateway', method: 'qris', amount: 1000 };
  const refund: RefundPaymentTransactionRequest = { amount: 1000 };
  assert.equal(intent.externalPayableId, 'order_1');
  assert.equal(payment.method, 'qris');
  assert.equal(refund.amount, 1000);
});

test('S10.2 SDK error class supports object-style and positional constructors', () => {
  const objectStyle = new PaymentOrchestrationClientError('denied', { status: 403, code: 'DENIED', details: { scope: 'x' } });
  const positional = new PaymentOrchestrationClientError('conflict', 409, 'IDEMPOTENCY_CONFLICT', { key: 'k' });
  assert.equal(objectStyle.status, 403);
  assert.equal(objectStyle.code, 'DENIED');
  assert.deepEqual(objectStyle.details, { scope: 'x' });
  assert.equal(positional.status, 409);
  assert.equal(positional.code, 'IDEMPOTENCY_CONFLICT');
  assert.deepEqual(positional.details, { key: 'k' });
});

test('S10.2 SDK signed requests build Northflow HMAC headers', async () => {
  const calls: Array<{ init: RequestInit }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    calls.push({ init: init ?? {} });
    return jsonResponse({ ok: true, service: 'northflow', providers: {}, database: 'unconfigured' });
  }) as typeof fetch;

  try {
    const client = new PaymentOrchestrationClient({
      baseUrl: 'http://northflow.test',
      apiKey: 'nf.test.cred.secret',
      signing: { enabled: true, clientId: 'client_1', keyId: 'sk_1', secret: 'raw-secret' },
    });
    await client.getReadiness();
    const headers = calls[0]!.init.headers as Record<string, string>;
    assert.equal(headers['x-nf-client-id'], 'client_1');
    assert.equal(headers['x-nf-key-id'], 'sk_1');
    assert.equal(headers['x-nf-signature-version'], 'v1');
    assert.ok(headers['x-nf-signature']);
    assert.ok(headers['x-nf-nonce']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('S10.2 SDK admin routes match service route mounts and do not expose provider credentials in response types', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return jsonResponse({ id: 'ok', merchantId: 'mer_1', provider: 'fake_gateway', environment: 'test', providerAccountRef: null, status: 'active', publicConfig: {}, metadata: {} });
  }) as typeof fetch;

  try {
    const client = new PaymentOrchestrationClient({ baseUrl: 'http://northflow.test', merchantId: 'mer_1' });
    await client.createProviderAccount('mer_1', { provider: 'fake_gateway', environment: 'test', credentialsRef: 'secret-store://provider/account' });
    await client.getProviderAccount('mer_1', 'pa_1');
    await client.listProviderAccountMethods('mer_1', 'pa_1');
    await client.upsertProviderAccountMethod('mer_1', 'pa_1', { method: 'qris', methodType: 'qris' });
    await client.syncProviderAccountMethods('mer_1', 'pa_1');
    await client.createSigningKey('client_1', { expiresAt: null });
    await client.listSigningKeys('client_1');
    await client.rotateSigningKey('client_1', { revokeOldKeyId: 'sk_old' });
    await client.revokeSigningKey('client_1', 'sk_1');

    assert.deepEqual(calls.map((call) => call.url), [
      'http://northflow.test/v1/merchants/mer_1/provider-accounts',
      'http://northflow.test/v1/merchants/mer_1/provider-accounts/pa_1',
      'http://northflow.test/v1/merchants/mer_1/provider-accounts/pa_1/methods',
      'http://northflow.test/v1/merchants/mer_1/provider-accounts/pa_1/methods/qris',
      'http://northflow.test/v1/merchants/mer_1/provider-accounts/pa_1/methods/sync',
      'http://northflow.test/v1/api-clients/client_1/signing-keys',
      'http://northflow.test/v1/api-clients/client_1/signing-keys',
      'http://northflow.test/v1/api-clients/client_1/signing-keys/rotate',
      'http://northflow.test/v1/api-clients/client_1/signing-keys/sk_1/revoke',
    ]);

    const types = readFileSync('packages/client-sdk/src/types.ts', 'utf8');
    assert.match(types, /credentialsRef\?: string \| null/);
    assert.doesNotMatch(types, /interface ProviderAccountResponse[\s\S]*credentialsRef/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('S10.2 SDK method types match current Northflow method type names', () => {
  const methodTypes = ['qris', 'virtual_account', 'ewallet', 'card', 'retail_outlet', 'manual', 'other'];
  assert.deepEqual(methodTypes, ['qris', 'virtual_account', 'ewallet', 'card', 'retail_outlet', 'manual', 'other']);
});
