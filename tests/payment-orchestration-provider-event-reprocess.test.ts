import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ReprocessProviderEvents } from '../apps/service/src/application/use-cases/ReprocessProviderEvents.ts';
import type { PaymentProviderEventDTO, PaymentProviderEventRepository, PaymentIntentRepository, PaymentTransactionRepository, PaymentIntentDTO, PaymentTransactionDTO } from '@northflow/payment-orchestration-core';

function event(overrides: Partial<PaymentProviderEventDTO> = {}): PaymentProviderEventDTO {
  return {
    id: 'pev_1', merchantId: null, provider: 'xendit_sandbox', providerEventId: 'evt_1', providerReference: 'inv_1',
    eventType: 'invoice.status', processingStatus: 'pending', processingAttempts: 0, lastError: null,
    rawHeaders: {}, rawBody: null, parsedPayload: null, receivedAt: new Date(), processedAt: null,
    createdAt: new Date(Date.now() - 10 * 60 * 1000), updatedAt: new Date(), ...overrides,
  };
}

function intent(overrides: Partial<PaymentIntentDTO> = {}): PaymentIntentDTO {
  return {
    id: 'intent_1', merchantId: 'merchant_1', providerAccountId: null, sourceApp: 'test', externalTenantId: null,
    externalOutletId: null, externalLocationId: null, externalPayableType: 'invoice', externalPayableId: 'inv_1',
    currency: 'IDR', amountDue: 10000, amountPaid: 0, amountRefunded: 0, amountRemaining: 10000,
    status: 'requires_payment', allowPartial: false, expiresAt: null, metadata: {},
    createdAt: new Date(), updatedAt: new Date(), ...overrides,
  };
}

function transaction(overrides: Partial<PaymentTransactionDTO> = {}): PaymentTransactionDTO {
  return {
    id: 'tx_1', merchantId: 'merchant_1', intentId: 'intent_1', providerAccountId: null, provider: 'xendit_sandbox',
    method: 'qris', transactionType: 'payment', status: 'requires_action', direction: 'incoming', amount: 10000,
    currency: 'IDR', parentTransactionId: null, providerReference: 'inv_1', providerEventId: null, providerPaymentUrl: null,
    providerQrString: null, failureReason: null, idempotencyKey: null, expiresAt: null, metadata: {}, rawProviderResponse: null,
    createdAt: new Date(), updatedAt: new Date(), ...overrides,
  };
}

function eventRepo(events: PaymentProviderEventDTO[]): PaymentProviderEventRepository & { processed: string[]; failed: string[] } {
  return {
    processed: [],
    failed: [],
    reserveEvent: async () => events[0],
    findByProviderEventId: async () => null,
    assignMerchant: async () => {},
    markProcessed: async function (id: string) { this.processed.push(id); },
    markFailed: async function (id: string) { this.failed.push(id); },
    findStalePending: async () => events,
  } as PaymentProviderEventRepository & { processed: string[]; failed: string[] };
}

describe('provider event reprocess foundation', () => {
  test('safely skips stored events without replayable parsed payload', async () => {
    const repo = eventRepo([event()]);
    const result = await new ReprocessProviderEvents(repo).execute({ olderThanMinutes: 5, limit: 10 });
    assert.equal(result.processed, 0);
    assert.equal(result.skipped, 1);
    assert.match(result.details[0].reason ?? '', /no parsed payload/);
  });

  test('reprocesses pending xendit_sandbox event with stored parsed payload without double-credit', async () => {
    const repo = eventRepo([event({ parsedPayload: { providerReference: 'inv_1', status: 'succeeded', eventType: 'invoice.paid' } })]);
    let storedIntent = intent();
    let storedTx = transaction();
    const intentRepo: PaymentIntentRepository = {
      findById: async () => storedIntent,
      findByExternalPayable: async () => null,
      create: async () => storedIntent,
      updateTotals: async (input) => (storedIntent = { ...storedIntent, amountPaid: input.amountPaid, amountRefunded: input.amountRefunded, amountRemaining: input.amountRemaining }),
      updateStatus: async (input) => (storedIntent = { ...storedIntent, status: input.status }),
      findExpiredActive: async () => [],
    };
    const transactionRepo: PaymentTransactionRepository = {
      findById: async () => storedTx,
      findByIntentId: async () => [storedTx],
      findByProviderReference: async () => storedTx,
      create: async () => storedTx,
      updateStatus: async (input) => (storedTx = { ...storedTx, status: input.status }),
      sumSucceededRefundsByParent: async () => 0,
      markSucceededIfConfirmable: async () => {
        if (storedTx.status === 'succeeded') return { changed: false, transaction: null };
        storedTx = { ...storedTx, status: 'succeeded' };
        return { changed: true, transaction: storedTx };
      },
      findStalePendingTransactions: async () => [],
    };

    const result = await new ReprocessProviderEvents(repo, transactionRepo, intentRepo).execute();
    assert.equal(result.processed, 1);
    assert.equal(storedTx.status, 'succeeded');
    assert.equal(storedIntent.amountPaid, 10000);
    assert.equal(storedIntent.status, 'paid');

    const duplicate = await new ReprocessProviderEvents(eventRepo([event({ id: 'pev_2', parsedPayload: { providerReference: 'inv_1', status: 'succeeded' } })]), transactionRepo, intentRepo).execute();
    assert.equal(duplicate.processed, 1);
    assert.equal(storedIntent.amountPaid, 10000);
  });

  test('skips already processed and missing dependency events', async () => {
    const result = await new ReprocessProviderEvents(eventRepo([
      event({ id: 'processed', processingStatus: 'processed', parsedPayload: { providerReference: 'inv_1', status: 'succeeded' } }),
      event({ id: 'unwired', parsedPayload: { providerReference: 'inv_1', status: 'succeeded' } }),
    ])).execute();
    assert.equal(result.processed, 0);
    assert.equal(result.skipped, 2);
  });
});
