/**
 * payment-orchestration-service-fakegateway-flow.test.ts
 *
 * Phase 8D integration test: validates the full FakeGateway payment flow
 * using real use-case classes wired with in-memory repository implementations.
 *
 * Phase 8D Hardening: updated constructor calls + new test scenarios S15-S19.
 *   S15: Gateway idempotency replay
 *   S16: Gateway idempotency conflict
 *   S17: Provider account validation (invalid providerAccountId)
 *   S18: ConfirmFakeGateway — overpayment guard at confirmation time
 *   S19: ConfirmFakeGateway — reject invalid transaction status
 *
 * Strategy (Option C): in-memory repos + real use-case classes.
 * Avoids full HTTP server setup and DB dependencies, while still exercising
 * all domain logic: merchant creation, provider accounts, intent creation,
 * gateway payment, confirm, status polling, refundability calculation.
 *
 * Run:
 *   npx tsx --tsconfig apps/api/tsconfig.node.json --test \
 *     apps/api/src/__tests__/payment-orchestration-service-fakegateway-flow.test.ts
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// ── In-memory repository implementations ─────────────────────────────────────

import type {
  PaymentMerchantRepository,
  PaymentProviderAccountRepository,
  PaymentIntentRepository,
  PaymentTransactionRepository,
  PaymentIdempotencyRepository,
} from '@northflow/payment-orchestration-core';

import type {
  PaymentMerchant,
  PaymentProviderAccount,
  StandalonePaymentIntentDTO,
  StandalonePaymentTransactionDTO,
  PaymentIdempotencyKeyDTO,
} from '@northflow/payment-orchestration-core';

type MerchantStatus = 'active' | 'suspended' | 'closed';

class InMemoryMerchantRepo implements PaymentMerchantRepository {
  private readonly store = new Map<string, PaymentMerchant>();

  async findById(id: string): Promise<PaymentMerchant | null> {
    return this.store.get(id) ?? null;
  }

  async findByExternalRef(input: { sourceApp: string; externalRef: string }): Promise<PaymentMerchant | null> {
    for (const m of this.store.values()) {
      if (m.sourceApp === input.sourceApp && m.externalRef === input.externalRef) {
        return m;
      }
    }
    return null;
  }

  async create(input: {
    id: string;
    name: string;
    legalName?: string | null;
    externalRef?: string | null;
    sourceApp?: string | null;
    status?: string;
    metadata?: Record<string, unknown>;
  }): Promise<PaymentMerchant> {
    const now = new Date();
    const merchant: PaymentMerchant = {
      id: input.id,
      displayName: input.name,
      legalName: input.legalName ?? null,
      externalRef: input.externalRef ?? null,
      sourceApp: input.sourceApp ?? null,
      status: (input.status ?? 'active') as MerchantStatus,
      metadata: input.metadata ?? {},
      createdAt: now,
      updatedAt: now,
    };
    this.store.set(merchant.id, merchant);
    return merchant;
  }

  async updateStatus(id: string, status: PaymentMerchant['status']): Promise<PaymentMerchant> {
    const m = this.store.get(id);
    if (!m) throw new Error(`Merchant not found: ${id}`);
    const updated = { ...m, status, updatedAt: new Date() };
    this.store.set(id, updated);
    return updated;
  }
}

type ProviderAccountStatus = 'active' | 'disabled' | 'suspended' | 'closed';

class InMemoryProviderAccountRepo implements PaymentProviderAccountRepository {
  private readonly store = new Map<string, PaymentProviderAccount>();

  async findById(id: string, merchantId: string): Promise<PaymentProviderAccount | null> {
    const pa = this.store.get(id);
    if (!pa || pa.merchantId !== merchantId) return null;
    return pa;
  }

  async findByMerchantAndProvider(
    merchantId: string,
    provider: string,
    environment?: string,
  ): Promise<PaymentProviderAccount | null> {
    for (const pa of this.store.values()) {
      if (pa.merchantId === merchantId && pa.provider === provider) {
        if (!environment || pa.environment === environment) return pa;
      }
    }
    return null;
  }

  async create(input: {
    id: string;
    merchantId: string;
    provider: string;
    environment: string;
    providerAccountRef?: string | null;
    credentialsRef?: string | null;
    publicConfig?: Record<string, unknown>;
    status?: string;
    metadata?: Record<string, unknown>;
  }): Promise<PaymentProviderAccount> {
    const now = new Date();
    const pa: PaymentProviderAccount = {
      id: input.id,
      merchantId: input.merchantId,
      provider: input.provider,
      environment: input.environment as PaymentProviderAccount['environment'],
      providerAccountRef: input.providerAccountRef ?? null,
      credentialsRef: input.credentialsRef ?? null,
      publicConfig: input.publicConfig ?? {},
      status: (input.status ?? 'active') as ProviderAccountStatus,
      metadata: input.metadata ?? {},
      createdAt: now,
      updatedAt: now,
    };
    this.store.set(pa.id, pa);
    return pa;
  }

  async updateStatus(id: string, merchantId: string, status: PaymentProviderAccount['status']): Promise<PaymentProviderAccount> {
    const pa = this.store.get(id);
    if (!pa || pa.merchantId !== merchantId) throw new Error(`Provider account not found: ${id}`);
    const updated = { ...pa, status, updatedAt: new Date() };
    this.store.set(id, updated);
    return updated;
  }
}

type IntentStatus = 'requires_payment' | 'partially_paid' | 'paid' | 'overpaid' | 'refunded' | 'voided' | 'expired' | 'cancelled' | 'failed';

class InMemoryIntentRepo implements PaymentIntentRepository {
  private readonly store = new Map<string, StandalonePaymentIntentDTO>();

  async findById(id: string, merchantId: string): Promise<StandalonePaymentIntentDTO | null> {
    const intent = this.store.get(id);
    if (!intent || intent.merchantId !== merchantId) return null;
    return intent;
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
      ) {
        return intent;
      }
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
    if (!intent || intent.merchantId !== input.merchantId) throw new Error(`Intent not found: ${input.id}`);
    const updated = { ...intent, amountPaid: input.amountPaid, amountRefunded: input.amountRefunded, amountRemaining: input.amountRemaining, updatedAt: new Date() };
    this.store.set(input.id, updated);
    return updated;
  }

  async updateStatus(input: {
    id: string;
    merchantId: string;
    status: string;
  }): Promise<StandalonePaymentIntentDTO> {
    const intent = this.store.get(input.id);
    if (!intent || intent.merchantId !== input.merchantId) throw new Error(`Intent not found: ${input.id}`);
    const updated = { ...intent, status: input.status as IntentStatus, updatedAt: new Date() };
    this.store.set(input.id, updated);
    return updated;
  }
}

type TxStatus = 'pending' | 'requires_action' | 'succeeded' | 'failed' | 'cancelled' | 'expired' | 'reversed';

class InMemoryTransactionRepo implements PaymentTransactionRepository {
  private readonly store = new Map<string, StandalonePaymentTransactionDTO>();

  async findById(id: string, merchantId: string): Promise<StandalonePaymentTransactionDTO | null> {
    const tx = this.store.get(id);
    if (!tx || tx.merchantId !== merchantId) return null;
    return tx;
  }

  async findByIntentId(intentId: string, merchantId: string): Promise<StandalonePaymentTransactionDTO[]> {
    return [...this.store.values()].filter(tx => tx.intentId === intentId && tx.merchantId === merchantId);
  }

  async findByProviderReference(provider: string, providerReference: string): Promise<StandalonePaymentTransactionDTO | null> {
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
    if (!tx || tx.merchantId !== input.merchantId) throw new Error(`Transaction not found: ${input.id}`);
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
      ) {
        total += tx.amount;
      }
    }
    return total;
  }

  async markSucceededIfConfirmable(input: {
    id: string;
    merchantId: string;
  }): Promise<{ transaction: StandalonePaymentTransactionDTO | null; changed: boolean }> {
    const tx = this.store.get(input.id);
    if (!tx || tx.merchantId !== input.merchantId) return { transaction: null, changed: false };
    if (tx.status !== 'requires_action' && tx.status !== 'pending') {
      return { transaction: null, changed: false };
    }
    const updated: StandalonePaymentTransactionDTO = {
      ...tx,
      status: 'succeeded' as TxStatus,
      updatedAt: new Date(),
    };
    this.store.set(input.id, updated);
    return { transaction: updated, changed: true };
  }
}

class InMemoryIdempotencyRepo implements PaymentIdempotencyRepository {
  private readonly store = new Map<string, PaymentIdempotencyKeyDTO>();

  async reserve(input: {
    id: string;
    merchantId: string;
    scope: string;
    idempotencyKey: string;
    requestHash: string;
    expiresAt?: Date | null;
  }): Promise<PaymentIdempotencyKeyDTO> {
    const now = new Date();
    const record: PaymentIdempotencyKeyDTO = {
      id: input.id,
      merchantId: input.merchantId,
      scope: input.scope,
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      responseSnapshot: null,
      resourceType: null,
      resourceId: null,
      status: 'processing',
      createdAt: now,
      updatedAt: now,
      expiresAt: null,
    };
    this.store.set(`${input.merchantId}:${input.scope}:${input.idempotencyKey}`, record);
    return record;
  }

  async find(input: {
    merchantId: string;
    scope: string;
    idempotencyKey: string;
  }): Promise<PaymentIdempotencyKeyDTO | null> {
    return this.store.get(`${input.merchantId}:${input.scope}:${input.idempotencyKey}`) ?? null;
  }

  async markCompleted(input: {
    merchantId: string;
    scope: string;
    idempotencyKey: string;
    responseSnapshot: Record<string, unknown>;
    resourceType?: string | null;
    resourceId?: string | null;
  }): Promise<void> {
    const key = `${input.merchantId}:${input.scope}:${input.idempotencyKey}`;
    const record = this.store.get(key);
    if (!record) return;
    this.store.set(key, {
      ...record,
      status: 'completed',
      responseSnapshot: input.responseSnapshot,
      resourceType: input.resourceType ?? null,
      resourceId: input.resourceId ?? null,
      updatedAt: new Date(),
    });
  }

  async markFailed(input: {
    merchantId: string;
    scope: string;
    idempotencyKey: string;
    error: string;
  }): Promise<void> {
    const key = `${input.merchantId}:${input.scope}:${input.idempotencyKey}`;
    const record = this.store.get(key);
    if (!record) return;
    this.store.set(key, { ...record, status: 'failed', responseSnapshot: { error: input.error }, updatedAt: new Date() });
  }
}

// ── Use-case imports (from standalone service) ────────────────────────────────

import { CreateMerchant } from '../apps/service/src/application/use-cases/CreateMerchant.ts';
import { CreateProviderAccount } from '../apps/service/src/application/use-cases/CreateProviderAccount.ts';
import { CreatePaymentIntent } from '../apps/service/src/application/use-cases/CreatePaymentIntent.ts';
import { CreateGatewayPayment } from '../apps/service/src/application/use-cases/CreateGatewayPayment.ts';
import { ConfirmFakeGatewayPayment } from '../apps/service/src/application/use-cases/ConfirmFakeGatewayPayment.ts';
import { GetPaymentIntentStatus } from '../apps/service/src/application/use-cases/GetPaymentIntentStatus.ts';
import { GetRefundability } from '../apps/service/src/application/use-cases/GetRefundability.ts';
import { StandaloneFakeGatewayProvider } from '../apps/service/src/infrastructure/providers/StandaloneFakeGatewayProvider.ts';

// ── Shared fixture factory ────────────────────────────────────────────────────

function buildRepos() {
  const merchantRepo = new InMemoryMerchantRepo();
  const providerAccountRepo = new InMemoryProviderAccountRepo();
  const intentRepo = new InMemoryIntentRepo();
  const transactionRepo = new InMemoryTransactionRepo();
  const idempotencyRepo = new InMemoryIdempotencyRepo();
  return { merchantRepo, providerAccountRepo, intentRepo, transactionRepo, idempotencyRepo };
}

function buildProviderRegistry() {
  const fakeGateway = new StandaloneFakeGatewayProvider();
  const registry = new Map([[fakeGateway.providerCode, fakeGateway]]);
  return registry;
}

/**
 * Build a CreateGatewayPayment use case wired with in-memory repos.
 * nodeEnv defaults to 'test' so fake_gateway dev convenience is active.
 */
function buildCreateGatewayPayment(repos: ReturnType<typeof buildRepos>, nodeEnv = 'test') {
  const registry = buildProviderRegistry();
  return new CreateGatewayPayment(
    repos.merchantRepo,
    repos.intentRepo,
    repos.transactionRepo,
    registry,
    repos.providerAccountRepo,
    repos.idempotencyRepo,
    nodeEnv,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Phase 8D FakeGateway Flow', () => {

  // Scenario 1: CreateMerchant — creates new merchant
  test('S01: CreateMerchant creates new merchant', async () => {
    const { merchantRepo } = buildRepos();
    const uc = new CreateMerchant(merchantRepo);

    const { merchant, created } = await uc.execute({
      name: 'Warung Nasi Padang',
      sourceApp: 'aurapos',
      externalRef: 'tenant-001',
    });

    assert.ok(merchant.id.startsWith('merchant_'), `id should start with merchant_, got: ${merchant.id}`);
    assert.equal(merchant.displayName, 'Warung Nasi Padang');
    assert.equal(merchant.sourceApp, 'aurapos');
    assert.equal(merchant.externalRef, 'tenant-001');
    assert.equal(merchant.status, 'active');
    assert.equal(created, true);
  });

  // Scenario 2: CreateMerchant — returns existing if sourceApp+externalRef matches
  test('S02: CreateMerchant is idempotent for same sourceApp+externalRef', async () => {
    const { merchantRepo } = buildRepos();
    const uc = new CreateMerchant(merchantRepo);

    const first = await uc.execute({ name: 'Kedai Kopi', sourceApp: 'aurapos', externalRef: 'tenant-002' });
    const second = await uc.execute({ name: 'Kedai Kopi', sourceApp: 'aurapos', externalRef: 'tenant-002' });

    assert.equal(first.merchant.id, second.merchant.id);
    assert.equal(second.created, false);
  });

  // Scenario 3: CreateProviderAccount — fails if merchant not found
  test('S03: CreateProviderAccount throws 404 if merchant not found', async () => {
    const { merchantRepo, providerAccountRepo } = buildRepos();
    const uc = new CreateProviderAccount(merchantRepo, providerAccountRepo);

    await assert.rejects(
      () => uc.execute({ merchantId: 'merchant_notexist', provider: 'fake_gateway', environment: 'sandbox' }),
      (err: { code?: string }) => {
        assert.equal(err.code, 'MERCHANT_NOT_FOUND');
        return true;
      },
    );
  });

  // Scenario 4: CreateProviderAccount — creates provider account for existing merchant
  test('S04: CreateProviderAccount creates provider account under existing merchant', async () => {
    const { merchantRepo, providerAccountRepo } = buildRepos();
    const createMerchant = new CreateMerchant(merchantRepo);
    const createPa = new CreateProviderAccount(merchantRepo, providerAccountRepo);

    const { merchant } = await createMerchant.execute({ name: 'Test Merchant', sourceApp: 'aurapos', externalRef: 'tm-001' });
    const { providerAccount } = await createPa.execute({
      merchantId: merchant.id,
      provider: 'fake_gateway',
      environment: 'sandbox',
      providerAccountRef: 'ref-abc-001',
    });

    assert.ok(providerAccount.id.startsWith('pa_'));
    assert.equal(providerAccount.merchantId, merchant.id);
    assert.equal(providerAccount.provider, 'fake_gateway');
    assert.equal(providerAccount.environment, 'sandbox');
    assert.equal(providerAccount.status, 'active');
    assert.equal(providerAccount.providerAccountRef, 'ref-abc-001');
  });

  // Scenario 5: CreatePaymentIntent — creates intent with requires_payment status
  test('S05: CreatePaymentIntent creates intent with correct initial state', async () => {
    const { merchantRepo, intentRepo, idempotencyRepo } = buildRepos();
    const createMerchant = new CreateMerchant(merchantRepo);
    const uc = new CreatePaymentIntent(merchantRepo, intentRepo, idempotencyRepo);

    const { merchant } = await createMerchant.execute({ name: 'M1', sourceApp: 'aurapos', externalRef: 'r1' });
    const { intent, created } = await uc.execute({
      merchantId: merchant.id,
      externalPayableType: 'order',
      externalPayableId: 'order-abc-001',
      currency: 'IDR',
      amountDue: 150000,
    });

    assert.ok(intent.id.startsWith('pi_'), `intent id should start with pi_, got: ${intent.id}`);
    assert.equal(intent.merchantId, merchant.id);
    assert.equal(intent.amountDue, 150000);
    assert.equal(intent.amountPaid, 0);
    assert.equal(intent.amountRemaining, 150000);
    assert.equal(intent.status, 'requires_payment');
    assert.equal(intent.currency, 'IDR');
    assert.equal(created, true);
  });

  // Scenario 6: CreateGatewayPayment (QRIS default) — returns requires_action, intent unchanged
  test('S06: CreateGatewayPayment QRIS returns requires_action, intent status unchanged', async () => {
    const repos = buildRepos();
    const { merchantRepo, intentRepo, idempotencyRepo } = repos;

    const createMerchant = new CreateMerchant(merchantRepo);
    const createIntent = new CreatePaymentIntent(merchantRepo, intentRepo, idempotencyRepo);
    const uc = buildCreateGatewayPayment(repos);

    const { merchant } = await createMerchant.execute({ name: 'M-QRIS', sourceApp: 'aurapos', externalRef: 'q1' });
    const { intent } = await createIntent.execute({
      merchantId: merchant.id,
      externalPayableType: 'order',
      externalPayableId: 'order-q001',
      currency: 'IDR',
      amountDue: 100000,
    });

    const result = await uc.execute({
      merchantId: merchant.id,
      intentId: intent.id,
      provider: 'fake_gateway',
      method: 'qris',
      amount: 100000,
      metadata: { scenario: 'qris' },
    });

    assert.ok(result.transaction.id.startsWith('tx_'), `tx id should start with tx_`);
    assert.equal(result.transaction.status, 'requires_action');
    assert.ok(result.transaction.providerQrString?.startsWith('FAKE_QR:'), 'Should have QR string');
    assert.equal(result.intent.status, 'requires_payment', 'Intent should still require payment until confirmed');
    assert.equal(result.intent.amountPaid, 0);
    assert.equal(result.idempotentReplay, false);
  });

  // Scenario 7: CreateGatewayPayment (immediate_success) — intent becomes paid immediately
  test('S07: CreateGatewayPayment immediate_success updates intent to paid', async () => {
    const repos = buildRepos();
    const { merchantRepo, intentRepo, idempotencyRepo } = repos;

    const createMerchant = new CreateMerchant(merchantRepo);
    const createIntent = new CreatePaymentIntent(merchantRepo, intentRepo, idempotencyRepo);
    const uc = buildCreateGatewayPayment(repos);

    const { merchant } = await createMerchant.execute({ name: 'M-Imm', sourceApp: 'aurapos', externalRef: 'i1' });
    const { intent } = await createIntent.execute({
      merchantId: merchant.id,
      externalPayableType: 'order',
      externalPayableId: 'order-i001',
      currency: 'IDR',
      amountDue: 50000,
    });

    const result = await uc.execute({
      merchantId: merchant.id,
      intentId: intent.id,
      provider: 'fake_gateway',
      method: 'transfer',
      amount: 50000,
      metadata: { scenario: 'immediate_success' },
    });

    assert.equal(result.transaction.status, 'succeeded');
    assert.equal(result.intent.status, 'paid');
    assert.equal(result.intent.amountPaid, 50000);
    assert.equal(result.intent.amountRemaining, 0);
  });

  // Scenario 8: CreateGatewayPayment — overpayment is rejected
  test('S08: CreateGatewayPayment rejects overpayment', async () => {
    const repos = buildRepos();
    const { merchantRepo, intentRepo, idempotencyRepo } = repos;

    const createMerchant = new CreateMerchant(merchantRepo);
    const createIntent = new CreatePaymentIntent(merchantRepo, intentRepo, idempotencyRepo);
    const uc = buildCreateGatewayPayment(repos);

    const { merchant } = await createMerchant.execute({ name: 'M-Over', sourceApp: 'aurapos', externalRef: 'ov1' });
    const { intent } = await createIntent.execute({
      merchantId: merchant.id,
      externalPayableType: 'order',
      externalPayableId: 'order-ov001',
      currency: 'IDR',
      amountDue: 50000,
    });

    await assert.rejects(
      () => uc.execute({
        merchantId: merchant.id,
        intentId: intent.id,
        provider: 'fake_gateway',
        method: 'transfer',
        amount: 99999,
        metadata: { scenario: 'immediate_success' },
      }),
      (err: { code?: string }) => {
        assert.equal(err.code, 'OVERPAYMENT_REJECTED');
        return true;
      },
    );
  });

  // Scenario 9: ConfirmFakeGatewayPayment — confirms requires_action transaction
  test('S09: ConfirmFakeGatewayPayment confirms QRIS transaction, intent becomes paid', async () => {
    const repos = buildRepos();
    const { merchantRepo, intentRepo, transactionRepo, idempotencyRepo } = repos;

    const createMerchant = new CreateMerchant(merchantRepo);
    const createIntent = new CreatePaymentIntent(merchantRepo, intentRepo, idempotencyRepo);
    const createPayment = buildCreateGatewayPayment(repos);
    const confirmUc = new ConfirmFakeGatewayPayment(transactionRepo, intentRepo, 'development');

    const { merchant } = await createMerchant.execute({ name: 'M-Confirm', sourceApp: 'aurapos', externalRef: 'c1' });
    const { intent } = await createIntent.execute({
      merchantId: merchant.id,
      externalPayableType: 'order',
      externalPayableId: 'order-c001',
      currency: 'IDR',
      amountDue: 75000,
    });

    const { transaction } = await createPayment.execute({
      merchantId: merchant.id,
      intentId: intent.id,
      provider: 'fake_gateway',
      method: 'qris',
      amount: 75000,
      metadata: { scenario: 'qris' },
    });

    assert.equal(transaction.status, 'requires_action');

    const confirmed = await confirmUc.execute({
      merchantId: merchant.id,
      transactionId: transaction.id,
    });

    assert.equal(confirmed.transaction.status, 'succeeded');
    assert.equal(confirmed.intent.status, 'paid');
    assert.equal(confirmed.intent.amountPaid, 75000);
    assert.equal(confirmed.intent.amountRemaining, 0);
    assert.equal(confirmed.alreadyConfirmed, false);
  });

  // Scenario 10: ConfirmFakeGatewayPayment — idempotent on already-confirmed transaction
  test('S10: ConfirmFakeGatewayPayment is idempotent on already-succeeded transaction', async () => {
    const repos = buildRepos();
    const { merchantRepo, intentRepo, transactionRepo, idempotencyRepo } = repos;

    const createMerchant = new CreateMerchant(merchantRepo);
    const createIntent = new CreatePaymentIntent(merchantRepo, intentRepo, idempotencyRepo);
    const createPayment = buildCreateGatewayPayment(repos);
    const confirmUc = new ConfirmFakeGatewayPayment(transactionRepo, intentRepo, 'development');

    const { merchant } = await createMerchant.execute({ name: 'M-Idem', sourceApp: 'aurapos', externalRef: 'idem1' });
    const { intent } = await createIntent.execute({
      merchantId: merchant.id,
      externalPayableType: 'order',
      externalPayableId: 'order-idem001',
      currency: 'IDR',
      amountDue: 30000,
    });

    const { transaction } = await createPayment.execute({
      merchantId: merchant.id,
      intentId: intent.id,
      provider: 'fake_gateway',
      method: 'qris',
      amount: 30000,
      metadata: { scenario: 'qris' },
    });

    await confirmUc.execute({ merchantId: merchant.id, transactionId: transaction.id });
    const second = await confirmUc.execute({ merchantId: merchant.id, transactionId: transaction.id });

    assert.equal(second.alreadyConfirmed, true);
    assert.equal(second.transaction.status, 'succeeded');
  });

  // Scenario 11: GetPaymentIntentStatus — returns correct read model
  test('S11: GetPaymentIntentStatus returns correct read model after payment', async () => {
    const repos = buildRepos();
    const { merchantRepo, intentRepo, transactionRepo, idempotencyRepo } = repos;

    const createMerchant = new CreateMerchant(merchantRepo);
    const createIntent = new CreatePaymentIntent(merchantRepo, intentRepo, idempotencyRepo);
    const createPayment = buildCreateGatewayPayment(repos);
    const confirmUc = new ConfirmFakeGatewayPayment(transactionRepo, intentRepo, 'development');
    const statusUc = new GetPaymentIntentStatus(intentRepo, transactionRepo);

    const { merchant } = await createMerchant.execute({ name: 'M-Status', sourceApp: 'aurapos', externalRef: 's1' });
    const { intent } = await createIntent.execute({
      merchantId: merchant.id,
      externalPayableType: 'order',
      externalPayableId: 'order-s001',
      currency: 'IDR',
      amountDue: 60000,
    });

    const { transaction } = await createPayment.execute({
      merchantId: merchant.id,
      intentId: intent.id,
      provider: 'fake_gateway',
      method: 'qris',
      amount: 60000,
      metadata: { scenario: 'qris' },
    });

    // Before confirm
    const beforeConfirm = await statusUc.execute({ intentId: intent.id, merchantId: merchant.id });
    assert.equal(beforeConfirm.intent.status, 'requires_payment');
    assert.equal(beforeConfirm.requiresAction, true);
    assert.equal(beforeConfirm.canRetryPayment, false);
    assert.equal(beforeConfirm.isTerminal, false);

    // After confirm
    await confirmUc.execute({ merchantId: merchant.id, transactionId: transaction.id });
    const afterConfirm = await statusUc.execute({ intentId: intent.id, merchantId: merchant.id });

    assert.equal(afterConfirm.intent.status, 'paid');
    assert.equal(afterConfirm.isTerminal, true);
    assert.equal(afterConfirm.requiresAction, false);
    assert.equal(afterConfirm.canRetryPayment, false);
    assert.notEqual(afterConfirm.latestTransaction, null);
    assert.equal(afterConfirm.latestTransaction?.status, 'succeeded');
  });

  // Scenario 12: GetRefundability — returns correct refundable amount
  test('S12: GetRefundability returns correct refundable amount after payment', async () => {
    const repos = buildRepos();
    const { merchantRepo, intentRepo, transactionRepo, idempotencyRepo } = repos;

    const createMerchant = new CreateMerchant(merchantRepo);
    const createIntent = new CreatePaymentIntent(merchantRepo, intentRepo, idempotencyRepo);
    const createPayment = buildCreateGatewayPayment(repos);
    const confirmUc = new ConfirmFakeGatewayPayment(transactionRepo, intentRepo, 'development');
    const refundabilityUc = new GetRefundability(intentRepo, transactionRepo);

    const { merchant } = await createMerchant.execute({ name: 'M-Refund', sourceApp: 'aurapos', externalRef: 'ref1' });
    const { intent } = await createIntent.execute({
      merchantId: merchant.id,
      externalPayableType: 'order',
      externalPayableId: 'order-ref001',
      currency: 'IDR',
      amountDue: 80000,
    });

    const { transaction } = await createPayment.execute({
      merchantId: merchant.id,
      intentId: intent.id,
      provider: 'fake_gateway',
      method: 'qris',
      amount: 80000,
      metadata: { scenario: 'qris' },
    });

    // Before confirm: no succeeded txn → totalRefundable = 0
    const beforeRefund = await refundabilityUc.execute({ intentId: intent.id, merchantId: merchant.id });
    assert.equal(beforeRefund.totalRefundable, 0);
    assert.equal(beforeRefund.transactions.length, 0);

    // After confirm
    await confirmUc.execute({ merchantId: merchant.id, transactionId: transaction.id });
    const afterRefund = await refundabilityUc.execute({ intentId: intent.id, merchantId: merchant.id });

    assert.equal(afterRefund.totalRefundable, 80000);
    assert.equal(afterRefund.currency, 'IDR');
    assert.equal(afterRefund.transactions.length, 1);
    assert.equal(afterRefund.transactions[0]?.amountRefundable, 80000);
    assert.equal(afterRefund.transactions[0]?.amountAlreadyRefunded, 0);
  });

  // Scenario 13: ConfirmFakeGatewayPayment — blocked in production
  test('S13: ConfirmFakeGatewayPayment throws FORBIDDEN_IN_PRODUCTION in production env', async () => {
    const { transactionRepo, intentRepo } = buildRepos();
    const confirmUc = new ConfirmFakeGatewayPayment(transactionRepo, intentRepo, 'production');

    await assert.rejects(
      () => confirmUc.execute({ merchantId: 'any', transactionId: 'any' }),
      (err: { code?: string }) => {
        assert.equal(err.code, 'FORBIDDEN_IN_PRODUCTION');
        return true;
      },
    );
  });

  // Scenario 14: FakeGateway immediate_failure — transaction fails, intent stays requires_payment
  test('S14: FakeGateway immediate_failure keeps intent in requires_payment', async () => {
    const repos = buildRepos();
    const { merchantRepo, intentRepo, idempotencyRepo } = repos;

    const createMerchant = new CreateMerchant(merchantRepo);
    const createIntent = new CreatePaymentIntent(merchantRepo, intentRepo, idempotencyRepo);
    const uc = buildCreateGatewayPayment(repos);

    const { merchant } = await createMerchant.execute({ name: 'M-Fail', sourceApp: 'aurapos', externalRef: 'f1' });
    const { intent } = await createIntent.execute({
      merchantId: merchant.id,
      externalPayableType: 'order',
      externalPayableId: 'order-f001',
      currency: 'IDR',
      amountDue: 40000,
    });

    const result = await uc.execute({
      merchantId: merchant.id,
      intentId: intent.id,
      provider: 'fake_gateway',
      method: 'transfer',
      amount: 40000,
      metadata: { scenario: 'immediate_failure' },
    });

    assert.equal(result.transaction.status, 'failed');
    assert.equal(result.intent.status, 'requires_payment');
    assert.equal(result.intent.amountPaid, 0);
    assert.equal(result.intent.amountRemaining, 40000);
  });

  // ── Phase 8D Hardening: new scenarios ────────────────────────────────────────

  // Scenario 15: CreateGatewayPayment — idempotency replay
  test('S15: CreateGatewayPayment idempotency replay returns same transaction without calling provider again', async () => {
    const repos = buildRepos();
    const { merchantRepo, intentRepo, idempotencyRepo } = repos;

    const createMerchant = new CreateMerchant(merchantRepo);
    const createIntent = new CreatePaymentIntent(merchantRepo, intentRepo, idempotencyRepo);
    const uc = buildCreateGatewayPayment(repos);

    const { merchant } = await createMerchant.execute({ name: 'M-Idem2', sourceApp: 'aurapos', externalRef: 'idem2' });
    const { intent } = await createIntent.execute({
      merchantId: merchant.id,
      externalPayableType: 'order',
      externalPayableId: 'order-idem2-001',
      currency: 'IDR',
      amountDue: 120000,
    });

    const idemKey = 'idem-key-s15-001';
    const first = await uc.execute({
      merchantId: merchant.id,
      intentId: intent.id,
      provider: 'fake_gateway',
      method: 'qris',
      amount: 120000,
      idempotencyKey: idemKey,
      metadata: { scenario: 'qris' },
    });

    assert.equal(first.idempotentReplay, false);
    assert.equal(first.transaction.status, 'requires_action');

    // Second call with same idempotency key and same params → replay
    const second = await uc.execute({
      merchantId: merchant.id,
      intentId: intent.id,
      provider: 'fake_gateway',
      method: 'qris',
      amount: 120000,
      idempotencyKey: idemKey,
      metadata: { scenario: 'qris' },
    });

    assert.equal(second.idempotentReplay, true);
    assert.equal(second.transaction.id, first.transaction.id, 'Replay must return the same transaction ID');
    assert.equal(second.transaction.status, 'requires_action');
  });

  // Scenario 16: CreateGatewayPayment — idempotency conflict
  test('S16: CreateGatewayPayment idempotency conflict rejects mismatched request', async () => {
    const repos = buildRepos();
    const { merchantRepo, intentRepo, idempotencyRepo } = repos;

    const createMerchant = new CreateMerchant(merchantRepo);
    const createIntent = new CreatePaymentIntent(merchantRepo, intentRepo, idempotencyRepo);
    const uc = buildCreateGatewayPayment(repos);

    const { merchant } = await createMerchant.execute({ name: 'M-Conflict', sourceApp: 'aurapos', externalRef: 'cfl1' });
    const { intent } = await createIntent.execute({
      merchantId: merchant.id,
      externalPayableType: 'order',
      externalPayableId: 'order-cfl-001',
      currency: 'IDR',
      amountDue: 200000,
    });

    const idemKey = 'idem-key-s16-001';
    await uc.execute({
      merchantId: merchant.id,
      intentId: intent.id,
      provider: 'fake_gateway',
      method: 'qris',
      amount: 100000,
      idempotencyKey: idemKey,
      metadata: { scenario: 'qris' },
    });

    // Second call with DIFFERENT amount but same idempotency key → conflict
    await assert.rejects(
      () => uc.execute({
        merchantId: merchant.id,
        intentId: intent.id,
        provider: 'fake_gateway',
        method: 'qris',
        amount: 150000, // different!
        idempotencyKey: idemKey,
        metadata: { scenario: 'qris' },
      }),
      (err: { code?: string }) => {
        assert.equal(err.code, 'IDEMPOTENCY_CONFLICT');
        return true;
      },
    );
  });

  // Scenario 17: CreateGatewayPayment — provider account validation
  test('S17: CreateGatewayPayment rejects invalid providerAccountId', async () => {
    const repos = buildRepos();
    const { merchantRepo, intentRepo, idempotencyRepo } = repos;

    const createMerchant = new CreateMerchant(merchantRepo);
    const createIntent = new CreatePaymentIntent(merchantRepo, intentRepo, idempotencyRepo);
    const uc = buildCreateGatewayPayment(repos);

    const { merchant } = await createMerchant.execute({ name: 'M-PA', sourceApp: 'aurapos', externalRef: 'pa1' });
    const { intent } = await createIntent.execute({
      merchantId: merchant.id,
      externalPayableType: 'order',
      externalPayableId: 'order-pa-001',
      currency: 'IDR',
      amountDue: 55000,
    });

    // Non-existent providerAccountId → PROVIDER_ACCOUNT_NOT_FOUND
    await assert.rejects(
      () => uc.execute({
        merchantId: merchant.id,
        intentId: intent.id,
        provider: 'fake_gateway',
        method: 'qris',
        amount: 55000,
        providerAccountId: 'pa_does_not_exist',
      }),
      (err: { code?: string }) => {
        assert.equal(err.code, 'PROVIDER_ACCOUNT_NOT_FOUND');
        return true;
      },
    );
  });

  // Scenario 17b: CreateGatewayPayment — provider account provider mismatch
  test('S17b: CreateGatewayPayment rejects providerAccountId with wrong provider', async () => {
    const repos = buildRepos();
    const { merchantRepo, providerAccountRepo, intentRepo, idempotencyRepo } = repos;

    const createMerchant = new CreateMerchant(merchantRepo);
    const createPa = new CreateProviderAccount(merchantRepo, providerAccountRepo);
    const createIntent = new CreatePaymentIntent(merchantRepo, intentRepo, idempotencyRepo);
    const uc = buildCreateGatewayPayment(repos);

    const { merchant } = await createMerchant.execute({ name: 'M-PA2', sourceApp: 'aurapos', externalRef: 'pa2' });
    const { providerAccount } = await createPa.execute({
      merchantId: merchant.id,
      provider: 'xendit',      // different provider
      environment: 'sandbox',
    });

    const { intent } = await createIntent.execute({
      merchantId: merchant.id,
      externalPayableType: 'order',
      externalPayableId: 'order-pa2-001',
      currency: 'IDR',
      amountDue: 55000,
    });

    // PA belongs to 'xendit' but request says 'fake_gateway' → PROVIDER_ACCOUNT_PROVIDER_MISMATCH
    await assert.rejects(
      () => uc.execute({
        merchantId: merchant.id,
        intentId: intent.id,
        provider: 'fake_gateway',
        method: 'qris',
        amount: 55000,
        providerAccountId: providerAccount.id,
      }),
      (err: { code?: string }) => {
        assert.equal(err.code, 'PROVIDER_ACCOUNT_PROVIDER_MISMATCH');
        return true;
      },
    );
  });

  // Scenario 18: ConfirmFakeGatewayPayment — overpayment guard at confirmation time
  test('S18: ConfirmFakeGatewayPayment rejects confirm that would cause overpayment', async () => {
    const repos = buildRepos();
    const { merchantRepo, intentRepo, transactionRepo, idempotencyRepo } = repos;

    const createMerchant = new CreateMerchant(merchantRepo);
    const createIntent = new CreatePaymentIntent(merchantRepo, intentRepo, idempotencyRepo);
    const createPayment = buildCreateGatewayPayment(repos);
    const confirmUc = new ConfirmFakeGatewayPayment(transactionRepo, intentRepo, 'development');

    const { merchant } = await createMerchant.execute({ name: 'M-ConfirmOver', sourceApp: 'aurapos', externalRef: 'cov1' });
    const { intent } = await createIntent.execute({
      merchantId: merchant.id,
      externalPayableType: 'order',
      externalPayableId: 'order-cov-001',
      currency: 'IDR',
      amountDue: 100000,
    });

    // Create two pending transactions, each for 100000 (only one should succeed)
    const { transaction: tx1 } = await createPayment.execute({
      merchantId: merchant.id,
      intentId: intent.id,
      provider: 'fake_gateway',
      method: 'qris',
      amount: 100000,
      metadata: { scenario: 'qris' },
    });
    const { transaction: tx2 } = await createPayment.execute({
      merchantId: merchant.id,
      intentId: intent.id,
      provider: 'fake_gateway',
      method: 'qris',
      amount: 100000,
      metadata: { scenario: 'qris' },
    });

    assert.equal(tx1.status, 'requires_action');
    assert.equal(tx2.status, 'requires_action');

    // Confirm tx1 — succeeds, intent becomes paid, amountRemaining = 0
    const result1 = await confirmUc.execute({ merchantId: merchant.id, transactionId: tx1.id });
    assert.equal(result1.intent.status, 'paid');
    assert.equal(result1.intent.amountRemaining, 0);

    // Confirm tx2 — rejected because amountRemaining is now 0 → OVERPAYMENT_REJECTED
    await assert.rejects(
      () => confirmUc.execute({ merchantId: merchant.id, transactionId: tx2.id }),
      (err: { code?: string }) => {
        assert.equal(err.code, 'OVERPAYMENT_REJECTED');
        return true;
      },
    );
  });

  // Scenario 19: ConfirmFakeGatewayPayment — reject invalid transaction status
  test('S19: ConfirmFakeGatewayPayment rejects confirm of a failed transaction', async () => {
    const repos = buildRepos();
    const { merchantRepo, intentRepo, transactionRepo, idempotencyRepo } = repos;

    const createMerchant = new CreateMerchant(merchantRepo);
    const createIntent = new CreatePaymentIntent(merchantRepo, intentRepo, idempotencyRepo);
    const createPayment = buildCreateGatewayPayment(repos);
    const confirmUc = new ConfirmFakeGatewayPayment(transactionRepo, intentRepo, 'development');

    const { merchant } = await createMerchant.execute({ name: 'M-ConfirmFail', sourceApp: 'aurapos', externalRef: 'cfail1' });
    const { intent } = await createIntent.execute({
      merchantId: merchant.id,
      externalPayableType: 'order',
      externalPayableId: 'order-cfail-001',
      currency: 'IDR',
      amountDue: 60000,
    });

    // Create a failed transaction (immediate_failure scenario)
    const { transaction } = await createPayment.execute({
      merchantId: merchant.id,
      intentId: intent.id,
      provider: 'fake_gateway',
      method: 'transfer',
      amount: 60000,
      metadata: { scenario: 'immediate_failure' },
    });

    assert.equal(transaction.status, 'failed');

    // Attempting to confirm a failed transaction → INVALID_TRANSACTION_STATUS
    await assert.rejects(
      () => confirmUc.execute({ merchantId: merchant.id, transactionId: transaction.id }),
      (err: { code?: string }) => {
        assert.equal(err.code, 'INVALID_TRANSACTION_STATUS');
        return true;
      },
    );
  });

});
