/**
 * payment-orchestration-service-http-auth.test.ts
 *
 * Phase 8D Hardening — Task 7: HTTP/auth integration tests.
 *
 * Exercises the actual HTTP layer (Express app) using a real HTTP server started
 * on a random port, with in-memory repositories (no DB required).
 *
 * Scenarios covered:
 *   A01: GET /health → 200 without service token (unprotected)
 *   A02: GET /version → 200 without service token (unprotected)
 *   A03: POST /v1/merchants without token → 401 UNAUTHORIZED
 *   A04: POST /v1/merchants wrong token → 401 UNAUTHORIZED
 *   A05: POST /v1/merchants correct primary header → 201 Created
 *   A06: POST /v1/merchants compat header (x-payment-engine-service-token) → 200/201
 *   A07: POST intent with x-payment-merchant-id header fallback (no merchantId in body)
 *   A08: GET status with x-payment-merchant-id header fallback (no ?merchantId= query)
 *   A09: GET refundability with x-payment-merchant-id header fallback
 *   A10: POST fake confirm with x-payment-merchant-id header fallback (no merchantId in body)
 *   A11: Provider account POST includes providerAccountRef; credentialsRef absent from response
 *   A12: Provider account GET includes providerAccountRef; credentialsRef absent from response
 *   A13: Responses do not expose tenantId or credentialsRef in any field
 *
 * Run:
 *   npx tsx --tsconfig apps/api/tsconfig.node.json --test \
 *     apps/api/src/__tests__/payment-orchestration-service-http-auth.test.ts
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

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
import { StandaloneFakeGatewayProvider } from '../apps/service/src/infrastructure/providers/StandaloneFakeGatewayProvider.ts';
import { FakeGatewayWebhookHandler } from '../apps/service/src/infrastructure/providers/FakeGatewayWebhookHandler.ts';
import { HandleProviderWebhook } from '../apps/service/src/application/use-cases/HandleProviderWebhook.ts';

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
  StandalonePaymentIntentDTO,
  StandalonePaymentTransactionDTO,
  PaymentIdempotencyKeyDTO,
  PaymentProviderEventDTO,
} from '@northflow/payment-orchestration-core';

// ── Minimal in-memory repositories ───────────────────────────────────────────

type MerchantStatus = 'active' | 'suspended' | 'closed';

class InMemoryMerchantRepo implements PaymentMerchantRepository {
  private readonly store = new Map<string, PaymentMerchant>();

  async findById(id: string): Promise<PaymentMerchant | null> {
    return this.store.get(id) ?? null;
  }

  async findByExternalRef(input: { sourceApp: string; externalRef: string }): Promise<PaymentMerchant | null> {
    for (const m of this.store.values()) {
      if (m.sourceApp === input.sourceApp && m.externalRef === input.externalRef) return m;
    }
    return null;
  }

  async create(input: { id: string; name: string; legalName?: string | null; externalRef?: string | null; sourceApp?: string | null; status?: string; metadata?: Record<string, unknown> }): Promise<PaymentMerchant> {
    const now = new Date();
    const merchant: PaymentMerchant = {
      id: input.id, displayName: input.name, legalName: input.legalName ?? null,
      externalRef: input.externalRef ?? null, sourceApp: input.sourceApp ?? null,
      status: (input.status ?? 'active') as MerchantStatus, metadata: input.metadata ?? {},
      createdAt: now, updatedAt: now,
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

class InMemoryProviderAccountRepo implements PaymentProviderAccountRepository {
  private readonly store = new Map<string, PaymentProviderAccount>();

  async findById(id: string, merchantId: string): Promise<PaymentProviderAccount | null> {
    const pa = this.store.get(id);
    return (!pa || pa.merchantId !== merchantId) ? null : pa;
  }

  async findByMerchantAndProvider(merchantId: string, provider: string, environment?: string): Promise<PaymentProviderAccount | null> {
    for (const pa of this.store.values()) {
      if (pa.merchantId === merchantId && pa.provider === provider) {
        if (!environment || pa.environment === environment) return pa;
      }
    }
    return null;
  }

  async create(input: { id: string; merchantId: string; provider: string; environment: string; providerAccountRef?: string | null; credentialsRef?: string | null; publicConfig?: Record<string, unknown>; status?: string; metadata?: Record<string, unknown> }): Promise<PaymentProviderAccount> {
    const now = new Date();
    const pa: PaymentProviderAccount = {
      id: input.id, merchantId: input.merchantId, provider: input.provider,
      environment: input.environment as PaymentProviderAccount['environment'],
      providerAccountRef: input.providerAccountRef ?? null,
      credentialsRef: input.credentialsRef ?? null,
      publicConfig: input.publicConfig ?? {}, status: (input.status ?? 'active') as PaymentProviderAccount['status'],
      metadata: input.metadata ?? {}, createdAt: now, updatedAt: now,
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
    return (!intent || intent.merchantId !== merchantId) ? null : intent;
  }

  async findByExternalPayable(input: { merchantId: string; externalPayableType: string; externalPayableId: string; sourceApp?: string | null }): Promise<StandalonePaymentIntentDTO | null> {
    for (const intent of this.store.values()) {
      if (intent.merchantId === input.merchantId && intent.externalPayableType === input.externalPayableType && intent.externalPayableId === input.externalPayableId) {
        return intent;
      }
    }
    return null;
  }

  async create(input: { id: string; merchantId: string; providerAccountId?: string | null; sourceApp?: string | null; externalTenantId?: string | null; externalOutletId?: string | null; externalLocationId?: string | null; externalPayableType: string; externalPayableId: string; currency?: string; amountDue: number; allowPartial?: boolean; expiresAt?: Date | null; metadata?: Record<string, unknown> | null }): Promise<StandalonePaymentIntentDTO> {
    const now = new Date();
    const intent: StandalonePaymentIntentDTO = {
      id: input.id, merchantId: input.merchantId, providerAccountId: input.providerAccountId ?? null,
      sourceApp: input.sourceApp ?? null, externalTenantId: input.externalTenantId ?? null,
      externalOutletId: input.externalOutletId ?? null, externalLocationId: input.externalLocationId ?? null,
      externalPayableType: input.externalPayableType, externalPayableId: input.externalPayableId,
      amountDue: input.amountDue, amountPaid: 0, amountRefunded: 0, amountRemaining: input.amountDue,
      currency: input.currency ?? 'IDR', status: 'requires_payment', allowPartial: input.allowPartial ?? false,
      expiresAt: null, metadata: input.metadata ?? {}, createdAt: now, updatedAt: now,
    };
    this.store.set(intent.id, intent);
    return intent;
  }

  async updateTotals(input: { id: string; merchantId: string; amountPaid: number; amountRefunded: number; amountRemaining: number }): Promise<StandalonePaymentIntentDTO> {
    const intent = this.store.get(input.id);
    if (!intent || intent.merchantId !== input.merchantId) throw new Error(`Intent not found: ${input.id}`);
    const updated = { ...intent, amountPaid: input.amountPaid, amountRefunded: input.amountRefunded, amountRemaining: input.amountRemaining, updatedAt: new Date() };
    this.store.set(input.id, updated);
    return updated;
  }

  async updateStatus(input: { id: string; merchantId: string; status: string }): Promise<StandalonePaymentIntentDTO> {
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
    const tx: StandalonePaymentTransactionDTO = {
      id: input.id, merchantId: input.merchantId, intentId: input.intentId,
      providerAccountId: input.providerAccountId ?? null, provider: input.provider, method: input.method,
      transactionType: input.transactionType, direction: input.direction as 'incoming' | 'outgoing',
      status: input.status as TxStatus, amount: input.amount, currency: input.currency ?? 'IDR',
      parentTransactionId: input.parentTransactionId ?? null, providerReference: input.providerReference ?? null,
      providerEventId: input.providerEventId ?? null, providerPaymentUrl: input.providerPaymentUrl ?? null,
      providerQrString: input.providerQrString ?? null, failureReason: input.failureReason ?? null,
      idempotencyKey: input.idempotencyKey ?? null, expiresAt: null, metadata: input.metadata ?? {},
      rawProviderResponse: input.rawProviderResponse ?? null, createdAt: now, updatedAt: now,
    };
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
      if (tx.parentTransactionId === parentTransactionId && tx.transactionType === 'refund' && tx.direction === 'outgoing' && tx.status === 'succeeded') {
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
    const updated: StandalonePaymentTransactionDTO = { ...tx, status: 'succeeded' as TxStatus, updatedAt: new Date() };
    this.store.set(input.id, updated);
    return { transaction: updated, changed: true };
  }
}

class InMemoryIdempotencyRepo implements PaymentIdempotencyRepository {
  private readonly store = new Map<string, PaymentIdempotencyKeyDTO>();

  async reserve(input: { id: string; merchantId: string; scope: string; idempotencyKey: string; requestHash: string; expiresAt?: Date | null }): Promise<PaymentIdempotencyKeyDTO> {
    const now = new Date();
    const record: PaymentIdempotencyKeyDTO = { id: input.id, merchantId: input.merchantId, scope: input.scope, idempotencyKey: input.idempotencyKey, requestHash: input.requestHash, responseSnapshot: null, resourceType: null, resourceId: null, status: 'processing', createdAt: now, updatedAt: now, expiresAt: input.expiresAt ?? null };
    this.store.set(`${input.merchantId}:${input.scope}:${input.idempotencyKey}`, record);
    return record;
  }

  async find(input: { merchantId: string; scope: string; idempotencyKey: string }): Promise<PaymentIdempotencyKeyDTO | null> {
    return this.store.get(`${input.merchantId}:${input.scope}:${input.idempotencyKey}`) ?? null;
  }

  async markCompleted(input: { merchantId: string; scope: string; idempotencyKey: string; responseSnapshot: Record<string, unknown>; resourceType?: string | null; resourceId?: string | null }): Promise<void> {
    const key = `${input.merchantId}:${input.scope}:${input.idempotencyKey}`;
    const record = this.store.get(key);
    if (!record) return;
    this.store.set(key, { ...record, status: 'completed', responseSnapshot: input.responseSnapshot, resourceType: input.resourceType ?? null, resourceId: input.resourceId ?? null, updatedAt: new Date() });
  }

  async markFailed(input: { merchantId: string; scope: string; idempotencyKey: string; error: string }): Promise<void> {
    const key = `${input.merchantId}:${input.scope}:${input.idempotencyKey}`;
    const record = this.store.get(key);
    if (!record) return;
    this.store.set(key, { ...record, status: 'failed', responseSnapshot: { error: input.error }, updatedAt: new Date() });
  }
}

/** Stub provider event repo — not tested in isolation here, included to satisfy ServiceContainer interface. */
class StubProviderEventRepo implements PaymentProviderEventRepository {
  async reserveEvent(): Promise<PaymentProviderEventDTO> { throw new Error('StubProviderEventRepo.reserveEvent not implemented'); }
  async findByProviderEventId(): Promise<PaymentProviderEventDTO | null> { return null; }
  async assignMerchant(): Promise<void> { return; }
  async markProcessed(): Promise<void> { return; }
  async markFailed(): Promise<void> { return; }
  async findStalePending(): Promise<PaymentProviderEventDTO[]> { return []; }
}

// ── Test container factory ────────────────────────────────────────────────────

function buildTestContainer(opts: { serviceToken?: string; nodeEnv?: string } = {}): ServiceContainer {
  const nodeEnv = opts.nodeEnv ?? 'development';
  const serviceToken = opts.serviceToken ?? 'test-service-token-abc123';

  const merchantRepo = new InMemoryMerchantRepo();
  const providerAccountRepo = new InMemoryProviderAccountRepo();
  const intentRepo = new InMemoryIntentRepo();
  const transactionRepo = new InMemoryTransactionRepo();
  const idempotencyRepo = new InMemoryIdempotencyRepo();
  const providerEventRepo = new StubProviderEventRepo();

  const fakeGateway = new StandaloneFakeGatewayProvider();
  const providerRegistry = new Map([[fakeGateway.providerCode, fakeGateway]]);

  const config: PaymentOrchestrationServiceConfig = {
    port: 0,
    nodeEnv,
    serviceToken,
    dbUrl: '',
    version: '0.2.0',
    phase: '8D',
    legacyServiceTokenEnabled: true,
  };

  const fakeGatewayWebhookHandler = new FakeGatewayWebhookHandler({ nodeEnv });

  const useCases = {
    createMerchant: new CreateMerchant(merchantRepo),
    createProviderAccount: new CreateProviderAccount(merchantRepo, providerAccountRepo),
    createPaymentIntent: new CreatePaymentIntent(merchantRepo, intentRepo, idempotencyRepo),
    createGatewayPayment: new CreateGatewayPayment(
      merchantRepo, intentRepo, transactionRepo, providerRegistry,
      providerAccountRepo, idempotencyRepo, nodeEnv,
    ),
    confirmFakeGatewayPayment: new ConfirmFakeGatewayPayment(transactionRepo, intentRepo, nodeEnv),
    getPaymentIntentStatus: new GetPaymentIntentStatus(intentRepo, transactionRepo),
    getRefundability: new GetRefundability(intentRepo, transactionRepo),
    handleProviderWebhook: new HandleProviderWebhook(
      transactionRepo,
      intentRepo,
      providerEventRepo,
      fakeGatewayWebhookHandler,
    ),
    reconcilePaymentIntentTotals: {} as any,
    refreshProviderStatus: {} as any,
  };

  return {
    config,
    db: null as unknown as ServiceContainer['db'],
    repos: { merchantRepo, providerAccountRepo, intentRepo, transactionRepo, providerEventRepo, idempotencyRepo },
    providerRegistry,
    useCases,
  };
}

// ── Test HTTP server ──────────────────────────────────────────────────────────

const TOKEN = 'test-service-token-abc123';
const WRONG_TOKEN = 'wrong-token-xyz';

let server: http.Server;
let baseUrl: string;

before(async () => {
  const container = buildTestContainer({ serviceToken: TOKEN });
  const app = createApp(container);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://localhost:${port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

/** Simple fetch helper with optional auth header */
async function apiFetch(
  path: string,
  opts: {
    method?: string;
    token?: string | null;
    compatToken?: string | null;
    merchantIdHeader?: string | null;
    body?: unknown;
  } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.token !== undefined && opts.token !== null) {
    headers['x-payment-orchestration-service-token'] = opts.token;
  }
  if (opts.compatToken) {
    headers['x-payment-engine-service-token'] = opts.compatToken;
  }
  if (opts.merchantIdHeader) {
    headers['x-payment-merchant-id'] = opts.merchantIdHeader;
  }

  const res = await fetch(`${baseUrl}${path}`, {
    method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  const body = await res.json().catch(() => ({})) as Record<string, unknown>;
  return { status: res.status, body };
}

// ── Scenario tests ────────────────────────────────────────────────────────────

describe('Phase 8D Hardening — HTTP/Auth Tests', () => {

  // A01: Health check is unauthenticated
  test('A01: GET /health → 200 without service token', async () => {
    const { status, body } = await apiFetch('/health');
    assert.equal(status, 200);
    assert.equal((body as { ok?: unknown })['ok'], true);
  });

  // A02: Version check is unauthenticated
  test('A02: GET /version → 200 without service token', async () => {
    const { status, body } = await apiFetch('/version');
    assert.equal(status, 200);
    assert.ok(typeof (body as { service?: unknown })['service'] === 'string');
  });

  // A03: Protected route without token → 401
  test('A03: POST /v1/merchants without token → 401 UNAUTHORIZED', async () => {
    const { status, body } = await apiFetch('/v1/merchants', {
      body: { name: 'Test' },
      token: null,
    });
    assert.equal(status, 401);
    assert.equal((body as { error?: unknown })['error'], 'UNAUTHORIZED');
  });

  // A04: Wrong token → 401
  test('A04: POST /v1/merchants with wrong token → 401 UNAUTHORIZED', async () => {
    const { status, body } = await apiFetch('/v1/merchants', {
      body: { name: 'Test' },
      token: WRONG_TOKEN,
    });
    assert.equal(status, 401);
    assert.equal((body as { error?: unknown })['error'], 'UNAUTHORIZED');
  });

  // A05: Correct primary token → 201 Created
  test('A05: POST /v1/merchants with correct primary token → 201', async () => {
    const { status, body } = await apiFetch('/v1/merchants', {
      body: { name: 'Auth Test Merchant', sourceApp: 'test', externalRef: 'auth-test-001' },
      token: TOKEN,
    });
    assert.equal(status, 201);
    assert.equal((body as { ok?: unknown })['ok'], true);
    const data = (body as { data?: Record<string, unknown> })['data']!;
    assert.ok(typeof data['id'] === 'string');
    assert.equal(data['name'], 'Auth Test Merchant');
  });

  // A06: Compat token header → also accepted
  test('A06: POST /v1/merchants with compat x-payment-engine-service-token header → success', async () => {
    const { status, body } = await apiFetch('/v1/merchants', {
      body: { name: 'Compat Token Merchant', sourceApp: 'test', externalRef: 'compat-test-001' },
      compatToken: TOKEN,
    });
    assert.ok(status === 200 || status === 201, `Expected 200 or 201, got ${status}`);
    assert.equal((body as { ok?: unknown })['ok'], true);
  });

  // A07: x-payment-merchant-id header fallback for intent creation
  test('A07: POST /v1/payment-intents with header merchantId fallback (no body merchantId)', async () => {
    // First create a merchant to get a valid merchantId
    const merchantRes = await apiFetch('/v1/merchants', {
      body: { name: 'Header Fallback Merchant', sourceApp: 'test', externalRef: 'hdr-001' },
      token: TOKEN,
    });
    assert.equal(merchantRes.status, 201);
    const merchantId = ((merchantRes.body as { data?: Record<string, unknown> })['data'] as { id: string })['id'];

    // Create intent WITHOUT merchantId in body, only via header
    const { status, body } = await apiFetch('/v1/payment-intents', {
      body: {
        // No merchantId in body!
        externalPayableType: 'order',
        externalPayableId: 'order-hdr-001',
        currency: 'IDR',
        amountDue: 50000,
      },
      token: TOKEN,
      merchantIdHeader: merchantId,
    });

    assert.equal(status, 201, `Expected 201, got ${status}: ${JSON.stringify(body)}`);
    const data = (body as { data?: Record<string, unknown> })['data']!;
    assert.equal(data['merchantId'], merchantId);
    assert.equal(data['amountDue'], 50000);
  });

  // A08: GET status with header fallback (no ?merchantId= query)
  test('A08: GET /v1/payment-intents/:id/status with header merchantId fallback', async () => {
    // Create merchant + intent
    const mRes = await apiFetch('/v1/merchants', {
      body: { name: 'Status Header Test', sourceApp: 'test', externalRef: 'shdr-001' },
      token: TOKEN,
    });
    const merchantId = ((mRes.body as { data?: Record<string, unknown> })['data'] as { id: string })['id'];

    const iRes = await apiFetch('/v1/payment-intents', {
      body: { merchantId, externalPayableType: 'order', externalPayableId: 'order-shdr-001', currency: 'IDR', amountDue: 30000 },
      token: TOKEN,
    });
    const intentId = ((iRes.body as { data?: Record<string, unknown> })['data'] as { id: string })['id'];

    // GET status WITHOUT ?merchantId= query param — only via header
    const { status, body } = await apiFetch(`/v1/payment-intents/${intentId}/status`, {
      token: TOKEN,
      merchantIdHeader: merchantId,
    });

    assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
    const data = (body as { data?: Record<string, unknown> })['data']!;
    assert.equal((data['intent'] as Record<string, unknown>)['id'], intentId);
    assert.equal(typeof (data['isTerminal']), 'boolean');
    assert.equal(typeof (data['requiresAction']), 'boolean');
    assert.equal(typeof (data['canRetryPayment']), 'boolean');
  });

  // A09: GET refundability with header fallback
  test('A09: GET /v1/payment-intents/:id/refundability with header merchantId fallback', async () => {
    const mRes = await apiFetch('/v1/merchants', {
      body: { name: 'Refund Header Test', sourceApp: 'test', externalRef: 'rhdr-001' },
      token: TOKEN,
    });
    const merchantId = ((mRes.body as { data?: Record<string, unknown> })['data'] as { id: string })['id'];

    const iRes = await apiFetch('/v1/payment-intents', {
      body: { merchantId, externalPayableType: 'order', externalPayableId: 'order-rhdr-001', currency: 'IDR', amountDue: 90000 },
      token: TOKEN,
    });
    const intentId = ((iRes.body as { data?: Record<string, unknown> })['data'] as { id: string })['id'];

    // GET refundability WITHOUT ?merchantId= — only via header
    const { status, body } = await apiFetch(`/v1/payment-intents/${intentId}/refundability`, {
      token: TOKEN,
      merchantIdHeader: merchantId,
    });

    assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
    const data = (body as { data?: Record<string, unknown> })['data']!;
    assert.equal(data['intentId'], intentId);
    assert.equal(data['totalRefundable'], 0, 'No succeeded transactions yet');
    assert.ok(Array.isArray(data['transactions']));
  });

  // A10: Fake confirm with header fallback
  test('A10: POST fake-gateway confirm with header merchantId fallback (no body merchantId)', async () => {
    const mRes = await apiFetch('/v1/merchants', {
      body: { name: 'Confirm Header Test', sourceApp: 'test', externalRef: 'chdr-001' },
      token: TOKEN,
    });
    const merchantId = ((mRes.body as { data?: Record<string, unknown> })['data'] as { id: string })['id'];

    const iRes = await apiFetch('/v1/payment-intents', {
      body: { merchantId, externalPayableType: 'order', externalPayableId: 'order-chdr-001', currency: 'IDR', amountDue: 45000 },
      token: TOKEN,
    });
    const intentId = ((iRes.body as { data?: Record<string, unknown> })['data'] as { id: string })['id'];

    // Create QRIS payment
    const gpRes = await apiFetch(`/v1/payment-intents/${intentId}/gateway-payments`, {
      body: { merchantId, provider: 'fake_gateway', method: 'qris', amount: 45000, metadata: { scenario: 'qris' } },
      token: TOKEN,
    });
    assert.equal(gpRes.status, 201);
    const txId = ((gpRes.body as { data?: Record<string, unknown> })['data'] as { transaction: { id: string } })['transaction']['id'];

    // Confirm WITHOUT merchantId in body — use header only
    const { status, body } = await apiFetch(`/v1/dev/fake-gateway/transactions/${txId}/confirm`, {
      body: {}, // Empty body — merchantId comes from header
      token: TOKEN,
      merchantIdHeader: merchantId,
    });

    assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
    assert.equal((body as { ok?: unknown })['ok'], true);
    const data = (body as { data?: Record<string, unknown> })['data']!;
    assert.equal((data['transaction'] as Record<string, unknown>)['status'], 'succeeded');
    assert.equal((data['intent'] as Record<string, unknown>)['status'], 'paid');
  });

  // A11: Provider account POST includes providerAccountRef, excludes credentialsRef
  test('A11: POST provider account includes providerAccountRef, never credentialsRef in response', async () => {
    const mRes = await apiFetch('/v1/merchants', {
      body: { name: 'PA Ref Test', sourceApp: 'test', externalRef: 'par-001' },
      token: TOKEN,
    });
    const merchantId = ((mRes.body as { data?: Record<string, unknown> })['data'] as { id: string })['id'];

    const { status, body } = await apiFetch(`/v1/merchants/${merchantId}/provider-accounts`, {
      body: {
        provider: 'fake_gateway',
        environment: 'sandbox',
        providerAccountRef: 'fake-ref-xyz-001',
        credentialsRef: 'secret-vault://some/path',
      },
      token: TOKEN,
    });

    assert.equal(status, 201, `Expected 201, got ${status}: ${JSON.stringify(body)}`);
    const data = (body as { data?: Record<string, unknown> })['data']!;

    // providerAccountRef must be present
    assert.equal(data['providerAccountRef'], 'fake-ref-xyz-001', 'providerAccountRef should be in response');

    // credentialsRef must NOT be present
    assert.ok(!('credentialsRef' in data), 'credentialsRef must never appear in public API responses');

    // Also verify basic fields
    assert.equal(data['provider'], 'fake_gateway');
    assert.equal(data['merchantId'], merchantId);
    assert.equal(data['status'], 'active');
  });

  // A12: Provider account GET includes providerAccountRef, excludes credentialsRef
  test('A12: GET provider account includes providerAccountRef, never credentialsRef', async () => {
    const mRes = await apiFetch('/v1/merchants', {
      body: { name: 'PA Get Ref Test', sourceApp: 'test', externalRef: 'paget-001' },
      token: TOKEN,
    });
    const merchantId = ((mRes.body as { data?: Record<string, unknown> })['data'] as { id: string })['id'];

    const paRes = await apiFetch(`/v1/merchants/${merchantId}/provider-accounts`, {
      body: {
        provider: 'fake_gateway',
        environment: 'test',
        providerAccountRef: 'my-provider-ref-get',
        credentialsRef: 'secret://credentials',
      },
      token: TOKEN,
    });
    const paId = ((paRes.body as { data?: Record<string, unknown> })['data'] as { id: string })['id'];

    const { status, body } = await apiFetch(`/v1/merchants/${merchantId}/provider-accounts/${paId}`, {
      token: TOKEN,
    });

    assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
    const data = (body as { data?: Record<string, unknown> })['data']!;

    assert.equal(data['providerAccountRef'], 'my-provider-ref-get');
    assert.ok(!('credentialsRef' in data), 'credentialsRef must never appear in GET responses');
  });

  // A13: No tenantId in any response
  test('A13: Responses never expose tenantId or internal legacy fields', async () => {
    const mRes = await apiFetch('/v1/merchants', {
      body: { name: 'No TenantId Test', sourceApp: 'test', externalRef: 'ntid-001' },
      token: TOKEN,
    });
    const merchantId = ((mRes.body as { data?: Record<string, unknown> })['data'] as { id: string })['id'];

    // Check merchant response
    const mData = (mRes.body as { data?: Record<string, unknown> })['data']!;
    assert.ok(!('tenantId' in mData), 'Merchant response must not expose tenantId');

    // Check intent response
    const iRes = await apiFetch('/v1/payment-intents', {
      body: { merchantId, externalPayableType: 'order', externalPayableId: 'order-ntid-001', currency: 'IDR', amountDue: 25000 },
      token: TOKEN,
    });
    const iData = (iRes.body as { data?: Record<string, unknown> })['data']!;
    assert.ok(!('tenantId' in iData), 'Intent response must not expose tenantId');
    assert.ok(!('credentialsRef' in iData), 'Intent response must not expose credentialsRef');
  });

});
