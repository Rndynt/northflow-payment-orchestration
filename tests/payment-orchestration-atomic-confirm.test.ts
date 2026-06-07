/**
 * payment-orchestration-atomic-confirm.test.ts
 *
 * Phase 8D.1 — Atomic confirm tests.
 *
 * Validates:
 *   AC01: markSucceededIfConfirmable transitions requires_action → succeeded (changed=true)
 *   AC02: markSucceededIfConfirmable transitions pending → succeeded (changed=true)
 *   AC03: markSucceededIfConfirmable returns changed=false for already-succeeded tx
 *   AC04: markSucceededIfConfirmable returns changed=false for failed/cancelled tx
 *   AC05: ConfirmFakeGatewayPayment is idempotent when tx already succeeded (alreadyConfirmed=true)
 *   AC06: ConfirmFakeGatewayPayment updates intent totals only once (no double-credit)
 *   AC07: ConfirmFakeGatewayPayment rejects confirmation of failed tx (INVALID_TRANSACTION_STATUS)
 *   AC08: CreateGatewayPayment throws IDEMPOTENCY_PREVIOUSLY_FAILED for failed key
 *   AC09: CreateGatewayPayment idempotency replay still works for completed key
 *   AC10: ConfirmFakeGatewayPayment overpayment guard still blocks overpay
 *
 * Run:
 *   npx tsx --tsconfig apps/api/tsconfig.node.json --test \
 *     apps/api/src/__tests__/payment-orchestration-atomic-confirm.test.ts
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';

import type {
  PaymentMerchantRepository,
  PaymentProviderAccountRepository,
  PaymentIntentRepository,
  PaymentTransactionRepository,
  PaymentIdempotencyRepository,
  PaymentMerchant,
  PaymentProviderAccount,
  PaymentIntentDTO,
  PaymentTransactionDTO,
  PaymentIdempotencyKeyDTO,
} from '@northflow/payment-orchestration-core';

import { ConfirmFakeGatewayPayment } from '../apps/service/src/application/use-cases/ConfirmFakeGatewayPayment.ts';
import { CreateGatewayPayment } from '../apps/service/src/application/use-cases/CreateGatewayPayment.ts';
import { CreatePaymentIntent } from '../apps/service/src/application/use-cases/CreatePaymentIntent.ts';
import { CreateMerchant } from '../apps/service/src/application/use-cases/CreateMerchant.ts';
import { FakeGatewayProvider } from '../apps/service/src/infrastructure/providers/FakeGatewayProvider.ts';

// ── In-memory implementations ────────────────────────────────────────────────

type TxStatus = 'pending' | 'requires_action' | 'succeeded' | 'failed' | 'cancelled' | 'expired' | 'reversed';
type IntentStatus = 'requires_payment' | 'partially_paid' | 'paid' | 'overpaid' | 'refunded' | 'voided' | 'expired' | 'cancelled' | 'failed';
type MerchantStatus = 'active' | 'suspended' | 'closed';

class InMemoryMerchantRepo implements PaymentMerchantRepository {
  private readonly store = new Map<string, PaymentMerchant>();
  async findById(id: string): Promise<PaymentMerchant | null> { return this.store.get(id) ?? null; }
  async findByExternalRef(input: { sourceApp: string; externalRef: string }): Promise<PaymentMerchant | null> {
    for (const m of this.store.values()) {
      if (m.sourceApp === input.sourceApp && m.externalRef === input.externalRef) return m;
    }
    return null;
  }
  async create(input: { id: string; name: string; legalName?: string | null; externalRef?: string | null; sourceApp?: string | null; status?: string; metadata?: Record<string, unknown> }): Promise<PaymentMerchant> {
    const now = new Date();
    const m: PaymentMerchant = { id: input.id, displayName: input.name, legalName: input.legalName ?? null, externalRef: input.externalRef ?? null, sourceApp: input.sourceApp ?? null, status: (input.status ?? 'active') as MerchantStatus, metadata: input.metadata ?? {}, createdAt: now, updatedAt: now };
    this.store.set(m.id, m);
    return m;
  }
  async updateStatus(id: string, status: PaymentMerchant['status']): Promise<PaymentMerchant> {
    const m = this.store.get(id);
    if (!m) throw new Error(`Merchant not found: ${id}`);
    const updated = { ...m, status, updatedAt: new Date() };
    this.store.set(id, updated);
    return updated;
  }
}

class InMemoryProviderAccountRepo implements PaymentProviderAccountRepository {
  private readonly store = new Map<string, PaymentProviderAccount>();
  async findById(id: string, merchantId: string): Promise<PaymentProviderAccount | null> {
    const pa = this.store.get(id);
    return (!pa || pa.merchantId !== merchantId) ? null : pa;
  }
  async findByMerchantAndProvider(merchantId: string, provider: string, _env?: string): Promise<PaymentProviderAccount | null> {
    for (const pa of this.store.values()) {
      if (pa.merchantId === merchantId && pa.provider === provider) return pa;
    }
    return null;
  }
  async create(input: { id: string; merchantId: string; provider: string; environment: string; providerAccountRef?: string | null; credentialsRef?: string | null; publicConfig?: Record<string, unknown>; status?: string; metadata?: Record<string, unknown> }): Promise<PaymentProviderAccount> {
    const now = new Date();
    const pa: PaymentProviderAccount = { id: input.id, merchantId: input.merchantId, provider: input.provider, environment: input.environment as PaymentProviderAccount['environment'], providerAccountRef: input.providerAccountRef ?? null, credentialsRef: input.credentialsRef ?? null, publicConfig: input.publicConfig ?? {}, status: (input.status ?? 'active') as PaymentProviderAccount['status'], metadata: input.metadata ?? {}, createdAt: now, updatedAt: now };
    this.store.set(pa.id, pa);
    return pa;
  }
  async updateStatus(id: string, merchantId: string, status: PaymentProviderAccount['status']): Promise<PaymentProviderAccount> {
    const pa = this.store.get(id);
    if (!pa || pa.merchantId !== merchantId) throw new Error(`PA not found: ${id}`);
    const updated = { ...pa, status, updatedAt: new Date() };
    this.store.set(id, updated);
    return updated;
  }
}

class InMemoryIntentRepo implements PaymentIntentRepository {
  private readonly store = new Map<string, PaymentIntentDTO>();
  async findById(id: string, merchantId: string): Promise<PaymentIntentDTO | null> {
    const i = this.store.get(id);
    return (!i || i.merchantId !== merchantId) ? null : i;
  }
  async findByExternalPayable(input: { merchantId: string; externalPayableType: string; externalPayableId: string }): Promise<PaymentIntentDTO | null> {
    for (const i of this.store.values()) {
      if (i.merchantId === input.merchantId && i.externalPayableType === input.externalPayableType && i.externalPayableId === input.externalPayableId) return i;
    }
    return null;
  }
  async create(input: { id: string; merchantId: string; providerAccountId?: string | null; sourceApp?: string | null; externalTenantId?: string | null; externalOutletId?: string | null; externalLocationId?: string | null; externalPayableType: string; externalPayableId: string; currency?: string; amountDue: number; allowPartial?: boolean; expiresAt?: Date | null; metadata?: Record<string, unknown> | null }): Promise<PaymentIntentDTO> {
    const now = new Date();
    const intent: PaymentIntentDTO = { id: input.id, merchantId: input.merchantId, providerAccountId: input.providerAccountId ?? null, sourceApp: input.sourceApp ?? null, externalTenantId: input.externalTenantId ?? null, externalOutletId: input.externalOutletId ?? null, externalLocationId: input.externalLocationId ?? null, externalPayableType: input.externalPayableType, externalPayableId: input.externalPayableId, amountDue: input.amountDue, amountPaid: 0, amountRefunded: 0, amountRemaining: input.amountDue, currency: input.currency ?? 'IDR', status: 'requires_payment', allowPartial: input.allowPartial ?? false, expiresAt: null, metadata: input.metadata ?? {}, createdAt: now, updatedAt: now };
    this.store.set(intent.id, intent);
    return intent;
  }
  async updateTotals(input: { id: string; merchantId: string; amountPaid: number; amountRefunded: number; amountRemaining: number }): Promise<PaymentIntentDTO> {
    const i = this.store.get(input.id);
    if (!i || i.merchantId !== input.merchantId) throw new Error(`Intent not found: ${input.id}`);
    const updated = { ...i, amountPaid: input.amountPaid, amountRefunded: input.amountRefunded, amountRemaining: input.amountRemaining, updatedAt: new Date() };
    this.store.set(input.id, updated);
    return updated;
  }
  async updateStatus(input: { id: string; merchantId: string; status: string }): Promise<PaymentIntentDTO> {
    const i = this.store.get(input.id);
    if (!i || i.merchantId !== input.merchantId) throw new Error(`Intent not found: ${input.id}`);
    const updated = { ...i, status: input.status as IntentStatus, updatedAt: new Date() };
    this.store.set(input.id, updated);
    return updated;
  }
  /** Test-only direct accessor */
  get(id: string): PaymentIntentDTO | undefined { return this.store.get(id); }
}

class InMemoryTransactionRepo implements PaymentTransactionRepository {
  readonly store = new Map<string, PaymentTransactionDTO>();

  async findById(id: string, merchantId: string): Promise<PaymentTransactionDTO | null> {
    const tx = this.store.get(id);
    return (!tx || tx.merchantId !== merchantId) ? null : tx;
  }
  async findByIntentId(intentId: string, merchantId: string): Promise<PaymentTransactionDTO[]> {
    return [...this.store.values()].filter(tx => tx.intentId === intentId && tx.merchantId === merchantId);
  }
  async findByProviderReference(provider: string, providerReference: string): Promise<PaymentTransactionDTO | null> {
    for (const tx of this.store.values()) {
      if (tx.provider === provider && tx.providerReference === providerReference) return tx;
    }
    return null;
  }
  async create(input: { id: string; merchantId: string; intentId: string; providerAccountId?: string | null; provider: string; method: string; transactionType: string; direction: string; status: string; amount: number; currency?: string; parentTransactionId?: string | null; providerReference?: string | null; providerEventId?: string | null; providerPaymentUrl?: string | null; providerQrString?: string | null; failureReason?: string | null; idempotencyKey?: string | null; metadata?: Record<string, unknown> | null; rawProviderResponse?: Record<string, unknown> | null }): Promise<PaymentTransactionDTO> {
    const now = new Date();
    const tx: PaymentTransactionDTO = { id: input.id, merchantId: input.merchantId, intentId: input.intentId, providerAccountId: input.providerAccountId ?? null, provider: input.provider, method: input.method, transactionType: input.transactionType, direction: input.direction as 'incoming' | 'outgoing', status: input.status as TxStatus, amount: input.amount, currency: input.currency ?? 'IDR', parentTransactionId: input.parentTransactionId ?? null, providerReference: input.providerReference ?? null, providerEventId: input.providerEventId ?? null, providerPaymentUrl: input.providerPaymentUrl ?? null, providerQrString: input.providerQrString ?? null, failureReason: input.failureReason ?? null, idempotencyKey: input.idempotencyKey ?? null, expiresAt: null, metadata: input.metadata ?? {}, rawProviderResponse: input.rawProviderResponse ?? null, createdAt: now, updatedAt: now };
    this.store.set(tx.id, tx);
    return tx;
  }
  async updateStatus(input: { id: string; merchantId: string; status: string; failureReason?: string | null; providerReference?: string | null; providerEventId?: string | null }): Promise<PaymentTransactionDTO> {
    const tx = this.store.get(input.id);
    if (!tx || tx.merchantId !== input.merchantId) throw new Error(`Transaction not found: ${input.id}`);
    const updated = { ...tx, status: input.status as TxStatus, failureReason: input.failureReason !== undefined ? input.failureReason : tx.failureReason, updatedAt: new Date() };
    this.store.set(input.id, updated);
    return updated;
  }
  async sumSucceededRefundsByParent(parentTransactionId: string): Promise<number> {
    let total = 0;
    for (const tx of this.store.values()) {
      if (tx.parentTransactionId === parentTransactionId && tx.transactionType === 'refund' && tx.direction === 'outgoing' && tx.status === 'succeeded') total += tx.amount;
    }
    return total;
  }
  async markSucceededIfConfirmable(input: { id: string; merchantId: string }): Promise<{ transaction: PaymentTransactionDTO | null; changed: boolean }> {
    const tx = this.store.get(input.id);
    if (!tx || tx.merchantId !== input.merchantId) return { transaction: null, changed: false };
    if (tx.status !== 'requires_action' && tx.status !== 'pending') return { transaction: null, changed: false };
    const updated: PaymentTransactionDTO = { ...tx, status: 'succeeded' as TxStatus, updatedAt: new Date() };
    this.store.set(input.id, updated);
    return { transaction: updated, changed: true };
  }
}

class InMemoryIdempotencyRepo implements PaymentIdempotencyRepository {
  private readonly store = new Map<string, PaymentIdempotencyKeyDTO>();
  async reserve(input: { id: string; merchantId: string; scope: string; idempotencyKey: string; requestHash: string; expiresAt?: Date | null }): Promise<PaymentIdempotencyKeyDTO> {
    const now = new Date();
    const rec: PaymentIdempotencyKeyDTO = { id: input.id, merchantId: input.merchantId, scope: input.scope, idempotencyKey: input.idempotencyKey, requestHash: input.requestHash, responseSnapshot: null, resourceType: null, resourceId: null, status: 'processing', createdAt: now, updatedAt: now, expiresAt: input.expiresAt ?? null };
    this.store.set(`${input.merchantId}:${input.scope}:${input.idempotencyKey}`, rec);
    return rec;
  }
  async find(input: { merchantId: string; scope: string; idempotencyKey: string }): Promise<PaymentIdempotencyKeyDTO | null> {
    return this.store.get(`${input.merchantId}:${input.scope}:${input.idempotencyKey}`) ?? null;
  }
  async markCompleted(input: { merchantId: string; scope: string; idempotencyKey: string; responseSnapshot: Record<string, unknown>; resourceType?: string | null; resourceId?: string | null }): Promise<void> {
    const key = `${input.merchantId}:${input.scope}:${input.idempotencyKey}`;
    const rec = this.store.get(key);
    if (rec) this.store.set(key, { ...rec, status: 'completed', responseSnapshot: input.responseSnapshot, resourceType: input.resourceType ?? null, resourceId: input.resourceId ?? null, updatedAt: new Date() });
  }
  async markFailed(input: { merchantId: string; scope: string; idempotencyKey: string; error: string }): Promise<void> {
    const key = `${input.merchantId}:${input.scope}:${input.idempotencyKey}`;
    const rec = this.store.get(key);
    if (rec) this.store.set(key, { ...rec, status: 'failed', responseSnapshot: { error: input.error }, updatedAt: new Date() });
  }
  /** Test-only direct access to set a record to failed status for testing A2 policy. */
  forceSetFailed(merchantId: string, scope: string, idempotencyKey: string, requestHash: string): void {
    const key = `${merchantId}:${scope}:${idempotencyKey}`;
    const now = new Date();
    this.store.set(key, { id: randomUUID(), merchantId, scope, idempotencyKey, requestHash, responseSnapshot: { error: 'forced-fail' }, resourceType: null, resourceId: null, status: 'failed', createdAt: now, updatedAt: now, expiresAt: null });
  }
}

// ── Shared test setup ─────────────────────────────────────────────────────────

function makeRepos() {
  return {
    merchantRepo: new InMemoryMerchantRepo(),
    providerAccountRepo: new InMemoryProviderAccountRepo(),
    intentRepo: new InMemoryIntentRepo(),
    transactionRepo: new InMemoryTransactionRepo(),
    idempotencyRepo: new InMemoryIdempotencyRepo(),
  };
}

async function setupMerchantAndIntent(repos: ReturnType<typeof makeRepos>, amountDue = 50000, allowPartial = false) {
  const merchantId = `m-${randomUUID()}`;
  const intentId = `pi-${randomUUID()}`;
  const fakeGateway = new FakeGatewayProvider();
  const providerRegistry = new Map([[fakeGateway.providerCode, fakeGateway]]);

  await repos.merchantRepo.create({ id: merchantId, name: 'Test Merchant' });
  await repos.providerAccountRepo.create({ id: `pa-${randomUUID()}`, merchantId, provider: 'fake_gateway', environment: 'sandbox' });
  await repos.intentRepo.create({ id: intentId, merchantId, externalPayableType: 'order', externalPayableId: `ord-${randomUUID()}`, amountDue, allowPartial });

  const createGateway = new CreateGatewayPayment(
    repos.merchantRepo, repos.intentRepo, repos.transactionRepo, providerRegistry,
    repos.providerAccountRepo, repos.idempotencyRepo, 'development',
  );
  const confirm = new ConfirmFakeGatewayPayment(repos.transactionRepo, repos.intentRepo, 'development');

  return { merchantId, intentId, createGateway, confirm, providerRegistry };
}

// ── AC01: markSucceededIfConfirmable transitions requires_action → succeeded ──

describe('AC01 — markSucceededIfConfirmable: requires_action → succeeded', () => {
  test('changes status and returns changed=true', async () => {
    const { transactionRepo, intentRepo, merchantRepo } = makeRepos();
    const merchantId = 'm-ac01';
    await merchantRepo.create({ id: merchantId, name: 'M1' });
    const intentId = `pi-${randomUUID()}`;
    await intentRepo.create({ id: intentId, merchantId, externalPayableType: 'order', externalPayableId: 'o1', amountDue: 10000 });

    const txId = `tx-${randomUUID()}`;
    await transactionRepo.create({ id: txId, merchantId, intentId, provider: 'fake_gateway', method: 'qris', transactionType: 'payment', direction: 'incoming', status: 'requires_action', amount: 10000 });

    const result = await transactionRepo.markSucceededIfConfirmable({ id: txId, merchantId });
    assert.equal(result.changed, true);
    assert.equal(result.transaction?.status, 'succeeded');

    // Verify stored state also updated.
    const reloaded = await transactionRepo.findById(txId, merchantId);
    assert.equal(reloaded?.status, 'succeeded');
  });
});

// ── AC02: markSucceededIfConfirmable transitions pending → succeeded ──────────

describe('AC02 — markSucceededIfConfirmable: pending → succeeded', () => {
  test('pending status is also confirmable', async () => {
    const { transactionRepo, intentRepo, merchantRepo } = makeRepos();
    const merchantId = 'm-ac02';
    await merchantRepo.create({ id: merchantId, name: 'M2' });
    const intentId = `pi-${randomUUID()}`;
    await intentRepo.create({ id: intentId, merchantId, externalPayableType: 'order', externalPayableId: 'o2', amountDue: 20000 });

    const txId = `tx-${randomUUID()}`;
    await transactionRepo.create({ id: txId, merchantId, intentId, provider: 'fake_gateway', method: 'cash', transactionType: 'payment', direction: 'incoming', status: 'pending', amount: 20000 });

    const result = await transactionRepo.markSucceededIfConfirmable({ id: txId, merchantId });
    assert.equal(result.changed, true);
    assert.equal(result.transaction?.status, 'succeeded');
  });
});

// ── AC03: markSucceededIfConfirmable returns changed=false for already succeeded

describe('AC03 — markSucceededIfConfirmable: already succeeded → no change', () => {
  test('does not double-credit when status is already succeeded', async () => {
    const { transactionRepo, intentRepo, merchantRepo } = makeRepos();
    const merchantId = 'm-ac03';
    await merchantRepo.create({ id: merchantId, name: 'M3' });
    const intentId = `pi-${randomUUID()}`;
    await intentRepo.create({ id: intentId, merchantId, externalPayableType: 'order', externalPayableId: 'o3', amountDue: 30000 });

    const txId = `tx-${randomUUID()}`;
    await transactionRepo.create({ id: txId, merchantId, intentId, provider: 'fake_gateway', method: 'qris', transactionType: 'payment', direction: 'incoming', status: 'succeeded', amount: 30000 });

    const result = await transactionRepo.markSucceededIfConfirmable({ id: txId, merchantId });
    assert.equal(result.changed, false);
    assert.equal(result.transaction, null);
  });
});

// ── AC04: markSucceededIfConfirmable returns changed=false for terminal statuses

describe('AC04 — markSucceededIfConfirmable: failed/cancelled → no change', () => {
  test('failed tx is not confirmable', async () => {
    const { transactionRepo, intentRepo, merchantRepo } = makeRepos();
    const merchantId = 'm-ac04';
    await merchantRepo.create({ id: merchantId, name: 'M4' });
    const intentId = `pi-${randomUUID()}`;
    await intentRepo.create({ id: intentId, merchantId, externalPayableType: 'order', externalPayableId: 'o4', amountDue: 40000 });

    const txId = `tx-${randomUUID()}`;
    await transactionRepo.create({ id: txId, merchantId, intentId, provider: 'fake_gateway', method: 'qris', transactionType: 'payment', direction: 'incoming', status: 'failed', amount: 40000 });

    const result = await transactionRepo.markSucceededIfConfirmable({ id: txId, merchantId });
    assert.equal(result.changed, false);
  });

  test('cancelled tx is not confirmable', async () => {
    const { transactionRepo, intentRepo, merchantRepo } = makeRepos();
    const merchantId = 'm-ac04b';
    await merchantRepo.create({ id: merchantId, name: 'M4b' });
    const intentId = `pi-${randomUUID()}`;
    await intentRepo.create({ id: intentId, merchantId, externalPayableType: 'order', externalPayableId: 'o4b', amountDue: 40000 });

    const txId = `tx-${randomUUID()}`;
    await transactionRepo.create({ id: txId, merchantId, intentId, provider: 'fake_gateway', method: 'qris', transactionType: 'payment', direction: 'incoming', status: 'cancelled', amount: 40000 });

    const result = await transactionRepo.markSucceededIfConfirmable({ id: txId, merchantId });
    assert.equal(result.changed, false);
  });
});

// ── AC05: ConfirmFakeGatewayPayment is idempotent when tx already succeeded ───

describe('AC05 — ConfirmFakeGatewayPayment idempotent on already-succeeded tx', () => {
  test('returns alreadyConfirmed=true without re-crediting intent', async () => {
    const repos = makeRepos();
    const { merchantId, intentId, createGateway, confirm } = await setupMerchantAndIntent(repos, 50000);

    const { transaction: tx } = await createGateway.execute({
      merchantId, intentId, provider: 'fake_gateway', method: 'qris', amount: 50000,
    });

    // First confirm.
    const first = await confirm.execute({ merchantId, transactionId: tx.id });
    assert.equal(first.alreadyConfirmed, false);
    assert.equal(first.intent.amountPaid, 50000);
    assert.equal(first.intent.status, 'paid');

    // Second confirm of same tx — idempotent, must not double-credit.
    const second = await confirm.execute({ merchantId, transactionId: tx.id });
    assert.equal(second.alreadyConfirmed, true);
    // Intent totals must not change.
    assert.equal(second.intent.amountPaid, 50000);
    assert.equal(second.intent.status, 'paid');
  });
});

// ── AC06: ConfirmFakeGatewayPayment updates intent totals only once ──────────

describe('AC06 — ConfirmFakeGatewayPayment: no double-credit on concurrent confirm', () => {
  test('simulated concurrent confirms: only one credits the intent', async () => {
    const repos = makeRepos();
    const { merchantId, intentId, createGateway, confirm } = await setupMerchantAndIntent(repos, 25000);

    const { transaction: tx } = await createGateway.execute({
      merchantId, intentId, provider: 'fake_gateway', method: 'qris', amount: 25000,
    });

    // Simulate concurrency: both calls start before either finishes.
    // With atomic markSucceededIfConfirmable, only one can change=true.
    const [r1, r2] = await Promise.allSettled([
      confirm.execute({ merchantId, transactionId: tx.id }),
      confirm.execute({ merchantId, transactionId: tx.id }),
    ]);

    const fulfilled = [r1, r2].filter(r => r.status === 'fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof confirm.execute>>>[];
    // Both should succeed (one with alreadyConfirmed=false, one with alreadyConfirmed=true).
    assert.equal(fulfilled.length, 2, 'Both concurrent confirms should return (not throw)');

    // Get final intent state — amountPaid must be exactly 25000 (not 50000).
    const finalIntent = repos.intentRepo.get(intentId);
    assert.equal(finalIntent?.amountPaid, 25000, 'amountPaid must not be double-credited');
    assert.equal(finalIntent?.status, 'paid');
  });
});

// ── AC07: ConfirmFakeGatewayPayment rejects failed tx ────────────────────────

describe('AC07 — ConfirmFakeGatewayPayment rejects INVALID_TRANSACTION_STATUS', () => {
  test('throws for failed transaction with correct error code', async () => {
    const repos = makeRepos();
    const { merchantId, intentId, createGateway, confirm } = await setupMerchantAndIntent(repos, 30000);

    const { transaction: tx } = await createGateway.execute({
      merchantId, intentId, provider: 'fake_gateway', method: 'qris', amount: 30000,
    });

    // Manually mark tx as failed.
    await repos.transactionRepo.updateStatus({ id: tx.id, merchantId, status: 'failed' });

    await assert.rejects(
      () => confirm.execute({ merchantId, transactionId: tx.id }),
      (err: any) => {
        assert.equal(err.code, 'INVALID_TRANSACTION_STATUS');
        assert.equal(err.statusCode, 422);
        return true;
      },
    );
  });
});

// ── AC08: CreateGatewayPayment throws IDEMPOTENCY_PREVIOUSLY_FAILED ──────────

describe('AC08 — CreateGatewayPayment throws IDEMPOTENCY_PREVIOUSLY_FAILED for failed key', () => {
  test('failed idempotency key is not retryable with same key', async () => {
    const repos = makeRepos();
    const { merchantId, intentId, createGateway } = await setupMerchantAndIntent(repos, 15000);

    const idempotencyKey = `idem-${randomUUID()}`;
    const requestHash = 'test-hash';

    // Pre-load a failed idempotency key. Scope must match IDEMPOTENCY_SCOPE in CreateGatewayPayment.
    repos.idempotencyRepo.forceSetFailed(merchantId, 'create_gateway_payment', idempotencyKey, requestHash);

    await assert.rejects(
      () => createGateway.execute({
        merchantId, intentId, provider: 'fake_gateway', method: 'qris', amount: 15000,
        idempotencyKey,
      }),
      (err: any) => {
        assert.equal(err.code, 'IDEMPOTENCY_PREVIOUSLY_FAILED');
        assert.equal(err.statusCode, 409);
        return true;
      },
    );
  });
});

// ── AC09: CreateGatewayPayment idempotency replay works for completed key ────

describe('AC09 — CreateGatewayPayment: idempotency replay for completed key', () => {
  test('same idempotency key returns cached response on replay', async () => {
    const repos = makeRepos();
    const { merchantId, intentId, createGateway } = await setupMerchantAndIntent(repos, 20000);

    const idempotencyKey = `idem-${randomUUID()}`;

    const first = await createGateway.execute({
      merchantId, intentId, provider: 'fake_gateway', method: 'qris', amount: 20000, idempotencyKey,
    });
    assert.equal(first.idempotentReplay, false);

    const second = await createGateway.execute({
      merchantId, intentId, provider: 'fake_gateway', method: 'qris', amount: 20000, idempotencyKey,
    });
    assert.equal(second.idempotentReplay, true);
    assert.equal(second.transaction.id, first.transaction.id);
  });
});

// ── AC10: ConfirmFakeGatewayPayment overpayment guard ─────────────────────────

describe('AC10 — ConfirmFakeGatewayPayment overpayment guard', () => {
  test('rejects confirm when tx amount exceeds amountRemaining', async () => {
    const repos = makeRepos();
    const { merchantId, intentId, createGateway, confirm } = await setupMerchantAndIntent(repos, 30000, true);

    // Create two transactions that together exceed amountDue.
    const { transaction: tx1 } = await createGateway.execute({
      merchantId, intentId, provider: 'fake_gateway', method: 'qris', amount: 20000,
      idempotencyKey: `idem-1-${randomUUID()}`,
    });

    const { transaction: tx2 } = await createGateway.execute({
      merchantId, intentId, provider: 'fake_gateway', method: 'cash', amount: 20000,
      idempotencyKey: `idem-2-${randomUUID()}`,
    });

    // Confirm tx1 first — reduces amountRemaining to 10000.
    await confirm.execute({ merchantId, transactionId: tx1.id });

    // Confirm tx2 (20000) > amountRemaining (10000) → overpayment rejected.
    await assert.rejects(
      () => confirm.execute({ merchantId, transactionId: tx2.id }),
      (err: any) => {
        assert.equal(err.code, 'OVERPAYMENT_REJECTED');
        assert.equal(err.statusCode, 422);
        return true;
      },
    );
  });
});
