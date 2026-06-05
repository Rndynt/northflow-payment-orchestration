import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { RefreshProviderStatus } from '../apps/service/src/application/use-cases/RefreshProviderStatus.ts';
import { StandaloneFakeGatewayProvider } from '../apps/service/src/infrastructure/providers/StandaloneFakeGatewayProvider.ts';
import type {
  PaymentIntentRepository,
  PaymentProviderAccountRepository,
  PaymentTransactionRepository,
  StandalonePaymentIntentDTO,
  StandalonePaymentTransactionDTO,
} from '@northflow/payment-orchestration-core';

describe('provider status refresh foundation', () => {
  test('polls provider through registry and preserves merchant-scoped transaction lookup', async () => {
    let intent: StandalonePaymentIntentDTO = {
      id: 'intent_1',
      merchantId: 'merchant_1',
      providerAccountId: null,
      sourceApp: 'test',
      externalTenantId: null,
      externalOutletId: null,
      externalLocationId: null,
      externalPayableType: 'invoice',
      externalPayableId: 'order_1',
      currency: 'IDR',
      amountDue: 10000,
      amountPaid: 0,
      amountRefunded: 0,
      amountRemaining: 10000,
      status: 'requires_payment',
      allowPartial: false,
      expiresAt: null,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    let tx: StandalonePaymentTransactionDTO = {
      id: 'tx_1',
      merchantId: 'merchant_1',
      intentId: 'intent_1',
      providerAccountId: null,
      provider: 'fake_gateway',
      method: 'qris',
      transactionType: 'payment',
      direction: 'incoming',
      status: 'requires_action',
      amount: 10000,
      currency: 'IDR',
      parentTransactionId: null,
      providerReference: 'fake_ref_1',
      providerEventId: null,
      providerPaymentUrl: null,
      providerQrString: 'FAKE_QR',
      failureReason: null,
      idempotencyKey: null,
      expiresAt: null,
      metadata: {},
      rawProviderResponse: { scenario: 'immediate_success' },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const txRepo: PaymentTransactionRepository = {
      findById: async (id, merchantId) => (id === tx.id && merchantId === tx.merchantId ? tx : null),
      findByIntentId: async () => [tx],
      findByProviderReference: async () => tx,
      create: async () => tx,
      updateStatus: async (input) => {
        tx = { ...tx, status: input.status, failureReason: input.failureReason ?? tx.failureReason };
        return tx;
      },
      sumSucceededRefundsByParent: async () => 0,
      markSucceededIfConfirmable: async (input) => {
        if (input.id !== tx.id || input.merchantId !== tx.merchantId || tx.status !== 'requires_action') {
          return { transaction: null, changed: false };
        }
        tx = { ...tx, status: 'succeeded' };
        return { transaction: tx, changed: true };
      },
      findStalePendingTransactions: async () => [tx],
    };

    const intentRepo: PaymentIntentRepository = {
      findById: async (id, merchantId) => (id === intent.id && merchantId === intent.merchantId ? intent : null),
      findByExternalPayable: async () => null,
      create: async () => intent,
      updateTotals: async (input) => {
        intent = { ...intent, amountPaid: input.amountPaid, amountRefunded: input.amountRefunded, amountRemaining: input.amountRemaining };
        return intent;
      },
      updateStatus: async (input) => {
        intent = { ...intent, status: input.status };
        return intent;
      },
      findExpiredActive: async () => [intent],
    };

    const providerAccountRepo: PaymentProviderAccountRepository = {
      findById: async () => null,
      findByMerchantAndProvider: async () => null,
      create: async () => { throw new Error('not used'); },
      updateStatus: async () => { throw new Error('not used'); },
    };

    const useCase = new RefreshProviderStatus(
      txRepo,
      intentRepo,
      providerAccountRepo,
      new Map([['fake_gateway', new StandaloneFakeGatewayProvider()]]),
    );

    const result = await useCase.execute({ merchantId: 'merchant_1', transactionId: 'tx_1' });

    assert.equal(result.changed, true);
    assert.equal(result.providerStatus, 'succeeded');
    assert.equal(result.transaction.status, 'succeeded');
    assert.equal(result.intent?.amountPaid, 10000);
    assert.equal(result.intent?.status, 'paid');
  });
});
