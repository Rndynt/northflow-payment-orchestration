/**
 * payment-orchestration-refund-void-parity.test.ts
 *
 * Phase 8F — Refund, Void, and Manual Provider Parity Tests
 *
 * Validates that the standalone northflow payment-orchestration-service has feature
 * parity with the legacy Consumer A RefundPaymentTransaction and VoidPaymentTransaction
 * use cases, and that StandaloneManualProvider behaves correctly.
 *
 * Strategy: in-memory repos + real use-case classes (no HTTP server, no DB).
 *
 * Run:
 *   npx tsx --tsconfig tests/tsconfig.json --test \
 *     tests/payment-orchestration-refund-void-parity.test.ts
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import type {
  PaymentIntentRepository,
  PaymentTransactionRepository,
  PaymentProviderAccountRepository,
  CreatePaymentTransactionInput,
  UpdateTransactionStatusInput,
  MarkSucceededIfConfirmableInput,
  MarkSucceededIfConfirmableResult,
  UpdateIntentTotalsInput,
  UpdateIntentStatusInput,
  StandalonePaymentIntentDTO,
  StandalonePaymentTransactionDTO,
  PaymentProviderAccount,
} from '@northflow/payment-orchestration-core';

import { RefundPaymentTransaction } from '../apps/service/src/application/use-cases/RefundPaymentTransaction.ts';
import { VoidPaymentTransaction } from '../apps/service/src/application/use-cases/VoidPaymentTransaction.ts';
import { StandaloneManualProvider } from '../apps/service/src/infrastructure/providers/StandaloneManualProvider.ts';
import { StandaloneFakeGatewayProvider } from '../apps/service/src/infrastructure/providers/StandaloneFakeGatewayProvider.ts';
import type { ProviderRegistry } from '../apps/service/src/infrastructure/providers/providerRegistry.ts';

// ── In-memory repo helpers ────────────────────────────────────────────────────

class InMemoryTransactionRepo implements PaymentTransactionRepository {
  readonly store = new Map<string, StandalonePaymentTransactionDTO>();

  async findById(id: string, merchantId: string): Promise<StandalonePaymentTransactionDTO | null> {
    const tx = this.store.get(id);
    if (!tx || tx.merchantId !== merchantId) return null;
    return tx;
  }

  async findByIntentId(intentId: string, merchantId: string): Promise<StandalonePaymentTransactionDTO[]> {
    return [...this.store.values()].filter(
      (tx) => tx.intentId === intentId && tx.merchantId === merchantId,
    );
  }

  async findByProviderReference(_provider: string, _ref: string): Promise<StandalonePaymentTransactionDTO | null> {
    return null;
  }

  async findByMerchantIdempotencyKey(merchantId: string, idempotencyKey: string): Promise<StandalonePaymentTransactionDTO | null> {
    return [...this.store.values()].find(
      (tx) => tx.merchantId === merchantId && tx.idempotencyKey === idempotencyKey,
    ) ?? null;
  }

  async create(input: CreatePaymentTransactionInput): Promise<StandalonePaymentTransactionDTO> {
    const now = new Date();
    const tx: StandalonePaymentTransactionDTO = {
      id: input.id,
      merchantId: input.merchantId,
      intentId: input.intentId,
      providerAccountId: input.providerAccountId ?? null,
      provider: input.provider,
      method: input.method,
      transactionType: input.transactionType,
      status: input.status,
      direction: input.direction,
      amount: input.amount,
      currency: input.currency ?? 'IDR',
      parentTransactionId: input.parentTransactionId ?? null,
      providerReference: input.providerReference ?? null,
      providerEventId: input.providerEventId ?? null,
      providerPaymentUrl: input.providerPaymentUrl ?? null,
      providerQrString: input.providerQrString ?? null,
      failureReason: input.failureReason ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      expiresAt: input.expiresAt ?? null,
      metadata: input.metadata ?? null,
      rawProviderResponse: input.rawProviderResponse ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.store.set(tx.id, tx);
    return tx;
  }

  async updateStatus(input: UpdateTransactionStatusInput): Promise<StandalonePaymentTransactionDTO> {
    const tx = this.store.get(input.id);
    if (!tx || tx.merchantId !== input.merchantId) throw new Error(`Transaction not found: ${input.id}`);
    const updated = {
      ...tx,
      status: input.status,
      failureReason: input.failureReason ?? null,
      providerReference: input.providerReference !== undefined ? input.providerReference : tx.providerReference,
      idempotencyKey: input.idempotencyKey !== undefined ? input.idempotencyKey : tx.idempotencyKey,
      metadata: input.metadata !== undefined ? input.metadata : tx.metadata,
      rawProviderResponse: input.rawProviderResponse !== undefined ? input.rawProviderResponse : tx.rawProviderResponse,
      updatedAt: new Date(),
    };
    this.store.set(input.id, updated);
    return updated;
  }

  async sumSucceededRefundsByParent(parentTransactionId: string): Promise<number> {
    let total = 0;
    for (const tx of this.store.values()) {
      if (
        tx.parentTransactionId === parentTransactionId &&
        tx.transactionType === 'refund' &&
        tx.direction === 'outgoing' &&
        tx.status === 'succeeded'
      ) {
        total += tx.amount;
      }
    }
    return total;
  }

  async markSucceededIfConfirmable(input: MarkSucceededIfConfirmableInput): Promise<MarkSucceededIfConfirmableResult> {
    const tx = this.store.get(input.id);
    if (!tx || tx.merchantId !== input.merchantId) return { transaction: null, changed: false };
    if (tx.status !== 'requires_action' && tx.status !== 'pending') return { transaction: null, changed: false };
    const updated = { ...tx, status: 'succeeded' as const, updatedAt: new Date() };
    this.store.set(input.id, updated);
    return { transaction: updated, changed: true };
  }
}

class InMemoryIntentRepo implements PaymentIntentRepository {
  readonly store = new Map<string, StandalonePaymentIntentDTO>();

  async findById(id: string, merchantId: string): Promise<StandalonePaymentIntentDTO | null> {
    const intent = this.store.get(id);
    if (!intent || intent.merchantId !== merchantId) return null;
    return intent;
  }

  async findByExternalPayable(): Promise<StandalonePaymentIntentDTO | null> { return null; }

  async create(input: any): Promise<StandalonePaymentIntentDTO> {
    const now = new Date();
    const intent: StandalonePaymentIntentDTO = {
      id: input.id,
      merchantId: input.merchantId,
      providerAccountId: null,
      sourceApp: null,
      externalTenantId: null,
      externalOutletId: null,
      externalLocationId: null,
      externalPayableType: input.externalPayableType,
      externalPayableId: input.externalPayableId,
      currency: input.currency ?? 'IDR',
      amountDue: input.amountDue,
      amountPaid: 0,
      amountRefunded: 0,
      amountRemaining: input.amountDue,
      status: 'requires_payment',
      allowPartial: input.allowPartial ?? false,
      expiresAt: null,
      metadata: {},
      idempotencyKey: null,
      createdAt: now,
      updatedAt: now,
    };
    this.store.set(intent.id, intent);
    return intent;
  }

  async updateTotals(input: UpdateIntentTotalsInput): Promise<StandalonePaymentIntentDTO> {
    const intent = this.store.get(input.id);
    if (!intent || intent.merchantId !== input.merchantId) throw new Error(`Intent not found: ${input.id}`);
    const updated = {
      ...intent,
      amountPaid: input.amountPaid,
      amountRefunded: input.amountRefunded,
      amountRemaining: input.amountRemaining,
      updatedAt: new Date(),
    };
    this.store.set(input.id, updated);
    return updated;
  }

  async updateStatus(input: UpdateIntentStatusInput): Promise<StandalonePaymentIntentDTO> {
    const intent = this.store.get(input.id);
    if (!intent || intent.merchantId !== input.merchantId) throw new Error(`Intent not found: ${input.id}`);
    const updated = { ...intent, status: input.status, updatedAt: new Date() };
    this.store.set(input.id, updated);
    return updated;
  }
}

class InMemoryProviderAccountRepo implements PaymentProviderAccountRepository {
  async findById(_id: string, _merchantId: string): Promise<PaymentProviderAccount | null> { return null; }
  async findByMerchantAndProvider(): Promise<PaymentProviderAccount | null> { return null; }
  async create(input: any): Promise<PaymentProviderAccount> { return input; }
  async updateStatus(id: string, merchantId: string, status: any): Promise<PaymentProviderAccount> {
    throw new Error('not implemented');
  }
}

// ── Test fixture helpers ──────────────────────────────────────────────────────

function buildSucceededTransaction(
  merchantId: string,
  intentId: string,
  overrides: Partial<StandalonePaymentTransactionDTO> = {},
): StandalonePaymentTransactionDTO {
  const now = new Date();
  return {
    id: randomUUID(),
    merchantId,
    intentId,
    providerAccountId: null,
    provider: 'fake_gateway',
    method: 'qris',
    transactionType: 'payment',
    status: 'succeeded',
    direction: 'incoming',
    amount: 100000,
    currency: 'IDR',
    parentTransactionId: null,
    providerReference: `fake_ref_${randomUUID().slice(0, 8)}`,
    providerEventId: null,
    providerPaymentUrl: null,
    providerQrString: null,
    failureReason: null,
    idempotencyKey: null,
    expiresAt: null,
    metadata: null,
    rawProviderResponse: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function buildPendingTransaction(
  merchantId: string,
  intentId: string,
  overrides: Partial<StandalonePaymentTransactionDTO> = {},
): StandalonePaymentTransactionDTO {
  return buildSucceededTransaction(merchantId, intentId, {
    status: 'requires_action',
    ...overrides,
  });
}

function makeRegistry(providers: Record<string, any> = {}): ProviderRegistry {
  const registry = new Map<string, any>();
  for (const [code, provider] of Object.entries(providers)) {
    registry.set(code, provider);
  }
  return registry;
}

// ── Tests: StandaloneManualProvider ──────────────────────────────────────────

describe('StandaloneManualProvider', () => {
  const manual = new StandaloneManualProvider();

  test('providerCode is "manual"', () => {
    assert.equal(manual.providerCode, 'manual');
  });

  test('capabilities: supportsRefund=true, supportsCancel=true', () => {
    assert.equal(manual.capabilities.supportsRefund, true);
    assert.equal(manual.capabilities.supportsCancel, true);
    assert.equal(manual.capabilities.supportsPolling, false);
    assert.equal(manual.capabilities.supportsWebhook, false);
    assert.equal(manual.capabilities.supportsPartialRefund, true);
  });

  test('createPayment returns succeeded immediately', async () => {
    const result = await manual.createPayment({
      intentId: 'intent-1',
      amount: 50000,
      currency: 'IDR',
      method: 'cash',
      providerAccount: null,
    });
    assert.equal(result.status, 'succeeded');
    assert.ok(result.providerReference.startsWith('manual_'));
    assert.equal(result.providerPaymentUrl, null);
    assert.equal(result.failureReason, null);
  });

  test('cancelPayment returns cancelled immediately', async () => {
    const result = await manual.cancelPayment({
      transactionId: 'tx-1',
      providerReference: 'manual_ref_abc',
      providerAccount: null,
      reason: 'Customer request',
    });
    assert.equal(result.status, 'cancelled');
    assert.equal(result.failureReason, null);
    assert.equal(result.rawProviderResponse['reason'], 'Customer request');
  });

  test('refundPayment returns succeeded immediately', async () => {
    const result = await manual.refundPayment({
      transactionId: 'tx-1',
      providerReference: 'manual_ref_abc',
      providerAccount: null,
      amount: 30000,
      currency: 'IDR',
      reason: 'Item return',
    });
    assert.equal(result.status, 'succeeded');
    assert.equal(result.failureReason, null);
    assert.ok(typeof result.providerReference === 'string');
    assert.equal(result.rawProviderResponse['amount'], 30000);
  });

});

// ── Tests: StandaloneFakeGatewayProvider — cancel/refund ─────────────────────

describe('StandaloneFakeGatewayProvider — Phase 8F cancel/refund', () => {
  const fake = new StandaloneFakeGatewayProvider();

  test('capabilities: supportsRefund=true, supportsCancel=true', () => {
    assert.equal(fake.capabilities.supportsRefund, true);
    assert.equal(fake.capabilities.supportsCancel, true);
    assert.equal(fake.capabilities.supportsPartialRefund, true);
  });

  test('cancelPayment returns cancelled', async () => {
    const result = await fake.cancelPayment({
      transactionId: 'tx-fake-1',
      providerReference: 'fake_ref_001',
      providerAccount: null,
    });
    assert.equal(result.status, 'cancelled');
    assert.equal(result.failureReason, null);
    assert.ok(typeof result.providerReference === 'string');
    assert.equal(result.rawProviderResponse['provider'], 'fake_gateway');
  });

  test('refundPayment returns succeeded', async () => {
    const result = await fake.refundPayment({
      transactionId: 'tx-fake-1',
      providerReference: 'fake_ref_001',
      providerAccount: null,
      amount: 50000,
      currency: 'IDR',
    });
    assert.equal(result.status, 'succeeded');
    assert.equal(result.failureReason, null);
    assert.equal(result.rawProviderResponse['amount'], 50000);
  });
});

// ── Tests: RefundPaymentTransaction ──────────────────────────────────────────

describe('RefundPaymentTransaction', () => {
  const merchantId = 'merchant-ref-test';
  const fake = new StandaloneFakeGatewayProvider();

  function setup(providerOverrides: Record<string, any> = { fake_gateway: fake }) {
    const txRepo = new InMemoryTransactionRepo();
    const intentRepo = new InMemoryIntentRepo();
    const paRepo = new InMemoryProviderAccountRepo();
    const registry = makeRegistry(providerOverrides);
    const useCase = new RefundPaymentTransaction(txRepo, intentRepo, paRepo, registry);
    return { txRepo, intentRepo, useCase };
  }

  test('refunds a succeeded payment fully via provider', async () => {
    const { txRepo, intentRepo, useCase } = setup();

    const intentId = randomUUID();
    const intent = await intentRepo.create({
      id: intentId,
      merchantId,
      externalPayableType: 'order',
      externalPayableId: 'order-1',
      amountDue: 100000,
    });
    // Manually set amountPaid so the intent reflects a paid state
    await intentRepo.updateTotals({
      id: intentId, merchantId,
      amountPaid: 100000, amountRefunded: 0, amountRemaining: 0,
    });

    const sourceTx = buildSucceededTransaction(merchantId, intentId);
    txRepo.store.set(sourceTx.id, sourceTx);

    const result = await useCase.execute({
      merchantId,
      transactionId: sourceTx.id,
      amount: 100000,
    });

    assert.equal(result.refundTransaction.status, 'succeeded');
    assert.equal(result.refundTransaction.direction, 'outgoing');
    assert.equal(result.refundTransaction.transactionType, 'refund');
    assert.equal(result.refundTransaction.amount, 100000);
    assert.equal(result.refundTransaction.parentTransactionId, sourceTx.id);
    assert.equal(result.providerRefunded, true);
    assert.equal(result.intent.amountRefunded, 100000);
  });

  test('refunds a succeeded payment partially', async () => {
    const { txRepo, intentRepo, useCase } = setup();

    const intentId = randomUUID();
    await intentRepo.create({
      id: intentId, merchantId,
      externalPayableType: 'order', externalPayableId: 'order-2', amountDue: 100000,
    });
    await intentRepo.updateTotals({
      id: intentId, merchantId,
      amountPaid: 100000, amountRefunded: 0, amountRemaining: 0,
    });

    const sourceTx = buildSucceededTransaction(merchantId, intentId, { amount: 100000 });
    txRepo.store.set(sourceTx.id, sourceTx);

    const result = await useCase.execute({
      merchantId,
      transactionId: sourceTx.id,
      amount: 30000,
      reason: 'Partial item return',
    });

    assert.equal(result.refundTransaction.amount, 30000);
    assert.equal(result.refundTransaction.status, 'succeeded');
    assert.equal(result.intent.amountRefunded, 30000);
  });

  test('refund with manual provider succeeds without API call', async () => {
    const manual = new StandaloneManualProvider();
    const { txRepo, intentRepo, useCase } = setup({ manual });

    const intentId = randomUUID();
    await intentRepo.create({
      id: intentId, merchantId,
      externalPayableType: 'order', externalPayableId: 'order-3', amountDue: 50000,
    });
    await intentRepo.updateTotals({
      id: intentId, merchantId,
      amountPaid: 50000, amountRefunded: 0, amountRemaining: 0,
    });

    const sourceTx = buildSucceededTransaction(merchantId, intentId, {
      provider: 'manual', method: 'cash', amount: 50000,
    });
    txRepo.store.set(sourceTx.id, sourceTx);

    const result = await useCase.execute({
      merchantId,
      transactionId: sourceTx.id,
      amount: 50000,
    });

    // manual provider implements refundPayment, so providerRefunded = true
    assert.equal(result.refundTransaction.status, 'succeeded');
    assert.equal(result.intent.amountRefunded, 50000);
  });

  test('refund without any registered non-manual provider is unsupported', async () => {
    const { txRepo, intentRepo, useCase } = setup({});  // empty registry

    const intentId = randomUUID();
    await intentRepo.create({
      id: intentId, merchantId,
      externalPayableType: 'order', externalPayableId: 'order-4', amountDue: 80000,
    });
    await intentRepo.updateTotals({
      id: intentId, merchantId,
      amountPaid: 80000, amountRefunded: 0, amountRemaining: 0,
    });

    const sourceTx = buildSucceededTransaction(merchantId, intentId, { amount: 80000 });
    txRepo.store.set(sourceTx.id, sourceTx);

    await assert.rejects(
      () => useCase.execute({ merchantId, transactionId: sourceTx.id, amount: 80000 }),
      (err: any) => {
        assert.equal(err.code, 'PROVIDER_REFUND_UNSUPPORTED');
        return true;
      },
    );
  });

  test('rejects refund exceeding refundable amount', async () => {
    const { txRepo, intentRepo, useCase } = setup();

    const intentId = randomUUID();
    await intentRepo.create({
      id: intentId, merchantId,
      externalPayableType: 'order', externalPayableId: 'order-5', amountDue: 100000,
    });
    await intentRepo.updateTotals({
      id: intentId, merchantId,
      amountPaid: 100000, amountRefunded: 0, amountRemaining: 0,
    });

    const sourceTx = buildSucceededTransaction(merchantId, intentId, { amount: 100000 });
    txRepo.store.set(sourceTx.id, sourceTx);

    await assert.rejects(
      () => useCase.execute({ merchantId, transactionId: sourceTx.id, amount: 150000 }),
      (err: any) => {
        assert.equal(err.code, 'REFUND_EXCEEDS_REFUNDABLE');
        return true;
      },
    );
  });

  test('rejects refund of non-succeeded transaction', async () => {
    const { txRepo, intentRepo, useCase } = setup();

    const intentId = randomUUID();
    await intentRepo.create({
      id: intentId, merchantId,
      externalPayableType: 'order', externalPayableId: 'order-6', amountDue: 100000,
    });

    const pendingTx = buildPendingTransaction(merchantId, intentId);
    txRepo.store.set(pendingTx.id, pendingTx);

    await assert.rejects(
      () => useCase.execute({ merchantId, transactionId: pendingTx.id, amount: 50000 }),
      (err: any) => {
        assert.equal(err.code, 'TRANSACTION_NOT_REFUNDABLE');
        return true;
      },
    );
  });

  test('rejects refund of outgoing transaction', async () => {
    const { txRepo, intentRepo, useCase } = setup();

    const intentId = randomUUID();
    await intentRepo.create({
      id: intentId, merchantId,
      externalPayableType: 'order', externalPayableId: 'order-7', amountDue: 100000,
    });

    const outgoingTx = buildSucceededTransaction(merchantId, intentId, {
      direction: 'outgoing',
      transactionType: 'refund',
    });
    txRepo.store.set(outgoingTx.id, outgoingTx);

    await assert.rejects(
      () => useCase.execute({ merchantId, transactionId: outgoingTx.id, amount: 50000 }),
      (err: any) => {
        assert.equal(err.code, 'TRANSACTION_NOT_REFUNDABLE');
        return true;
      },
    );
  });

  test('rejects refund with invalid amount (zero)', async () => {
    const { txRepo, intentRepo, useCase } = setup();

    const intentId = randomUUID();
    await intentRepo.create({
      id: intentId, merchantId,
      externalPayableType: 'order', externalPayableId: 'order-8', amountDue: 100000,
    });

    const sourceTx = buildSucceededTransaction(merchantId, intentId);
    txRepo.store.set(sourceTx.id, sourceTx);

    await assert.rejects(
      () => useCase.execute({ merchantId, transactionId: sourceTx.id, amount: 0 }),
      (err: any) => {
        assert.equal(err.code, 'VALIDATION_ERROR');
        return true;
      },
    );
  });

  test('rejects refund of non-existent transaction', async () => {
    const { useCase } = setup();

    await assert.rejects(
      () => useCase.execute({ merchantId, transactionId: 'nonexistent-tx', amount: 1000 }),
      (err: any) => {
        assert.equal(err.code, 'TRANSACTION_NOT_FOUND');
        return true;
      },
    );
  });

  test('handles multiple partial refunds up to original amount', async () => {
    const { txRepo, intentRepo, useCase } = setup();

    const intentId = randomUUID();
    await intentRepo.create({
      id: intentId, merchantId,
      externalPayableType: 'order', externalPayableId: 'order-9', amountDue: 100000,
    });
    await intentRepo.updateTotals({
      id: intentId, merchantId,
      amountPaid: 100000, amountRefunded: 0, amountRemaining: 0,
    });

    const sourceTx = buildSucceededTransaction(merchantId, intentId, { amount: 100000 });
    txRepo.store.set(sourceTx.id, sourceTx);

    // First partial refund: 40000
    const r1 = await useCase.execute({ merchantId, transactionId: sourceTx.id, amount: 40000 });
    assert.equal(r1.refundTransaction.status, 'succeeded');
    assert.equal(r1.intent.amountRefunded, 40000);

    // Second partial refund: 60000 (remainder)
    const r2 = await useCase.execute({ merchantId, transactionId: sourceTx.id, amount: 60000 });
    assert.equal(r2.refundTransaction.status, 'succeeded');
    assert.equal(r2.intent.amountRefunded, 100000);

    // Third refund: should fail (nothing left)
    await assert.rejects(
      () => useCase.execute({ merchantId, transactionId: sourceTx.id, amount: 1 }),
      (err: any) => {
        assert.equal(err.code, 'REFUND_EXCEEDS_REFUNDABLE');
        return true;
      },
    );
  });

  test('rejects non-positive refund amount', async () => {
    const { useCase } = setup();
    await assert.rejects(
      () => useCase.execute({ merchantId, transactionId: 'tx-any', amount: 0 }),
      (err: any) => {
        assert.equal(err.code, 'VALIDATION_ERROR');
        return true;
      },
    );
  });

  test('refund idempotent replay returns same refund transaction without duplicate', async () => {
    const { txRepo, intentRepo, useCase } = setup();
    const intentId = randomUUID();
    await intentRepo.create({ id: intentId, merchantId, externalPayableType: 'order', externalPayableId: 'order-idem', amountDue: 100000 });
    await intentRepo.updateTotals({ id: intentId, merchantId, amountPaid: 100000, amountRefunded: 0, amountRemaining: 0 });
    const sourceTx = buildSucceededTransaction(merchantId, intentId, { amount: 100000 });
    txRepo.store.set(sourceTx.id, sourceTx);

    const first = await useCase.execute({ merchantId, transactionId: sourceTx.id, amount: 25000, idempotencyKey: 'refund-key-1' });
    const second = await useCase.execute({ merchantId, transactionId: sourceTx.id, amount: 25000, idempotencyKey: 'refund-key-1' });

    assert.equal(first.idempotentReplay, false);
    assert.equal(second.idempotentReplay, true);
    assert.equal(second.refundTransaction.id, first.refundTransaction.id);
    assert.equal([...txRepo.store.values()].filter((tx) => tx.transactionType === 'refund').length, 1);
  });

  test('refund idempotency conflict rejects same key for different source transaction', async () => {
    const { txRepo, intentRepo, useCase } = setup();
    const intentId = randomUUID();
    await intentRepo.create({ id: intentId, merchantId, externalPayableType: 'order', externalPayableId: 'order-conflict', amountDue: 200000 });
    await intentRepo.updateTotals({ id: intentId, merchantId, amountPaid: 200000, amountRefunded: 0, amountRemaining: 0 });
    const firstTx = buildSucceededTransaction(merchantId, intentId, { amount: 100000 });
    const secondTx = buildSucceededTransaction(merchantId, intentId, { amount: 100000 });
    txRepo.store.set(firstTx.id, firstTx);
    txRepo.store.set(secondTx.id, secondTx);

    await useCase.execute({ merchantId, transactionId: firstTx.id, amount: 10000, idempotencyKey: 'refund-key-conflict' });
    await assert.rejects(
      () => useCase.execute({ merchantId, transactionId: secondTx.id, amount: 10000, idempotencyKey: 'refund-key-conflict' }),
      (err: any) => {
        assert.equal(err.code, 'IDEMPOTENCY_CONFLICT');
        return true;
      },
    );
  });

  test('non-manual provider without refundPayment returns unsupported', async () => {
    const providerWithoutRefund = {
      providerCode: 'gateway_without_refund',
      capabilities: { supportsRefund: false },
      createPayment: async () => { throw new Error('not used'); },
    };
    const { txRepo, intentRepo, useCase } = setup({ gateway_without_refund: providerWithoutRefund });
    const intentId = randomUUID();
    await intentRepo.create({ id: intentId, merchantId, externalPayableType: 'order', externalPayableId: 'order-no-refund', amountDue: 100000 });
    await intentRepo.updateTotals({ id: intentId, merchantId, amountPaid: 100000, amountRefunded: 0, amountRemaining: 0 });
    const sourceTx = buildSucceededTransaction(merchantId, intentId, { provider: 'gateway_without_refund', amount: 100000 });
    txRepo.store.set(sourceTx.id, sourceTx);

    await assert.rejects(
      () => useCase.execute({ merchantId, transactionId: sourceTx.id, amount: 5000 }),
      (err: any) => {
        assert.equal(err.code, 'PROVIDER_REFUND_UNSUPPORTED');
        return true;
      },
    );
  });

});

// ── Tests: VoidPaymentTransaction ─────────────────────────────────────────────

describe('VoidPaymentTransaction', () => {
  const merchantId = 'merchant-void-test';
  const fake = new StandaloneFakeGatewayProvider();

  function setup(providerOverrides: Record<string, any> = { fake_gateway: fake }) {
    const txRepo = new InMemoryTransactionRepo();
    const intentRepo = new InMemoryIntentRepo();
    const paRepo = new InMemoryProviderAccountRepo();
    const registry = makeRegistry(providerOverrides);
    const useCase = new VoidPaymentTransaction(txRepo, intentRepo, paRepo, registry);
    return { txRepo, intentRepo, useCase };
  }

  test('voids a requires_action transaction via provider', async () => {
    const { txRepo, intentRepo, useCase } = setup();

    const intentId = randomUUID();
    await intentRepo.create({
      id: intentId, merchantId,
      externalPayableType: 'order', externalPayableId: 'v-order-1', amountDue: 75000,
    });

    const pendingTx = buildPendingTransaction(merchantId, intentId);
    txRepo.store.set(pendingTx.id, pendingTx);

    const result = await useCase.execute({
      merchantId,
      transactionId: pendingTx.id,
      reason: 'Order cancelled',
    });

    assert.equal(result.transaction.status, 'cancelled');
    assert.equal(result.providerCancelled, true);
    assert.ok(result.intent !== null);
    // Intent amountRemaining should be unchanged (tx was never succeeded)
    assert.equal(result.intent?.amountRemaining, 75000);
  });

  test('voids a pending transaction via provider', async () => {
    const { txRepo, intentRepo, useCase } = setup();

    const intentId = randomUUID();
    await intentRepo.create({
      id: intentId, merchantId,
      externalPayableType: 'order', externalPayableId: 'v-order-2', amountDue: 60000,
    });

    const pendingTx = buildPendingTransaction(merchantId, intentId, { status: 'pending' });
    txRepo.store.set(pendingTx.id, pendingTx);

    const result = await useCase.execute({ merchantId, transactionId: pendingTx.id });
    assert.equal(result.transaction.status, 'cancelled');
    assert.equal(result.providerCancelled, true);
  });

  test('void without any registered non-manual provider is unsupported', async () => {
    const { txRepo, intentRepo, useCase } = setup({});  // empty registry

    const intentId = randomUUID();
    await intentRepo.create({
      id: intentId, merchantId,
      externalPayableType: 'order', externalPayableId: 'v-order-3', amountDue: 50000,
    });

    const pendingTx = buildPendingTransaction(merchantId, intentId);
    txRepo.store.set(pendingTx.id, pendingTx);

    await assert.rejects(
      () => useCase.execute({ merchantId, transactionId: pendingTx.id }),
      (err: any) => {
        assert.equal(err.code, 'PROVIDER_CANCEL_UNSUPPORTED');
        return true;
      },
    );
  });

  test('voids with manual provider', async () => {
    const manual = new StandaloneManualProvider();
    const { txRepo, intentRepo, useCase } = setup({ manual });

    const intentId = randomUUID();
    await intentRepo.create({
      id: intentId, merchantId,
      externalPayableType: 'order', externalPayableId: 'v-order-4', amountDue: 45000,
    });

    const pendingTx = buildPendingTransaction(merchantId, intentId, { provider: 'manual' });
    txRepo.store.set(pendingTx.id, pendingTx);

    const result = await useCase.execute({ merchantId, transactionId: pendingTx.id });
    assert.equal(result.transaction.status, 'cancelled');
    assert.equal(result.providerCancelled, true);
  });

  test('rejects void of a succeeded transaction', async () => {
    const { txRepo, intentRepo, useCase } = setup();

    const intentId = randomUUID();
    await intentRepo.create({
      id: intentId, merchantId,
      externalPayableType: 'order', externalPayableId: 'v-order-5', amountDue: 100000,
    });

    const succeededTx = buildSucceededTransaction(merchantId, intentId);
    txRepo.store.set(succeededTx.id, succeededTx);

    await assert.rejects(
      () => useCase.execute({ merchantId, transactionId: succeededTx.id }),
      (err: any) => {
        assert.equal(err.code, 'TRANSACTION_NOT_VOIDABLE');
        return true;
      },
    );
  });

  test('rejects void of a failed transaction', async () => {
    const { txRepo, intentRepo, useCase } = setup();

    const intentId = randomUUID();
    await intentRepo.create({
      id: intentId, merchantId,
      externalPayableType: 'order', externalPayableId: 'v-order-6', amountDue: 100000,
    });

    const failedTx = buildSucceededTransaction(merchantId, intentId, { status: 'failed' });
    txRepo.store.set(failedTx.id, failedTx);

    await assert.rejects(
      () => useCase.execute({ merchantId, transactionId: failedTx.id }),
      (err: any) => {
        assert.equal(err.code, 'TRANSACTION_NOT_VOIDABLE');
        return true;
      },
    );
  });

  test('rejects void of non-existent transaction', async () => {
    const { useCase } = setup();

    await assert.rejects(
      () => useCase.execute({ merchantId, transactionId: 'nonexistent-tx' }),
      (err: any) => {
        assert.equal(err.code, 'TRANSACTION_NOT_FOUND');
        return true;
      },
    );
  });

  test('rejects void of outgoing transaction (refund row)', async () => {
    const { txRepo, intentRepo, useCase } = setup();

    const intentId = randomUUID();
    await intentRepo.create({
      id: intentId, merchantId,
      externalPayableType: 'order', externalPayableId: 'v-order-7', amountDue: 100000,
    });

    const refundTx = buildPendingTransaction(merchantId, intentId, {
      direction: 'outgoing',
      transactionType: 'refund',
    });
    txRepo.store.set(refundTx.id, refundTx);

    await assert.rejects(
      () => useCase.execute({ merchantId, transactionId: refundTx.id }),
      (err: any) => {
        assert.equal(err.code, 'TRANSACTION_NOT_VOIDABLE');
        return true;
      },
    );
  });
  test('void idempotent replay returns same cancelled transaction', async () => {
    const { txRepo, intentRepo, useCase } = setup();
    const intentId = randomUUID();
    await intentRepo.create({ id: intentId, merchantId, externalPayableType: 'order', externalPayableId: 'v-order-idem', amountDue: 50000 });
    const pendingTx = buildPendingTransaction(merchantId, intentId);
    txRepo.store.set(pendingTx.id, pendingTx);

    const first = await useCase.execute({ merchantId, transactionId: pendingTx.id, idempotencyKey: 'void-key-1' });
    const second = await useCase.execute({ merchantId, transactionId: pendingTx.id, idempotencyKey: 'void-key-1' });

    assert.equal(first.idempotentReplay, false);
    assert.equal(second.idempotentReplay, true);
    assert.equal(second.transaction.id, first.transaction.id);
    assert.equal(second.transaction.status, 'cancelled');
  });

  test('already cancelled void without matching key rejects', async () => {
    const { txRepo, intentRepo, useCase } = setup();
    const intentId = randomUUID();
    await intentRepo.create({ id: intentId, merchantId, externalPayableType: 'order', externalPayableId: 'v-order-cancelled', amountDue: 50000 });
    const cancelledTx = buildPendingTransaction(merchantId, intentId, { status: 'cancelled', idempotencyKey: 'original-key' });
    txRepo.store.set(cancelledTx.id, cancelledTx);

    await assert.rejects(
      () => useCase.execute({ merchantId, transactionId: cancelledTx.id, idempotencyKey: 'different-key' }),
      (err: any) => {
        assert.equal(err.code, 'TRANSACTION_NOT_VOIDABLE');
        return true;
      },
    );
  });

  test('non-manual provider without cancelPayment returns unsupported', async () => {
    const providerWithoutCancel = {
      providerCode: 'gateway_without_cancel',
      capabilities: { supportsCancel: false },
      createPayment: async () => { throw new Error('not used'); },
    };
    const { txRepo, intentRepo, useCase } = setup({ gateway_without_cancel: providerWithoutCancel });
    const intentId = randomUUID();
    await intentRepo.create({ id: intentId, merchantId, externalPayableType: 'order', externalPayableId: 'v-order-no-cancel', amountDue: 50000 });
    const pendingTx = buildPendingTransaction(merchantId, intentId, { provider: 'gateway_without_cancel' });
    txRepo.store.set(pendingTx.id, pendingTx);

    await assert.rejects(
      () => useCase.execute({ merchantId, transactionId: pendingTx.id }),
      (err: any) => {
        assert.equal(err.code, 'PROVIDER_CANCEL_UNSUPPORTED');
        return true;
      },
    );
  });

});
