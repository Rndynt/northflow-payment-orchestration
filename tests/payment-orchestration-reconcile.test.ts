/**
 * payment-orchestration-reconcile.test.ts
 *
 * Phase 8E Hardening — Task 3: ReconcilePaymentIntentTotals use case unit tests.
 *
 * Tests the reconciliation safety use case that fixes transaction/intent total drift
 * caused by a crash between TX update and intent totals/status update.
 *
 * Scenarios:
 *   RC01: tx succeeded, intent stale (requires_payment) → reconcile fixes to paid, changed=true
 *   RC02: totals already correct → changed=false
 *   RC03: partial payment (amountPaid < amountDue) → status=partially_paid
 *   RC04: INTENT_NOT_FOUND → throws with statusCode 404
 *
 * Run:
 *   npx tsx --tsconfig apps/api/tsconfig.node.json --test \
 *     apps/api/src/__tests__/payment-orchestration-reconcile.test.ts
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';

import { ReconcilePaymentIntentTotals } from '../apps/service/src/application/use-cases/ReconcilePaymentIntentTotals.ts';
import type {
  PaymentIntentRepository,
  PaymentTransactionRepository,
} from '@northflow/payment-orchestration-core';
import type {
  StandalonePaymentIntentDTO,
  StandalonePaymentTransactionDTO,
} from '@northflow/payment-orchestration-core';

// ── Minimal in-memory repositories ───────────────────────────────────────────

type IntentStatus =
  | 'requires_payment'
  | 'partially_paid'
  | 'paid'
  | 'overpaid'
  | 'refunded'
  | 'voided'
  | 'expired'
  | 'cancelled'
  | 'failed';

class InMemoryIntentRepo implements PaymentIntentRepository {
  private readonly store = new Map<string, StandalonePaymentIntentDTO>();

  async findById(id: string, merchantId: string): Promise<StandalonePaymentIntentDTO | null> {
    const intent = this.store.get(id);
    return !intent || intent.merchantId !== merchantId ? null : intent;
  }

  async findByExternalPayable(input: {
    merchantId: string;
    externalPayableType: string;
    externalPayableId: string;
    sourceApp?: string | null;
  }): Promise<StandalonePaymentIntentDTO | null> {
    for (const intent of this.store.values()) {
      if (
        intent.merchantId === input.merchantId &&
        intent.externalPayableType === input.externalPayableType &&
        intent.externalPayableId === input.externalPayableId
      )
        return intent;
    }
    return null;
  }

  async create(input: {
    id: string;
    merchantId: string;
    providerAccountId?: string | null;
    sourceApp?: string | null;
    externalTenantId?: string | null;
    externalOutletId?: string | null;
    externalLocationId?: string | null;
    externalPayableType: string;
    externalPayableId: string;
    currency?: string;
    amountDue: number;
    allowPartial?: boolean;
    expiresAt?: Date | null;
    metadata?: Record<string, unknown> | null;
  }): Promise<StandalonePaymentIntentDTO> {
    const now = new Date();
    const intent: StandalonePaymentIntentDTO = {
      id: input.id,
      merchantId: input.merchantId,
      providerAccountId: input.providerAccountId ?? null,
      sourceApp: input.sourceApp ?? null,
      externalTenantId: input.externalTenantId ?? null,
      externalOutletId: input.externalOutletId ?? null,
      externalLocationId: input.externalLocationId ?? null,
      externalPayableType: input.externalPayableType,
      externalPayableId: input.externalPayableId,
      amountDue: input.amountDue,
      amountPaid: 0,
      amountRefunded: 0,
      amountRemaining: input.amountDue,
      currency: input.currency ?? 'IDR',
      status: 'requires_payment',
      allowPartial: input.allowPartial ?? false,
      expiresAt: null,
      metadata: input.metadata ?? {},
      createdAt: now,
      updatedAt: now,
    };
    this.store.set(intent.id, intent);
    return intent;
  }

  async updateTotals(input: {
    id: string;
    merchantId: string;
    amountPaid: number;
    amountRefunded: number;
    amountRemaining: number;
  }): Promise<StandalonePaymentIntentDTO> {
    const intent = this.store.get(input.id);
    if (!intent || intent.merchantId !== input.merchantId)
      throw new Error(`Intent not found: ${input.id}`);
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

  async updateStatus(input: {
    id: string;
    merchantId: string;
    status: string;
  }): Promise<StandalonePaymentIntentDTO> {
    const intent = this.store.get(input.id);
    if (!intent || intent.merchantId !== input.merchantId)
      throw new Error(`Intent not found: ${input.id}`);
    const updated = {
      ...intent,
      status: input.status as IntentStatus,
      updatedAt: new Date(),
    };
    this.store.set(input.id, updated);
    return updated;
  }
}

type TxStatus =
  | 'pending'
  | 'requires_action'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'expired'
  | 'reversed';

class InMemoryTransactionRepo implements PaymentTransactionRepository {
  private readonly store = new Map<string, StandalonePaymentTransactionDTO>();

  async findById(id: string, merchantId: string): Promise<StandalonePaymentTransactionDTO | null> {
    const tx = this.store.get(id);
    return !tx || tx.merchantId !== merchantId ? null : tx;
  }

  async findByIntentId(
    intentId: string,
    merchantId: string,
  ): Promise<StandalonePaymentTransactionDTO[]> {
    return [...this.store.values()].filter(
      (tx) => tx.intentId === intentId && tx.merchantId === merchantId,
    );
  }

  async findByProviderReference(
    provider: string,
    providerReference: string,
  ): Promise<StandalonePaymentTransactionDTO | null> {
    for (const tx of this.store.values()) {
      if (tx.provider === provider && tx.providerReference === providerReference) return tx;
    }
    return null;
  }

  async create(input: {
    id: string;
    merchantId: string;
    intentId: string;
    providerAccountId?: string | null;
    provider: string;
    method: string;
    transactionType: string;
    direction: string;
    status: string;
    amount: number;
    currency?: string;
    parentTransactionId?: string | null;
    providerReference?: string | null;
    providerEventId?: string | null;
    providerPaymentUrl?: string | null;
    providerQrString?: string | null;
    failureReason?: string | null;
    idempotencyKey?: string | null;
    metadata?: Record<string, unknown> | null;
    rawProviderResponse?: Record<string, unknown> | null;
  }): Promise<StandalonePaymentTransactionDTO> {
    const now = new Date();
    const tx: StandalonePaymentTransactionDTO = {
      id: input.id,
      merchantId: input.merchantId,
      intentId: input.intentId,
      providerAccountId: input.providerAccountId ?? null,
      provider: input.provider,
      method: input.method,
      transactionType: input.transactionType,
      direction: input.direction as 'incoming' | 'outgoing',
      status: input.status as TxStatus,
      amount: input.amount,
      currency: input.currency ?? 'IDR',
      parentTransactionId: input.parentTransactionId ?? null,
      providerReference: input.providerReference ?? null,
      providerEventId: input.providerEventId ?? null,
      providerPaymentUrl: input.providerPaymentUrl ?? null,
      providerQrString: input.providerQrString ?? null,
      failureReason: input.failureReason ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      expiresAt: null,
      metadata: input.metadata ?? {},
      rawProviderResponse: input.rawProviderResponse ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.store.set(tx.id, tx);
    return tx;
  }

  async updateStatus(input: {
    id: string;
    merchantId: string;
    status: string;
    failureReason?: string | null;
    providerReference?: string | null;
    providerEventId?: string | null;
  }): Promise<StandalonePaymentTransactionDTO> {
    const tx = this.store.get(input.id);
    if (!tx || tx.merchantId !== input.merchantId)
      throw new Error(`Transaction not found: ${input.id}`);
    const updated = {
      ...tx,
      status: input.status as TxStatus,
      failureReason: input.failureReason !== undefined ? input.failureReason : tx.failureReason,
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
      )
        total += tx.amount;
    }
    return total;
  }

  async markSucceededIfConfirmable(input: {
    id: string;
    merchantId: string;
  }): Promise<{ transaction: StandalonePaymentTransactionDTO | null; changed: boolean }> {
    const tx = this.store.get(input.id);
    if (!tx || tx.merchantId !== input.merchantId) return { transaction: null, changed: false };
    if (tx.status !== 'requires_action' && tx.status !== 'pending')
      return { transaction: null, changed: false };
    const updated: StandalonePaymentTransactionDTO = {
      ...tx,
      status: 'succeeded' as TxStatus,
      updatedAt: new Date(),
    };
    this.store.set(input.id, updated);
    return { transaction: updated, changed: true };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRepos() {
  return {
    intentRepo: new InMemoryIntentRepo(),
    transactionRepo: new InMemoryTransactionRepo(),
  };
}

function makeUseCase(
  intentRepo: InMemoryIntentRepo,
  transactionRepo: InMemoryTransactionRepo,
): ReconcilePaymentIntentTotals {
  return new ReconcilePaymentIntentTotals(intentRepo, transactionRepo);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('RC01 — reconcile: tx succeeded, intent stale → fixes to paid', () => {
  test('reconcile corrects stale intent totals to paid, changed=true', async () => {
    const { intentRepo, transactionRepo } = makeRepos();
    const reconcile = makeUseCase(intentRepo, transactionRepo);

    const merchantId = randomUUID();
    const intentId = randomUUID();
    const txId = randomUUID();

    // Create intent (amountDue=50000, amountPaid=0 — fresh, stale)
    await intentRepo.create({
      id: intentId,
      merchantId,
      externalPayableType: 'order',
      externalPayableId: 'ord-rc01',
      amountDue: 50000,
    });

    // Simulate: TX was marked succeeded but intent not updated (crash scenario)
    await transactionRepo.create({
      id: txId,
      merchantId,
      intentId,
      provider: 'fake_gateway',
      method: 'qris',
      transactionType: 'payment',
      direction: 'incoming',
      status: 'succeeded',
      amount: 50000,
      providerReference: 'fake_ref_rc01',
    });

    // Verify intent is stale before reconcile
    const beforeIntent = await intentRepo.findById(intentId, merchantId);
    assert.equal(beforeIntent?.status, 'requires_payment');
    assert.equal(beforeIntent?.amountPaid, 0);

    const result = await reconcile.execute({ merchantId, intentId });

    assert.equal(result.changed, true);
    assert.equal(result.before.amountPaid, 0);
    assert.equal(result.before.status, 'requires_payment');
    assert.equal(result.after.amountPaid, 50000);
    assert.equal(result.after.amountRemaining, 0);
    assert.equal(result.after.status, 'paid');
    assert.equal(result.intent.status, 'paid');
    assert.equal(result.intent.amountPaid, 50000);
    assert.equal(result.intent.amountRemaining, 0);
  });
});

describe('RC02 — reconcile: totals already correct → changed=false', () => {
  test('returns changed=false when DB totals already match transactions', async () => {
    const { intentRepo, transactionRepo } = makeRepos();
    const reconcile = makeUseCase(intentRepo, transactionRepo);

    const merchantId = randomUUID();
    const intentId = randomUUID();

    const intent = await intentRepo.create({
      id: intentId,
      merchantId,
      externalPayableType: 'order',
      externalPayableId: 'ord-rc02',
      amountDue: 30000,
    });

    // No transactions at all → amountPaid=0, status=requires_payment, amountRemaining=30000
    // Intent DB state already has amountPaid=0, status=requires_payment → no drift
    const result = await reconcile.execute({ merchantId, intentId });

    assert.equal(result.changed, false);
    assert.equal(result.before.amountPaid, intent.amountPaid);
    assert.equal(result.before.status, intent.status);
    assert.equal(result.after.amountPaid, 0);
    assert.equal(result.after.status, 'requires_payment');
  });
});

describe('RC03 — reconcile: partial payment → status=partially_paid', () => {
  test('reconcile sets partially_paid when amountPaid < amountDue', async () => {
    const { intentRepo, transactionRepo } = makeRepos();
    const reconcile = makeUseCase(intentRepo, transactionRepo);

    const merchantId = randomUUID();
    const intentId = randomUUID();

    await intentRepo.create({
      id: intentId,
      merchantId,
      externalPayableType: 'order',
      externalPayableId: 'ord-rc03',
      amountDue: 100000,
      allowPartial: true,
    });

    // Only a partial payment succeeded
    await transactionRepo.create({
      id: randomUUID(),
      merchantId,
      intentId,
      provider: 'fake_gateway',
      method: 'qris',
      transactionType: 'payment',
      direction: 'incoming',
      status: 'succeeded',
      amount: 40000,
      providerReference: 'fake_ref_rc03_partial',
    });

    const result = await reconcile.execute({ merchantId, intentId });

    assert.equal(result.changed, true);
    assert.equal(result.after.amountPaid, 40000);
    assert.equal(result.after.amountRemaining, 60000);
    assert.equal(result.after.status, 'partially_paid');
    assert.equal(result.intent.status, 'partially_paid');
  });
});

describe('RC04 — reconcile: INTENT_NOT_FOUND → throws 404', () => {
  test('throws INTENT_NOT_FOUND for unknown intentId', async () => {
    const { intentRepo, transactionRepo } = makeRepos();
    const reconcile = makeUseCase(intentRepo, transactionRepo);

    await assert.rejects(
      () =>
        reconcile.execute({
          merchantId: randomUUID(),
          intentId: randomUUID(),
        }),
      (err: any) => {
        assert.equal(err.code, 'INTENT_NOT_FOUND');
        assert.equal(err.statusCode, 404);
        return true;
      },
    );
  });
});

describe('RC05 — reconcile: failed/pending txns do not count toward amountPaid', () => {
  test('only succeeded transactions contribute to amountPaid', async () => {
    const { intentRepo, transactionRepo } = makeRepos();
    const reconcile = makeUseCase(intentRepo, transactionRepo);

    const merchantId = randomUUID();
    const intentId = randomUUID();

    await intentRepo.create({
      id: intentId,
      merchantId,
      externalPayableType: 'order',
      externalPayableId: 'ord-rc05',
      amountDue: 50000,
    });

    // Failed tx — should NOT count
    await transactionRepo.create({
      id: randomUUID(),
      merchantId,
      intentId,
      provider: 'fake_gateway',
      method: 'qris',
      transactionType: 'payment',
      direction: 'incoming',
      status: 'failed',
      amount: 50000,
      providerReference: 'fake_ref_rc05_fail',
    });

    // Pending tx — should NOT count
    await transactionRepo.create({
      id: randomUUID(),
      merchantId,
      intentId,
      provider: 'fake_gateway',
      method: 'qris',
      transactionType: 'payment',
      direction: 'incoming',
      status: 'requires_action',
      amount: 50000,
      providerReference: 'fake_ref_rc05_pending',
    });

    const result = await reconcile.execute({ merchantId, intentId });

    // No succeeded transactions → amountPaid stays 0 → no drift
    assert.equal(result.changed, false);
    assert.equal(result.after.amountPaid, 0);
    assert.equal(result.after.status, 'requires_payment');
  });
});
