import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { XenditSandboxProvider } from '../apps/service/src/infrastructure/providers/XenditSandboxProvider.ts';

describe('standalone Xendit sandbox webhook parser', () => {
  test('verifies callback token and maps invoice status payload', () => {
    const original = process.env.PAYMENT_ORCHESTRATION_XENDIT_CALLBACK_TOKEN;
    process.env.PAYMENT_ORCHESTRATION_XENDIT_CALLBACK_TOKEN = 'callback-token';
    try {
      const provider = new XenditSandboxProvider({
        nodeEnv: 'test',
        httpClient: async () => ({ status: 200, body: {} }),
      });

      const parsed = provider.parseWebhook({
        headers: { 'x-callback-token': 'callback-token' },
        rawBody: {
          id: 'inv_123',
          event: 'invoice.paid',
          status: 'PAID',
          api_key: 'should-redact',
        },
      });

      assert.equal(parsed.providerEventId, 'inv_123');
      assert.equal(parsed.providerReference, 'inv_123');
      assert.equal(parsed.eventType, 'invoice.paid');
      assert.equal(parsed.status, 'succeeded');
      assert.equal(parsed.rawPayload.api_key, '[redacted]');
    } finally {
      if (original === undefined) delete process.env.PAYMENT_ORCHESTRATION_XENDIT_CALLBACK_TOKEN;
      else process.env.PAYMENT_ORCHESTRATION_XENDIT_CALLBACK_TOKEN = original;
    }
  });

  test('rejects invalid callback token', () => {
    const original = process.env.PAYMENT_ORCHESTRATION_XENDIT_CALLBACK_TOKEN;
    process.env.PAYMENT_ORCHESTRATION_XENDIT_CALLBACK_TOKEN = 'callback-token';
    try {
      const provider = new XenditSandboxProvider({
        nodeEnv: 'test',
        httpClient: async () => ({ status: 200, body: {} }),
      });

      assert.throws(
        () => provider.parseWebhook({ headers: { 'x-callback-token': 'wrong' }, rawBody: { id: 'inv_123' } }),
        /callback token verification failed/,
      );
    } finally {
      if (original === undefined) delete process.env.PAYMENT_ORCHESTRATION_XENDIT_CALLBACK_TOKEN;
      else process.env.PAYMENT_ORCHESTRATION_XENDIT_CALLBACK_TOKEN = original;
    }
  });
});
