import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ExpireStalePaymentTransactions } from '../apps/service/src/application/use-cases/ExpireStalePaymentTransactions.ts';
import type { PaymentIntentRepository, PaymentTransactionRepository, StandalonePaymentIntentDTO, StandalonePaymentTransactionDTO } from '@northflow/payment-orchestration-core';

function intent(overrides: Partial<StandalonePaymentIntentDTO> = {}): StandalonePaymentIntentDTO {
  return {
    id: 'intent_1', merchantId: 'merchant_1', providerAccountId: null, sourceApp: 'test', externalTenantId: null,
    externalOutletId: null, externalLocationId: null, externalPayableType: 'invoice', externalPayableId: 'inv_1',
    currency: 'IDR', amountDue: 10000, amountPaid: 0, amountRefunded: 0, amountRemaining: 10000,
    status: 'requires_payment', allowPartial: false, expiresAt: new Date('2026-03-01T00:00:00Z'), metadata: {},
    createdAt: new Date(), updatedAt: new Date(), ...overrides,
  };
}

function transaction(overrides: Partial<StandalonePaymentTransactionDTO> = {}): StandalonePaymentTransactionDTO {
  return {
    id: 'tx_1', merchantId: 'merchant_1', intentId: 'intent_1', providerAccountId: null, provider: 'fake_gateway',
    method: 'qris', transactionType: 'payment', status: 'requires_action', direction: 'incoming', amount: 10000,
    currency: 'IDR', parentTransactionId: null, providerReference: null, providerEventId: null, providerPaymentUrl: null,
    providerQrString: null, failureReason: null, idempotencyKey: null, expiresAt: new Date('2026-01-01T00:00:00Z'), metadata: {}, rawProviderResponse: null,
    createdAt: new Date(), updatedAt: new Date(), ...overrides,
  };
}

describe('expire stale payment transactions use case', () => {
  test('expires transaction by transaction expiresAt even when intent is not expired', async () => {
    let storedIntent = intent();
    let tx = transaction();
    const intentRepo: PaymentIntentRepository = {
      findById: async () => storedIntent,
      findByExternalPayable: async () => null,
      create: async () => storedIntent,
      updateTotals: async () => storedIntent,
      updateStatus: async (input) => (storedIntent = { ...storedIntent, status: input.status }),
      findExpiredActive: async () => [],
    };
    const transactionRepo: PaymentTransactionRepository = {
      findById: async () => tx,
      findByIntentId: async () => [tx],
      findByProviderReference: async () => tx,
      create: async () => tx,
      updateStatus: async (input) => (tx = { ...tx, status: input.status, failureReason: input.failureReason ?? null }),
      sumSucceededRefundsByParent: async () => 0,
      markSucceededIfConfirmable: async () => ({ changed: false, transaction: null }),
      findStalePendingTransactions: async () => [tx],
    };

    const result = await new ExpireStalePaymentTransactions(intentRepo, transactionRepo).execute({ now: new Date('2026-02-01T00:00:00Z') });

    assert.equal(result.expiredIntents, 1);
    assert.equal(result.expiredTransactions, 1);
    assert.equal(storedIntent.status, 'expired');
    assert.equal(tx.status, 'expired');
  });

  test('expires intent by intent expiresAt fallback and skips terminal transactions idempotently', async () => {
    let storedIntent = intent({ expiresAt: new Date('2026-01-01T00:00:00Z') });
    let terminalTx = transaction({ id: 'tx_terminal', status: 'succeeded', expiresAt: new Date('2026-01-01T00:00:00Z') });
    const intentRepo: PaymentIntentRepository = {
      findById: async () => storedIntent,
      findByExternalPayable: async () => null,
      create: async () => storedIntent,
      updateTotals: async () => storedIntent,
      updateStatus: async (input) => (storedIntent = { ...storedIntent, status: input.status }),
      findExpiredActive: async () => [storedIntent],
    };
    const transactionRepo: PaymentTransactionRepository = {
      findById: async () => terminalTx,
      findByIntentId: async () => [terminalTx],
      findByProviderReference: async () => terminalTx,
      create: async () => terminalTx,
      updateStatus: async (input) => (terminalTx = { ...terminalTx, status: input.status, failureReason: input.failureReason ?? null }),
      sumSucceededRefundsByParent: async () => 0,
      markSucceededIfConfirmable: async () => ({ changed: false, transaction: null }),
      findStalePendingTransactions: async () => [],
    };

    const result = await new ExpireStalePaymentTransactions(intentRepo, transactionRepo).execute({ now: new Date('2026-02-01T00:00:00Z') });
    assert.equal(result.expiredIntents, 1);
    assert.equal(result.expiredTransactions, 0);
    assert.equal(result.skippedTransactions, 1);
    assert.equal(terminalTx.status, 'succeeded');
    assert.equal(storedIntent.status, 'expired');
  });
});
