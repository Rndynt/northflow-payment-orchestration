import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { XenditSandboxProvider } from '../apps/service/src/infrastructure/providers/XenditSandboxProvider.ts';
import { createProviderRegistry } from '../apps/service/src/infrastructure/providers/providerRegistry.ts';
import type { PaymentProviderAccount } from '@northflow/payment-orchestration-core';

const providerAccount: PaymentProviderAccount = {
  id: 'pa_xendit_1',
  merchantId: 'merchant_1',
  provider: 'xendit_sandbox',
  environment: 'sandbox',
  providerAccountRef: 'xendit-acct-1',
  credentialsRef: 'XENDIT_SANDBOX_SECRET_REF',
  publicConfig: {
    successRedirectUrl: 'https://example.test/success',
    failureRedirectUrl: 'https://example.test/failure',
  },
  status: 'active',
  metadata: {},
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('standalone Xendit sandbox provider', () => {
  test('creates a sandbox invoice with injected HTTP client and does not expose raw credentials', async () => {
    const requests: unknown[] = [];
    const provider = new XenditSandboxProvider({
      nodeEnv: 'test',
      resolveCredential: async (ref) => (ref === 'XENDIT_SANDBOX_SECRET_REF' ? 'xnd_development_secret' : null),
      httpClient: async (request) => {
        requests.push(request);
        assert.equal(request.method, 'POST');
        assert.match(request.url, /\/v2\/invoices$/);
        assert.equal((request.body as Record<string, unknown>).amount, 125000);
        return {
          status: 200,
          body: {
            id: 'inv_123',
            status: 'PENDING',
            invoice_url: 'https://checkout.xendit.test/inv_123',
            secret: 'should-redact',
          },
        };
      },
    });

    const result = await provider.createPayment({
      intentId: 'intent_123',
      amount: 125000,
      currency: 'IDR',
      method: 'invoice',
      providerAccount,
      metadata: { description: 'Sandbox invoice' },
    });

    assert.equal(requests.length, 1);
    assert.equal(result.status, 'requires_action');
    assert.equal(result.providerReference, 'inv_123');
    assert.equal(result.providerPaymentUrl, 'https://checkout.xendit.test/inv_123');
    assert.equal(result.rawProviderResponse.secret, '[redacted]');
  });

  test('provider registry selects fake_gateway and xendit_sandbox in non-production', () => {
    const registry = createProviderRegistry('test');
    assert.ok(registry.get('fake_gateway'));
    assert.ok(registry.get('xendit_sandbox'));
  });
});
