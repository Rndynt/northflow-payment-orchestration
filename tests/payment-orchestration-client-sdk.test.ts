import test from 'node:test';
import assert from 'node:assert/strict';
import { PaymentOrchestrationClient } from '../packages/client-sdk/src/client.ts';
import { PaymentOrchestrationClientError } from '../packages/client-sdk/src/errors.ts';
import type {
  RefundPaymentTransactionRequest,
  RefundPaymentTransactionResponse,
  VoidPaymentTransactionRequest,
  VoidPaymentTransactionResponse,
} from '../packages/client-sdk/src/types.ts';

function intent(status = 'paid') {
  return {
    id: 'intent-1',
    merchantId: 'merchant-1',
    externalPayableType: 'order',
    externalPayableId: 'order-1',
    currency: 'IDR',
    amountDue: 1000,
    amountPaid: 1000,
    amountRefunded: 0,
    amountRemaining: 0,
    status,
    allowPartial: true,
    expiresAt: null,
    createdAt: '2026-06-05T00:00:00.000Z',
    updatedAt: '2026-06-05T00:00:00.000Z',
  };
}

function transaction(id = 'tx-1', status = 'succeeded') {
  return {
    id,
    intentId: 'intent-1',
    merchantId: 'merchant-1',
    provider: 'fake_gateway',
    method: 'qris',
    status,
    amount: 1000,
    currency: 'IDR',
    providerReference: 'fake_ref_1',
    providerPaymentUrl: null,
    providerQrString: null,
    failureReason: null,
    createdAt: '2026-06-05T00:00:00.000Z',
    updatedAt: '2026-06-05T00:00:00.000Z',
  };
}

test('PaymentOrchestrationClient.reconcilePaymentIntentTotals posts to reconcile route and injects merchantId', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(
      JSON.stringify({
        ok: true,
        data: {
          intent: intent('paid'),
          before: { amountPaid: 0, amountRefunded: 0, amountRemaining: 1000, status: 'requires_payment' },
          after: { amountPaid: 1000, amountRefunded: 0, amountRemaining: 0, status: 'paid' },
          changed: true,
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as typeof fetch;

  try {
    const client = new PaymentOrchestrationClient({
      baseUrl: 'http://localhost:5100/',
      apiKey: 'nf.test.credential.secret',
      merchantId: 'merchant-1',
      sourceApp: 'consumer-a',
    });

    const result = await client.reconcilePaymentIntentTotals('intent-1');

    assert.equal(result.changed, true);
    assert.equal(result.intent.status, 'paid');
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.url, 'http://localhost:5100/v1/payment-intents/intent-1/reconcile');
    assert.equal(calls[0]!.init.method, 'POST');
    assert.equal((calls[0]!.init.headers as Record<string, string>)['authorization'], 'Bearer nf.test.credential.secret');
    assert.equal((calls[0]!.init.headers as Record<string, string>)['x-payment-orchestration-service-token'], undefined);
    assert.equal((calls[0]!.init.headers as Record<string, string>)['x-payment-merchant-id'], 'merchant-1');
    assert.equal(calls[0]!.init.body, JSON.stringify({ merchantId: 'merchant-1' }));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('PaymentOrchestrationClient exposes refund/void methods and request/response types compile', () => {
  const client = new PaymentOrchestrationClient({ baseUrl: 'http://localhost:5100' });
  assert.equal(typeof client.refundPaymentTransaction, 'function');
  assert.equal(typeof client.voidPaymentTransaction, 'function');

  const refundRequest: RefundPaymentTransactionRequest = { amount: 100, idempotencyKey: 'refund-key' };
  const voidRequest: VoidPaymentTransactionRequest = { idempotencyKey: 'void-key' };
  const refundResponse: RefundPaymentTransactionResponse = {
    refundTransaction: transaction('refund-1'),
    intent: intent(),
    providerRefunded: true,
    idempotentReplay: false,
  };
  const voidResponse: VoidPaymentTransactionResponse = {
    transaction: transaction('tx-void', 'cancelled'),
    intent: intent(),
    providerCancelled: true,
    idempotentReplay: false,
  };

  assert.equal(refundRequest.idempotencyKey, 'refund-key');
  assert.equal(voidRequest.idempotencyKey, 'void-key');
  assert.equal(refundResponse.providerRefunded, true);
  assert.equal(voidResponse.providerCancelled, true);
});

test('PaymentOrchestrationClient.refundPaymentTransaction posts correct path/body and passes idempotencyKey', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify({
      ok: true,
      data: {
        refundTransaction: transaction('refund-1'),
        intent: intent(),
        providerRefunded: true,
        idempotentReplay: false,
        refundableRemaining: 900,
      },
    }), { status: 201, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  try {
    const client = new PaymentOrchestrationClient({ baseUrl: 'http://localhost:5100/', merchantId: 'merchant-1' });
    const result = await client.refundPaymentTransaction('tx-1', { amount: 100, idempotencyKey: 'refund-key-1' });

    assert.equal(result.refundTransaction.id, 'refund-1');
    assert.equal(calls[0]!.url, 'http://localhost:5100/v1/payment-transactions/tx-1/refund');
    assert.equal(calls[0]!.init.method, 'POST');
    assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), {
      amount: 100,
      idempotencyKey: 'refund-key-1',
      merchantId: 'merchant-1',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('PaymentOrchestrationClient.voidPaymentTransaction posts correct path/body and passes idempotencyKey', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify({
      ok: true,
      data: {
        transaction: transaction('tx-1', 'cancelled'),
        intent: intent('requires_payment'),
        providerCancelled: true,
        idempotentReplay: false,
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  try {
    const client = new PaymentOrchestrationClient({ baseUrl: 'http://localhost:5100/', merchantId: 'merchant-1' });
    const result = await client.voidPaymentTransaction('tx-1', { idempotencyKey: 'void-key-1' });

    assert.equal(result.transaction.status, 'cancelled');
    assert.equal(calls[0]!.url, 'http://localhost:5100/v1/payment-transactions/tx-1/void');
    assert.equal(calls[0]!.init.method, 'POST');
    assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), {
      idempotencyKey: 'void-key-1',
      merchantId: 'merchant-1',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('PaymentOrchestrationClient refund/void error envelope handling still exposes frozen error code', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({
    ok: false,
    error: { code: 'IDEMPOTENCY_CONFLICT', message: 'same key different context', details: { key: 'k1' } },
  }), { status: 409, headers: { 'content-type': 'application/json' } })) as typeof fetch;

  try {
    const client = new PaymentOrchestrationClient({ baseUrl: 'http://localhost:5100', merchantId: 'merchant-1' });
    await assert.rejects(
      () => client.refundPaymentTransaction('tx-1', { amount: 100, idempotencyKey: 'k1' }),
      (err: unknown) => {
        assert.ok(err instanceof PaymentOrchestrationClientError);
        assert.equal(err.code, 'IDEMPOTENCY_CONFLICT');
        assert.equal(err.status, 409);
        assert.deepEqual(err.details, { key: 'k1' });
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
