/**
 * payment-orchestration-standalone-webhook.test.ts
 *
 * Phase 8E — Standalone webhook ingestion tests.
 *
 * Validates:
 *   WH01: Valid 'payment.succeeded' webhook → transaction succeeded, intent paid
 *   WH02: Valid 'payment.failed' webhook → transaction failed, intent unchanged
 *   WH03: Valid 'payment.cancelled' webhook → transaction cancelled
 *   WH04: Valid 'payment.expired' webhook → transaction expired
 *   WH05: Idempotent replay — same event_id → returns idempotentReplay=true, no double-credit
 *   WH06: Unknown providerReference → event marked failed, transaction null
 *   WH07: Unsupported provider → throws WEBHOOK_PROVIDER_NOT_SUPPORTED (400)
 *   WH08: Invalid payload (missing event_id) → throws INVALID_WEBHOOK_PAYLOAD (400)
 *   WH09: HMAC signature verification — valid signature accepted
 *   WH10: HMAC signature verification — invalid signature rejected (401)
 *   WH11: FakeGatewayWebhookHandler — production mode rejects unsigned webhook (403)
 *   WH12: Transaction already succeeded → processingStatus='processed', no re-credit
 *
 * Run:
 *   npx tsx --tsconfig apps/api/tsconfig.node.json --test \
 *     apps/api/src/__tests__/payment-orchestration-standalone-webhook.test.ts
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { createHmac } from 'crypto';

import type {
  PaymentMerchantRepository,
  PaymentProviderAccountRepository,
  PaymentIntentRepository,
  PaymentTransactionRepository,
  PaymentIdempotencyRepository,
  PaymentProviderEventRepository,
  PaymentMerchant,
  PaymentProviderAccount,
  StandalonePaymentIntentDTO,
  StandalonePaymentTransactionDTO,
  PaymentIdempotencyKeyDTO,
  PaymentProviderEventDTO,
  ReserveProviderEventInput,
} from '@northflow/payment-orchestration-core';

import { HandleProviderWebhook } from '../apps/service/src/application/use-cases/HandleProviderWebhook.ts';
import { CreateGatewayPayment } from '../apps/service/src/application/use-cases/CreateGatewayPayment.ts';
import { CreateMerchant } from '../apps/service/src/application/use-cases/CreateMerchant.ts';
import { StandaloneFakeGatewayProvider } from '../apps/service/src/infrastructure/providers/StandaloneFakeGatewayProvider.ts';
import { FakeGatewayWebhookHandler } from '../apps/service/src/infrastructure/providers/FakeGatewayWebhookHandler.ts';

// ── In-memory implementations ─────────────────────────────────────────────────

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
  readonly store = new Map<string, StandalonePaymentIntentDTO>();
  async findById(id: string, merchantId: string): Promise<StandalonePaymentIntentDTO | null> {
    const i = this.store.get(id);
    return (!i || i.merchantId !== merchantId) ? null : i;
  }
  async findByExternalPayable(input: { merchantId: string; externalPayableType: string; externalPayableId: string }): Promise<StandalonePaymentIntentDTO | null> {
    for (const i of this.store.values()) {
      if (i.merchantId === input.merchantId && i.externalPayableType === input.externalPayableType && i.externalPayableId === input.externalPayableId) return i;
    }
    return null;
  }
  async create(input: { id: string; merchantId: string; providerAccountId?: string | null; sourceApp?: string | null; externalTenantId?: string | null; externalOutletId?: string | null; externalLocationId?: string | null; externalPayableType: string; externalPayableId: string; currency?: string; amountDue: number; allowPartial?: boolean; expiresAt?: Date | null; metadata?: Record<string, unknown> | null }): Promise<StandalonePaymentIntentDTO> {
    const now = new Date();
    const intent: StandalonePaymentIntentDTO = { id: input.id, merchantId: input.merchantId, providerAccountId: input.providerAccountId ?? null, sourceApp: input.sourceApp ?? null, externalTenantId: input.externalTenantId ?? null, externalOutletId: input.externalOutletId ?? null, externalLocationId: input.externalLocationId ?? null, externalPayableType: input.externalPayableType, externalPayableId: input.externalPayableId, amountDue: input.amountDue, amountPaid: 0, amountRefunded: 0, amountRemaining: input.amountDue, currency: input.currency ?? 'IDR', status: 'requires_payment', allowPartial: input.allowPartial ?? false, expiresAt: null, metadata: input.metadata ?? {}, createdAt: now, updatedAt: now };
    this.store.set(intent.id, intent);
    return intent;
  }
  async updateTotals(input: { id: string; merchantId: string; amountPaid: number; amountRefunded: number; amountRemaining: number }): Promise<StandalonePaymentIntentDTO> {
    const i = this.store.get(input.id);
    if (!i || i.merchantId !== input.merchantId) throw new Error(`Intent not found: ${input.id}`);
    const updated = { ...i, amountPaid: input.amountPaid, amountRefunded: input.amountRefunded, amountRemaining: input.amountRemaining, updatedAt: new Date() };
    this.store.set(input.id, updated);
    return updated;
  }
  async updateStatus(input: { id: string; merchantId: string; status: string }): Promise<StandalonePaymentIntentDTO> {
    const i = this.store.get(input.id);
    if (!i || i.merchantId !== input.merchantId) throw new Error(`Intent not found: ${input.id}`);
    const updated = { ...i, status: input.status as IntentStatus, updatedAt: new Date() };
    this.store.set(input.id, updated);
    return updated;
  }
  get(id: string): StandalonePaymentIntentDTO | undefined { return this.store.get(id); }
}

class InMemoryTransactionRepo implements PaymentTransactionRepository {
  readonly store = new Map<string, StandalonePaymentTransactionDTO>();
  async findById(id: string, merchantId: string): Promise<StandalonePaymentTransactionDTO | null> {
    const tx = this.store.get(id);
    return (!tx || tx.merchantId !== merchantId) ? null : tx;
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
  async create(input: { id: string; merchantId: string; intentId: string; providerAccountId?: string | null; provider: string; method: string; transactionType: string; direction: string; status: string; amount: number; currency?: string; parentTransactionId?: string | null; providerReference?: string | null; providerEventId?: string | null; providerPaymentUrl?: string | null; providerQrString?: string | null; failureReason?: string | null; idempotencyKey?: string | null; metadata?: Record<string, unknown> | null; rawProviderResponse?: Record<string, unknown> | null }): Promise<StandalonePaymentTransactionDTO> {
    const now = new Date();
    const tx: StandalonePaymentTransactionDTO = { id: input.id, merchantId: input.merchantId, intentId: input.intentId, providerAccountId: input.providerAccountId ?? null, provider: input.provider, method: input.method, transactionType: input.transactionType, direction: input.direction as 'incoming' | 'outgoing', status: input.status as TxStatus, amount: input.amount, currency: input.currency ?? 'IDR', parentTransactionId: input.parentTransactionId ?? null, providerReference: input.providerReference ?? null, providerEventId: input.providerEventId ?? null, providerPaymentUrl: input.providerPaymentUrl ?? null, providerQrString: input.providerQrString ?? null, failureReason: input.failureReason ?? null, idempotencyKey: input.idempotencyKey ?? null, expiresAt: null, metadata: input.metadata ?? {}, rawProviderResponse: input.rawProviderResponse ?? null, createdAt: now, updatedAt: now };
    this.store.set(tx.id, tx);
    return tx;
  }
  async updateStatus(input: { id: string; merchantId: string; status: string; failureReason?: string | null; providerReference?: string | null; providerEventId?: string | null }): Promise<StandalonePaymentTransactionDTO> {
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
  async markSucceededIfConfirmable(input: { id: string; merchantId: string }): Promise<{ transaction: StandalonePaymentTransactionDTO | null; changed: boolean }> {
    const tx = this.store.get(input.id);
    if (!tx || tx.merchantId !== input.merchantId) return { transaction: null, changed: false };
    if (tx.status !== 'requires_action' && tx.status !== 'pending') return { transaction: null, changed: false };
    const updated: StandalonePaymentTransactionDTO = { ...tx, status: 'succeeded' as TxStatus, updatedAt: new Date() };
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
}

type EventStatus = 'pending' | 'processed' | 'failed';

class InMemoryProviderEventRepo implements PaymentProviderEventRepository {
  readonly store = new Map<string, PaymentProviderEventDTO>();

  async reserveEvent(input: ReserveProviderEventInput): Promise<PaymentProviderEventDTO> {
    const now = new Date();
    const ev: PaymentProviderEventDTO = { id: input.id, merchantId: null, provider: input.provider, providerEventId: input.providerEventId, providerReference: input.providerReference ?? null, eventType: input.eventType, processingStatus: 'pending', processingAttempts: 0, lastError: null, rawHeaders: input.rawHeaders ?? {}, rawBody: input.rawBody ?? null, parsedPayload: null, receivedAt: now, processedAt: null, createdAt: now, updatedAt: now };
    this.store.set(ev.id, ev);
    return ev;
  }

  async findByProviderEventId(provider: string, providerEventId: string): Promise<PaymentProviderEventDTO | null> {
    for (const ev of this.store.values()) {
      if (ev.provider === provider && ev.providerEventId === providerEventId) return ev;
    }
    return null;
  }

  async assignMerchant(eventId: string, merchantId: string): Promise<void> {
    const ev = this.store.get(eventId);
    if (ev) this.store.set(eventId, { ...ev, merchantId, updatedAt: new Date() });
  }

  async markProcessed(eventId: string): Promise<void> {
    const ev = this.store.get(eventId);
    if (ev) this.store.set(eventId, { ...ev, processingStatus: 'processed', processedAt: new Date(), updatedAt: new Date() });
  }

  async markFailed(eventId: string, error: string): Promise<void> {
    const ev = this.store.get(eventId);
    if (ev) this.store.set(eventId, { ...ev, processingStatus: 'failed', lastError: error, processingAttempts: (ev.processingAttempts ?? 0) + 1, updatedAt: new Date() });
  }

  async findStalePending(): Promise<PaymentProviderEventDTO[]> { return []; }
}

// ── Shared test factory ───────────────────────────────────────────────────────

function makeRepos() {
  return {
    merchantRepo: new InMemoryMerchantRepo(),
    providerAccountRepo: new InMemoryProviderAccountRepo(),
    intentRepo: new InMemoryIntentRepo(),
    transactionRepo: new InMemoryTransactionRepo(),
    idempotencyRepo: new InMemoryIdempotencyRepo(),
    providerEventRepo: new InMemoryProviderEventRepo(),
  };
}

async function setupWorld(repos: ReturnType<typeof makeRepos>, amountDue = 50000) {
  const merchantId = `m-${randomUUID()}`;
  const fakeGateway = new StandaloneFakeGatewayProvider();
  const providerRegistry = new Map([[fakeGateway.providerCode, fakeGateway]]);
  const webhookHandler = new FakeGatewayWebhookHandler({ nodeEnv: 'development' });
  const handleWebhook = new HandleProviderWebhook(repos.transactionRepo, repos.intentRepo, repos.providerEventRepo, webhookHandler);
  const createGateway = new CreateGatewayPayment(repos.merchantRepo, repos.intentRepo, repos.transactionRepo, providerRegistry, repos.providerAccountRepo, repos.idempotencyRepo, 'development');
  const createMerchant = new CreateMerchant(repos.merchantRepo);

  await createMerchant.execute({ id: merchantId, name: 'WH Merchant' });
  await repos.providerAccountRepo.create({ id: `pa-${randomUUID()}`, merchantId, provider: 'fake_gateway', environment: 'sandbox' });

  const intentId = `pi-${randomUUID()}`;
  await repos.intentRepo.create({ id: intentId, merchantId, externalPayableType: 'order', externalPayableId: `ord-${randomUUID()}`, amountDue });

  const { transaction: tx } = await createGateway.execute({
    merchantId, intentId, provider: 'fake_gateway', method: 'qris', amount: amountDue,
  });

  return { merchantId, intentId, tx, handleWebhook, webhookHandler };
}

function makeWebhookPayload(overrides: Record<string, unknown> = {}) {
  return {
    event_id: `evt_${randomUUID()}`,
    event_type: 'payment.succeeded',
    status: 'succeeded',
    ...overrides,
  };
}

// ── WH01: payment.succeeded ───────────────────────────────────────────────────

describe('WH01 — payment.succeeded webhook → transaction succeeded, intent paid', () => {
  test('processes succeeded event correctly', async () => {
    const repos = makeRepos();
    const { intentId, tx, handleWebhook } = await setupWorld(repos, 40000);

    const payload = makeWebhookPayload({
      provider_reference: tx.providerReference,
      status: 'succeeded',
      event_type: 'payment.succeeded',
    });

    const result = await handleWebhook.execute({
      provider: 'fake_gateway',
      headers: { 'content-type': 'application/json' },
      rawBody: payload,
    });

    assert.equal(result.processingStatus, 'processed');
    assert.equal(result.transaction?.status, 'succeeded');
    assert.equal(result.intent?.status, 'paid');
    assert.equal(result.intent?.amountPaid, 40000);
    assert.equal(result.idempotentReplay, false);

    // Verify stored intent.
    const storedIntent = repos.intentRepo.get(intentId);
    assert.equal(storedIntent?.amountPaid, 40000);
    assert.equal(storedIntent?.status, 'paid');
  });
});

// ── WH02: payment.failed ─────────────────────────────────────────────────────

describe('WH02 — payment.failed webhook → transaction failed, intent unchanged', () => {
  test('marks transaction failed without crediting intent', async () => {
    const repos = makeRepos();
    const { tx, handleWebhook } = await setupWorld(repos, 30000);

    const payload = makeWebhookPayload({
      provider_reference: tx.providerReference,
      status: 'failed',
      event_type: 'payment.failed',
    });

    const result = await handleWebhook.execute({
      provider: 'fake_gateway',
      headers: {},
      rawBody: payload,
    });

    assert.equal(result.processingStatus, 'processed');
    assert.equal(result.transaction?.status, 'failed');
    // amountPaid must remain 0.
    assert.equal(result.intent?.amountPaid, 0);
  });
});

// ── WH03: payment.cancelled ──────────────────────────────────────────────────

describe('WH03 — payment.cancelled webhook → transaction cancelled', () => {
  test('marks transaction cancelled', async () => {
    const repos = makeRepos();
    const { tx, handleWebhook } = await setupWorld(repos, 25000);

    const result = await handleWebhook.execute({
      provider: 'fake_gateway',
      headers: {},
      rawBody: makeWebhookPayload({ provider_reference: tx.providerReference, status: 'cancelled', event_type: 'payment.cancelled' }),
    });

    assert.equal(result.processingStatus, 'processed');
    assert.equal(result.transaction?.status, 'cancelled');
  });
});

// ── WH04: payment.expired ────────────────────────────────────────────────────

describe('WH04 — payment.expired webhook → transaction expired', () => {
  test('marks transaction expired', async () => {
    const repos = makeRepos();
    const { tx, handleWebhook } = await setupWorld(repos, 15000);

    const result = await handleWebhook.execute({
      provider: 'fake_gateway',
      headers: {},
      rawBody: makeWebhookPayload({ provider_reference: tx.providerReference, status: 'expired', event_type: 'payment.expired' }),
    });

    assert.equal(result.processingStatus, 'processed');
    assert.equal(result.transaction?.status, 'expired');
  });
});

// ── WH05: Idempotent replay ──────────────────────────────────────────────────

describe('WH05 — Idempotent replay — same event_id → no double-credit', () => {
  test('second identical webhook returns idempotentReplay=true, intent not re-credited', async () => {
    const repos = makeRepos();
    const { intentId, tx, handleWebhook } = await setupWorld(repos, 20000);

    const eventId = `evt_${randomUUID()}`;
    const payload = makeWebhookPayload({ event_id: eventId, provider_reference: tx.providerReference, status: 'succeeded' });

    const first = await handleWebhook.execute({ provider: 'fake_gateway', headers: {}, rawBody: payload });
    assert.equal(first.processingStatus, 'processed');
    assert.equal(first.idempotentReplay, false);

    // Same event_id — must not double-credit.
    const second = await handleWebhook.execute({ provider: 'fake_gateway', headers: {}, rawBody: payload });
    assert.equal(second.idempotentReplay, true);
    assert.equal(second.processingStatus, 'processed');

    // Intent amountPaid must be 20000, not 40000.
    const storedIntent = repos.intentRepo.get(intentId);
    assert.equal(storedIntent?.amountPaid, 20000);
  });
});

// ── WH06: Unknown providerReference ──────────────────────────────────────────

describe('WH06 — Unknown providerReference → event marked failed, tx null', () => {
  test('marks provider event failed when providerReference has no matching transaction', async () => {
    const repos = makeRepos();
    const { handleWebhook } = await setupWorld(repos, 10000);

    const result = await handleWebhook.execute({
      provider: 'fake_gateway',
      headers: {},
      rawBody: makeWebhookPayload({ provider_reference: 'fake_NONEXISTENT_ref', status: 'succeeded' }),
    });

    assert.equal(result.processingStatus, 'failed');
    assert.equal(result.transaction, null);
    assert.equal(result.intent, null);
  });
});

// ── WH07: Unsupported provider ────────────────────────────────────────────────

describe('WH07 — Unsupported provider → WEBHOOK_PROVIDER_NOT_SUPPORTED (400)', () => {
  test('throws when provider is not fake_gateway', async () => {
    const repos = makeRepos();
    const { handleWebhook } = await setupWorld(repos, 10000);

    await assert.rejects(
      () => handleWebhook.execute({
        provider: 'xendit',
        headers: {},
        rawBody: { event_id: 'evt_x', event_type: 'payment.succeeded', status: 'succeeded' },
      }),
      (err: any) => {
        assert.equal(err.code, 'WEBHOOK_PROVIDER_NOT_SUPPORTED');
        assert.equal(err.statusCode, 400);
        return true;
      },
    );
  });
});

// ── WH08: Invalid payload ─────────────────────────────────────────────────────

describe('WH08 — Invalid payload → INVALID_WEBHOOK_PAYLOAD (400)', () => {
  test('throws when event_id is missing', async () => {
    const repos = makeRepos();
    const { handleWebhook } = await setupWorld(repos, 10000);

    await assert.rejects(
      () => handleWebhook.execute({
        provider: 'fake_gateway',
        headers: {},
        rawBody: { event_type: 'payment.succeeded', status: 'succeeded' }, // no event_id
      }),
      (err: any) => {
        assert.equal(err.code, 'INVALID_WEBHOOK_PAYLOAD');
        assert.equal(err.statusCode, 400);
        return true;
      },
    );
  });

  test('throws when status is unrecognised', async () => {
    const repos = makeRepos();
    const { handleWebhook } = await setupWorld(repos, 10000);

    await assert.rejects(
      () => handleWebhook.execute({
        provider: 'fake_gateway',
        headers: {},
        rawBody: { event_id: 'evt_bad', event_type: 'payment.succeeded', status: 'unknown_status' },
      }),
      (err: any) => {
        assert.equal(err.code, 'INVALID_WEBHOOK_PAYLOAD');
        return true;
      },
    );
  });
});

// ── WH09: Valid HMAC signature ────────────────────────────────────────────────

describe('WH09 — Valid HMAC signature accepted', () => {
  test('webhook with correct HMAC signature processes successfully', async () => {
    const secret = 'test-hmac-secret-for-wh09';
    const repos = makeRepos();
    const { tx } = await setupWorld(repos, 35000);

    const handler = new FakeGatewayWebhookHandler({ webhookSecret: secret, nodeEnv: 'development' });
    const handleWebhook = new HandleProviderWebhook(repos.transactionRepo, repos.intentRepo, repos.providerEventRepo, handler);

    const payload = { event_id: `evt_${randomUUID()}`, event_type: 'payment.succeeded', status: 'succeeded', provider_reference: tx.providerReference };
    const bodyStr = JSON.stringify(payload);
    const bodyBuf = Buffer.from(bodyStr, 'utf8');
    const sig = createHmac('sha256', secret).update(bodyBuf).digest('hex');

    const result = await handleWebhook.execute({
      provider: 'fake_gateway',
      headers: { 'x-fakegateway-signature': sig },
      rawBody: bodyBuf,
    });

    assert.equal(result.processingStatus, 'processed');
    assert.equal(result.transaction?.status, 'succeeded');
  });
});

// ── WH10: Invalid HMAC signature ─────────────────────────────────────────────

describe('WH10 — Invalid HMAC signature rejected (401)', () => {
  test('webhook with wrong HMAC signature throws WEBHOOK_SIGNATURE_INVALID', async () => {
    const secret = 'correct-secret';
    const repos = makeRepos();
    await setupWorld(repos, 10000);

    const handler = new FakeGatewayWebhookHandler({ webhookSecret: secret, nodeEnv: 'development' });
    const handleWebhook = new HandleProviderWebhook(repos.transactionRepo, repos.intentRepo, repos.providerEventRepo, handler);

    const payload = Buffer.from(JSON.stringify({ event_id: 'evt_x', event_type: 'payment.succeeded', status: 'succeeded' }));

    await assert.rejects(
      () => handleWebhook.execute({
        provider: 'fake_gateway',
        headers: { 'x-fakegateway-signature': 'wrong-signature' },
        rawBody: payload,
      }),
      (err: any) => {
        assert.equal(err.code, 'WEBHOOK_SIGNATURE_INVALID');
        assert.equal(err.statusCode, 401);
        return true;
      },
    );
  });
});

// ── WH11: Production mode rejects unsigned webhook ───────────────────────────

describe('WH11 — Production mode rejects unsigned webhooks (403)', () => {
  test('WEBHOOK_SECRET_REQUIRED in production without secret configured', () => {
    const handler = new FakeGatewayWebhookHandler({ webhookSecret: undefined, nodeEnv: 'production' });

    // handler.parse() throws synchronously — use assert.throws (not assert.rejects).
    assert.throws(
      () => handler.parse(
        { 'content-type': 'application/json' },
        { event_id: 'evt_prod', event_type: 'payment.succeeded', status: 'succeeded' },
      ),
      (err: any) => {
        assert.equal(err.code, 'WEBHOOK_SECRET_REQUIRED');
        assert.equal(err.statusCode, 403);
        return true;
      },
    );
  });
});

// ── WH12: Transaction already succeeded → no re-credit ───────────────────────

describe('WH12 — Transaction already succeeded → processingStatus=processed, no re-credit', () => {
  test('webhook for already-succeeded tx does not double-credit intent', async () => {
    const repos = makeRepos();
    const { intentId, tx, handleWebhook } = await setupWorld(repos, 45000);

    // Pre-mark tx as succeeded (simulates a previous confirm).
    await repos.transactionRepo.updateStatus({ id: tx.id, merchantId: tx.merchantId, status: 'succeeded' });
    await repos.intentRepo.updateTotals({ id: intentId, merchantId: tx.merchantId, amountPaid: 45000, amountRefunded: 0, amountRemaining: 0 });
    await repos.intentRepo.updateStatus({ id: intentId, merchantId: tx.merchantId, status: 'paid' });

    const result = await handleWebhook.execute({
      provider: 'fake_gateway',
      headers: {},
      rawBody: makeWebhookPayload({ provider_reference: tx.providerReference, status: 'succeeded' }),
    });

    assert.equal(result.processingStatus, 'processed');

    // Intent must NOT be double-credited.
    const storedIntent = repos.intentRepo.get(intentId);
    assert.equal(storedIntent?.amountPaid, 45000, 'amountPaid must not be double-credited');
    assert.equal(storedIntent?.status, 'paid');
  });
});
