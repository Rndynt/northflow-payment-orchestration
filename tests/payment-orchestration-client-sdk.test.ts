import test from 'node:test';
import assert from 'node:assert/strict';
import { PaymentOrchestrationClient } from '../packages/client-sdk/src/client.ts';

test('PaymentOrchestrationClient.reconcilePaymentIntentTotals posts to reconcile route and injects merchantId', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(
      JSON.stringify({
        ok: true,
        data: {
          intent: {
            id: 'intent-1',
            merchantId: 'merchant-1',
            externalPayableType: 'order',
            externalPayableId: 'order-1',
            currency: 'IDR',
            amountDue: 1000,
            amountPaid: 1000,
            amountRefunded: 0,
            amountRemaining: 0,
            status: 'paid',
            allowPartial: true,
            expiresAt: null,
            createdAt: '2026-06-05T00:00:00.000Z',
            updatedAt: '2026-06-05T00:00:00.000Z',
          },
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
      serviceToken: 'service-token',
      merchantId: 'merchant-1',
      sourceApp: 'aurapos',
    });

    const result = await client.reconcilePaymentIntentTotals('intent-1');

    assert.equal(result.changed, true);
    assert.equal(result.intent.status, 'paid');
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.url, 'http://localhost:5100/v1/payment-intents/intent-1/reconcile');
    assert.equal(calls[0]!.init.method, 'POST');
    assert.equal((calls[0]!.init.headers as Record<string, string>)['x-payment-orchestration-service-token'], 'service-token');
    assert.equal((calls[0]!.init.headers as Record<string, string>)['x-payment-merchant-id'], 'merchant-1');
    assert.equal(calls[0]!.init.body, JSON.stringify({ merchantId: 'merchant-1' }));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
