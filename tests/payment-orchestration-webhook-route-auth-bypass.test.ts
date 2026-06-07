/**
 * payment-orchestration-webhook-route-auth-bypass.test.ts
 *
 * Phase 8E Hardening — Task 4: Real Express HTTP tests proving webhook route
 * bypasses service-token auth while other /v1 routes remain protected.
 *
 * Scenarios:
 *   WR01: POST /v1/webhooks/fake_gateway succeeds without service token (dev mode)
 *   WR02: POST /v1/payment-intents without service token → 401 UNAUTHORIZED
 *   WR03: webhook ignores malicious x-payment-merchant-id; merchant from providerReference
 *   WR04: duplicate webhook event_id → idempotentReplay=true, no double amountPaid
 *   WR05: invalid FakeGateway payload → 400 INVALID_WEBHOOK_PAYLOAD
 *   WR06a: secret configured + missing signature → 401 WEBHOOK_SIGNATURE_INVALID
 *   WR06b: secret configured + wrong signature → 401 WEBHOOK_SIGNATURE_INVALID
 *
 * These tests call the actual Express HTTP layer with in-memory repositories.
 * No live DB required.
 *
 * Run:
 *   npx tsx --tsconfig apps/api/tsconfig.node.json --test \
 *     apps/api/src/__tests__/payment-orchestration-webhook-route-auth-bypass.test.ts
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'crypto';

// ── Service imports ───────────────────────────────────────────────────────────

import { createApp } from '../apps/service/src/app.ts';
import type { ServiceContainer } from '../apps/service/src/container.ts';
import type { PaymentOrchestrationServiceConfig } from '../apps/service/src/config/env.ts';
import { CreateMerchant } from '../apps/service/src/application/use-cases/CreateMerchant.ts';
import { CreateProviderAccount } from '../apps/service/src/application/use-cases/CreateProviderAccount.ts';
import { CreatePaymentIntent } from '../apps/service/src/application/use-cases/CreatePaymentIntent.ts';
import { CreateGatewayPayment } from '../apps/service/src/application/use-cases/CreateGatewayPayment.ts';
import { ConfirmFakeGatewayPayment } from '../apps/service/src/application/use-cases/ConfirmFakeGatewayPayment.ts';
import { GetPaymentIntentStatus } from '../apps/service/src/application/use-cases/GetPaymentIntentStatus.ts';
import { GetRefundability } from '../apps/service/src/application/use-cases/GetRefundability.ts';
import { HandleProviderWebhook } from '../apps/service/src/application/use-cases/HandleProviderWebhook.ts';
import { ReconcilePaymentIntentTotals } from '../apps/service/src/application/use-cases/ReconcilePaymentIntentTotals.ts';
import { FakeGatewayWebhookHandler } from '../apps/service/src/infrastructure/providers/FakeGatewayWebhookHandler.ts';
import { FakeGatewayProvider } from '../apps/service/src/infrastructure/providers/FakeGatewayProvider.ts';

// ── Core type imports ─────────────────────────────────────────────────────────

import type {
  PaymentMerchantRepository,
  PaymentProviderAccountRepository,
  PaymentIntentRepository,
  PaymentTransactionRepository,
  PaymentIdempotencyRepository,
  PaymentProviderEventRepository,
  PaymentMerchant,
  PaymentProviderAccount,
  PaymentIntentDTO,
  PaymentTransactionDTO,
  PaymentIdempotencyKeyDTO,
  PaymentProviderEventDTO,
  ReserveProviderEventInput,
  FindStalePendingInput,
  ReserveIdempotencyKeyInput,
  FindIdempotencyKeyInput,
  MarkIdempotencyCompletedInput,
  MarkIdempotencyFailedInput,
} from '@northflow/payment-orchestration-core';

// ── Minimal in-memory repositories ───────────────────────────────────────────

type MerchantStatus = 'active' | 'suspended' | 'closed';

class InMemoryMerchantRepo implements PaymentMerchantRepository {
  private readonly store = new Map<string, PaymentMerchant>();

  async findById(id: string): Promise<PaymentMerchant | null> {
    return this.store.get(id) ?? null;
  }

  async findByExternalRef(input: {
    sourceApp: string;
    externalRef: string;
  }): Promise<PaymentMerchant | null> {
    for (const m of this.store.values()) {
      if (m.sourceApp === input.sourceApp && m.externalRef === input.externalRef) return m;
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

  async updateStatus(
    id: string,
    status: PaymentMerchant['status'],
  ): Promise<PaymentMerchant> {
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
    return !pa || pa.merchantId !== merchantId ? null : pa;
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
      status: (input.status ?? 'active') as PaymentProviderAccount['status'],
      metadata: input.metadata ?? {},
      createdAt: now,
      updatedAt: now,
    };
    this.store.set(pa.id, pa);
    return pa;
  }

  async updateStatus(
    id: string,
    merchantId: string,
    status: PaymentProviderAccount['status'],
  ): Promise<PaymentProviderAccount> {
    const pa = this.store.get(id);
    if (!pa || pa.merchantId !== merchantId) throw new Error(`Provider account not found: ${id}`);
    const updated = { ...pa, status, updatedAt: new Date() };
    this.store.set(id, updated);
    return updated;
  }
}

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
  private readonly store = new Map<string, PaymentIntentDTO>();

  async findById(id: string, merchantId: string): Promise<PaymentIntentDTO | null> {
    const intent = this.store.get(id);
    return !intent || intent.merchantId !== merchantId ? null : intent;
  }

  async findByExternalPayable(input: {
    merchantId: string;
    externalPayableType: string;
    externalPayableId: string;
    sourceApp?: string | null;
  }): Promise<PaymentIntentDTO | null> {
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
  }): Promise<PaymentIntentDTO> {
    const now = new Date();
    const intent: PaymentIntentDTO = {
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
  }): Promise<PaymentIntentDTO> {
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
  }): Promise<PaymentIntentDTO> {
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
  private readonly store = new Map<string, PaymentTransactionDTO>();

  async findById(id: string, merchantId: string): Promise<PaymentTransactionDTO | null> {
    const tx = this.store.get(id);
    return !tx || tx.merchantId !== merchantId ? null : tx;
  }

  async findByIntentId(
    intentId: string,
    merchantId: string,
  ): Promise<PaymentTransactionDTO[]> {
    return [...this.store.values()].filter(
      (tx) => tx.intentId === intentId && tx.merchantId === merchantId,
    );
  }

  async findByProviderReference(
    provider: string,
    providerReference: string,
  ): Promise<PaymentTransactionDTO | null> {
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
  }): Promise<PaymentTransactionDTO> {
    const now = new Date();
    const tx: PaymentTransactionDTO = {
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
  }): Promise<PaymentTransactionDTO> {
    const tx = this.store.get(input.id);
    if (!tx || tx.merchantId !== input.merchantId)
      throw new Error(`Transaction not found: ${input.id}`);
    const updated = {
      ...tx,
      status: input.status as TxStatus,
      failureReason:
        input.failureReason !== undefined ? input.failureReason : tx.failureReason,
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
  }): Promise<{ transaction: PaymentTransactionDTO | null; changed: boolean }> {
    const tx = this.store.get(input.id);
    if (!tx || tx.merchantId !== input.merchantId) return { transaction: null, changed: false };
    if (tx.status !== 'requires_action' && tx.status !== 'pending')
      return { transaction: null, changed: false };
    const updated: PaymentTransactionDTO = {
      ...tx,
      status: 'succeeded' as TxStatus,
      updatedAt: new Date(),
    };
    this.store.set(input.id, updated);
    return { transaction: updated, changed: true };
  }
}

class InMemoryProviderEventRepo implements PaymentProviderEventRepository {
  private readonly store = new Map<string, PaymentProviderEventDTO>();

  async reserveEvent(input: ReserveProviderEventInput): Promise<PaymentProviderEventDTO> {
    const now = new Date();
    const event: PaymentProviderEventDTO = {
      id: input.id,
      merchantId: null,
      provider: input.provider,
      providerEventId: input.providerEventId,
      providerReference: input.providerReference ?? null,
      eventType: input.eventType,
      processingStatus: 'pending',
      processingAttempts: 0,
      lastError: null,
      rawHeaders: input.rawHeaders,
      rawBody: input.rawBody,
      parsedPayload: null,
      receivedAt: now,
      processedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.store.set(event.id, event);
    return event;
  }

  async findByProviderEventId(
    provider: string,
    providerEventId: string,
  ): Promise<PaymentProviderEventDTO | null> {
    for (const ev of this.store.values()) {
      if (ev.provider === provider && ev.providerEventId === providerEventId) return ev;
    }
    return null;
  }

  async assignMerchant(eventId: string, merchantId: string): Promise<void> {
    const ev = this.store.get(eventId);
    if (!ev) return;
    this.store.set(eventId, { ...ev, merchantId, updatedAt: new Date() });
  }

  async markProcessed(eventId: string): Promise<void> {
    const ev = this.store.get(eventId);
    if (!ev) return;
    this.store.set(eventId, {
      ...ev,
      processingStatus: 'processed',
      processedAt: new Date(),
      updatedAt: new Date(),
    });
  }

  async markFailed(eventId: string, error: string): Promise<void> {
    const ev = this.store.get(eventId);
    if (!ev) return;
    this.store.set(eventId, {
      ...ev,
      processingStatus: 'failed',
      lastError: error,
      updatedAt: new Date(),
    });
  }

  async findStalePending(_input: FindStalePendingInput): Promise<PaymentProviderEventDTO[]> {
    return [];
  }
}

class InMemoryIdempotencyRepo implements PaymentIdempotencyRepository {
  private readonly store = new Map<string, PaymentIdempotencyKeyDTO>();

  async reserve(input: ReserveIdempotencyKeyInput): Promise<PaymentIdempotencyKeyDTO> {
    const now = new Date();
    const rec: PaymentIdempotencyKeyDTO = {
      id: randomUUID(),
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
    this.store.set(`${input.merchantId}:${input.scope}:${input.idempotencyKey}`, rec);
    return rec;
  }

  async find(input: FindIdempotencyKeyInput): Promise<PaymentIdempotencyKeyDTO | null> {
    return (
      this.store.get(`${input.merchantId}:${input.scope}:${input.idempotencyKey}`) ?? null
    );
  }

  async markCompleted(input: MarkIdempotencyCompletedInput): Promise<void> {
    const key = `${input.merchantId}:${input.scope}:${input.idempotencyKey}`;
    const rec = this.store.get(key);
    if (!rec) return;
    this.store.set(key, {
      ...rec,
      status: 'completed',
      responseSnapshot: input.responseSnapshot ?? null,
      resourceType: input.resourceType ?? null,
      resourceId: input.resourceId ?? null,
      updatedAt: new Date(),
    });
  }

  async markFailed(input: MarkIdempotencyFailedInput): Promise<void> {
    const key = `${input.merchantId}:${input.scope}:${input.idempotencyKey}`;
    const rec = this.store.get(key);
    if (!rec) return;
    this.store.set(key, { ...rec, status: 'failed', updatedAt: new Date() });
  }
}

// ── Container factory ─────────────────────────────────────────────────────────

interface TestRepos {
  merchantRepo: InMemoryMerchantRepo;
  providerAccountRepo: InMemoryProviderAccountRepo;
  intentRepo: InMemoryIntentRepo;
  transactionRepo: InMemoryTransactionRepo;
  providerEventRepo: InMemoryProviderEventRepo;
  idempotencyRepo: InMemoryIdempotencyRepo;
}

function buildContainer(
  repos: TestRepos,
  opts: { serviceToken: string; webhookSecret?: string | null; nodeEnv?: string },
): ServiceContainer {
  const nodeEnv = opts.nodeEnv ?? 'test';
  const config: PaymentOrchestrationServiceConfig = {
    port: 0,
    nodeEnv,
    serviceToken: opts.serviceToken,
    dbUrl: 'not-needed-in-memory',
    version: '0.2.0-test',
    phase: '8E-test',
  };

  const fakeGatewayProvider = new FakeGatewayProvider(nodeEnv);
  const providerRegistry = { get: (name: string) => (name === 'fake_gateway' ? fakeGatewayProvider : null) } as any;

  const fakeGatewayWebhookHandler = new FakeGatewayWebhookHandler({
    webhookSecret: opts.webhookSecret ?? null,
    nodeEnv,
  });

  const useCases = {
    createMerchant: new CreateMerchant(repos.merchantRepo),
    createProviderAccount: new CreateProviderAccount(repos.merchantRepo, repos.providerAccountRepo),
    createPaymentIntent: new CreatePaymentIntent(repos.merchantRepo, repos.intentRepo, repos.idempotencyRepo),
    createGatewayPayment: new CreateGatewayPayment(
      repos.merchantRepo,
      repos.intentRepo,
      repos.transactionRepo,
      providerRegistry,
      repos.providerAccountRepo,
      repos.idempotencyRepo,
      nodeEnv,
    ),
    confirmFakeGatewayPayment: new ConfirmFakeGatewayPayment(
      repos.transactionRepo,
      repos.intentRepo,
      nodeEnv,
    ),
    getPaymentIntentStatus: new GetPaymentIntentStatus(repos.intentRepo, repos.transactionRepo),
    getRefundability: new GetRefundability(repos.intentRepo, repos.transactionRepo),
    handleProviderWebhook: new HandleProviderWebhook(
      repos.transactionRepo,
      repos.intentRepo,
      repos.providerEventRepo,
      fakeGatewayWebhookHandler,
    ),
    reconcilePaymentIntentTotals: new ReconcilePaymentIntentTotals(
      repos.intentRepo,
      repos.transactionRepo,
    ),
    refreshProviderStatus: {} as any,
  };

  return {
    config,
    db: {} as any,
    repos: repos as any,
    providerRegistry,
    useCases,
  };
}

async function startServer(container: ServiceContainer): Promise<{ server: http.Server; baseUrl: string }> {
  const app = createApp(container);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

function stopServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
}

// ── WR01-WR05: no webhook secret (dev/test mode) ──────────────────────────────

describe('Phase 8E Hardening — Webhook Route Auth Bypass (WR01-WR05)', () => {
  const TEST_TOKEN = 'test-service-token-wr-suite';
  const AMOUNT_DUE = 30000;
  const PROVIDER_REF = `fake_pay_wr_${randomUUID().slice(0, 8)}`;
  const WR01_EVENT_ID = `evt_wr01_${randomUUID().slice(0, 8)}`;

  let server: http.Server;
  let baseUrl: string;
  let merchantId: string;
  let intentId: string;
  let repos: TestRepos;

  before(async () => {
    merchantId = randomUUID();
    intentId = randomUUID();
    const txId = randomUUID();

    repos = {
      merchantRepo: new InMemoryMerchantRepo(),
      providerAccountRepo: new InMemoryProviderAccountRepo(),
      intentRepo: new InMemoryIntentRepo(),
      transactionRepo: new InMemoryTransactionRepo(),
      providerEventRepo: new InMemoryProviderEventRepo(),
      idempotencyRepo: new InMemoryIdempotencyRepo(),
    };

    // Pre-seed: merchant + intent + transaction (requires_action awaiting webhook)
    await repos.merchantRepo.create({ id: merchantId, name: 'WR Test Merchant', sourceApp: 'test', status: 'active' });
    await repos.intentRepo.create({ id: intentId, merchantId, externalPayableType: 'order', externalPayableId: 'ord-wr01', amountDue: AMOUNT_DUE });
    await repos.transactionRepo.create({
      id: txId,
      merchantId,
      intentId,
      provider: 'fake_gateway',
      method: 'qris',
      transactionType: 'payment',
      direction: 'incoming',
      status: 'requires_action',
      amount: AMOUNT_DUE,
      providerReference: PROVIDER_REF,
    });

    const container = buildContainer(repos, { serviceToken: TEST_TOKEN, nodeEnv: 'test' });
    ({ server, baseUrl } = await startServer(container));
  });

  after(() => stopServer(server));

  test('WR01: webhook POST succeeds without service token (no signature in dev/test mode)', async () => {
    const res = await fetch(`${baseUrl}/v1/webhooks/fake_gateway`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        event_id: WR01_EVENT_ID,
        event_type: 'payment.succeeded',
        status: 'succeeded',
        provider_reference: PROVIDER_REF,
      }),
    });

    assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
    const body = await res.json() as any;
    assert.equal(body.ok, true);
    assert.equal(body.processingStatus, 'processed');
    assert.equal(body.idempotentReplay, false);
    // Intent should now be paid
    assert.ok(body.intent, 'intent should be present in response');
    assert.equal(body.intent.amountPaid, AMOUNT_DUE);
    assert.equal(body.intent.status, 'paid');
  });

  test('WR02: POST /v1/payment-intents without service token → 401', async () => {
    const res = await fetch(`${baseUrl}/v1/payment-intents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // No x-payment-orchestration-service-token header
      body: JSON.stringify({
        merchantId,
        externalPayableType: 'order',
        externalPayableId: 'ord-wr02',
        amountDue: 10000,
      }),
    });
    assert.equal(res.status, 401, `Expected 401, got ${res.status}`);
    const body = await res.json() as any;
    assert.equal(body.ok, false);
  });

  test('WR03: malicious x-payment-merchant-id header ignored; merchant resolved from providerReference', async () => {
    const res = await fetch(`${baseUrl}/v1/webhooks/fake_gateway`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-payment-merchant-id': 'evil-merchant-should-be-ignored',
      },
      body: JSON.stringify({
        event_id: `evt_wr03_${randomUUID().slice(0, 8)}`,
        event_type: 'payment.succeeded',
        status: 'succeeded',
        provider_reference: PROVIDER_REF,  // matches real merchant's transaction
      }),
    });

    assert.equal(res.status, 200, `Expected 200 (idempotent on already-succeeded tx), got ${res.status}`);
    const body = await res.json() as any;
    assert.equal(body.ok, true);

    // Key assertion: intent in response belongs to the real intent (not evil merchant's)
    // The webhook uses providerReference → TX → intent to resolve merchant, ignoring the header.
    assert.equal(body.intent?.id, intentId, 'webhook must resolve intent from providerReference, not x-payment-merchant-id header');
  });

  test('WR04: duplicate event_id → idempotentReplay=true, amountPaid unchanged', async () => {
    // Snapshot amountPaid before duplicate replay
    const intentBefore = await repos.intentRepo.findById(intentId, merchantId);
    const amountPaidBefore = intentBefore?.amountPaid ?? 0;

    // Send same event_id as WR01 (already processed)
    const res = await fetch(`${baseUrl}/v1/webhooks/fake_gateway`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        event_id: WR01_EVENT_ID,  // same event_id as WR01
        event_type: 'payment.succeeded',
        status: 'succeeded',
        provider_reference: PROVIDER_REF,
      }),
    });

    assert.equal(res.status, 200, `Expected 200 for idempotent replay, got ${res.status}`);
    const body = await res.json() as any;
    assert.equal(body.ok, true);
    assert.equal(body.idempotentReplay, true, 'second call with same event_id must return idempotentReplay=true');

    // Verify amountPaid did not increase
    const intentAfter = await repos.intentRepo.findById(intentId, merchantId);
    assert.equal(
      intentAfter?.amountPaid,
      amountPaidBefore,
      'duplicate event must not double-credit intent.amountPaid',
    );
  });

  test('WR05: invalid FakeGateway payload (missing event_id) → 400', async () => {
    const res = await fetch(`${baseUrl}/v1/webhooks/fake_gateway`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        // Missing event_id — invalid payload
        event_type: 'payment.succeeded',
        status: 'succeeded',
        provider_reference: 'some_ref',
      }),
    });

    assert.equal(res.status, 400, `Expected 400 for invalid payload, got ${res.status}`);
    const body = await res.json() as any;
    assert.equal(body.ok, false);
    assert.equal(body.error?.code ?? body.error, 'INVALID_WEBHOOK_PAYLOAD');
  });
});

// ── WR06: webhook secret configured — signature required ──────────────────────

describe('Phase 8E Hardening — WR06: Webhook secret configured, signature required', () => {
  const WEBHOOK_SECRET = `wr06-test-secret-${randomUUID()}`;

  let server: http.Server;
  let baseUrl: string;

  before(async () => {
    const repos: TestRepos = {
      merchantRepo: new InMemoryMerchantRepo(),
      providerAccountRepo: new InMemoryProviderAccountRepo(),
      intentRepo: new InMemoryIntentRepo(),
      transactionRepo: new InMemoryTransactionRepo(),
      providerEventRepo: new InMemoryProviderEventRepo(),
      idempotencyRepo: new InMemoryIdempotencyRepo(),
    };

    // Note: No pre-seeded data needed; WR06 tests fail before any TX lookup.
    const container = buildContainer(repos, {
      serviceToken: 'wr06-service-token',
      webhookSecret: WEBHOOK_SECRET,
      nodeEnv: 'test',
    });
    ({ server, baseUrl } = await startServer(container));
  });

  after(() => stopServer(server));

  test('WR06a: missing x-fakegateway-signature header → 401 WEBHOOK_SIGNATURE_MISSING', async () => {
    const res = await fetch(`${baseUrl}/v1/webhooks/fake_gateway`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // No signature header — handler returns WEBHOOK_SIGNATURE_MISSING (distinct from wrong sig)
      body: JSON.stringify({
        event_id: `evt_wr06a_${randomUUID().slice(0, 8)}`,
        event_type: 'payment.succeeded',
        status: 'succeeded',
        provider_reference: 'fake_ref_wr06',
      }),
    });

    assert.equal(res.status, 401, `Expected 401, got ${res.status}`);
    const body = await res.json() as any;
    assert.equal(body.ok, false);
    assert.equal(body.error?.code ?? body.error, 'WEBHOOK_SIGNATURE_MISSING');
  });

  test('WR06b: wrong x-fakegateway-signature → 401 WEBHOOK_SIGNATURE_INVALID', async () => {
    const res = await fetch(`${baseUrl}/v1/webhooks/fake_gateway`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-fakegateway-signature': 'sha256=deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      },
      body: JSON.stringify({
        event_id: `evt_wr06b_${randomUUID().slice(0, 8)}`,
        event_type: 'payment.succeeded',
        status: 'succeeded',
        provider_reference: 'fake_ref_wr06',
      }),
    });

    assert.equal(res.status, 401, `Expected 401, got ${res.status}`);
    const body = await res.json() as any;
    assert.equal(body.ok, false);
    assert.equal(body.error?.code ?? body.error, 'WEBHOOK_SIGNATURE_INVALID');
  });
});
