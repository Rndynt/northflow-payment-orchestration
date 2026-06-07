/**
 * payment-orchestration-s7-5-hardening.test.ts
 *
 * Phase S7.5 Hardening — Additional tests covering all blocking issues fixed:
 *
 * A) Gateway validation fail-closed (Task 3)
 *    PM-NC01  Zero configured methods → PAYMENT_METHODS_NOT_CONFIGURED
 *    PM-NC02  Unsupported method status → PAYMENT_METHOD_DISABLED
 *    PM-NC03  Disabled method (explicit disabled) → PAYMENT_METHOD_DISABLED
 *    PM-NC04  Unknown method after any methods configured → PAYMENT_METHOD_NOT_AVAILABLE
 *    PM-NC05  Currency mismatch → PAYMENT_METHOD_CURRENCY_UNSUPPORTED
 *    PM-NC06  Amount below min → PAYMENT_METHOD_AMOUNT_OUT_OF_RANGE
 *    PM-NC07  Amount above max → PAYMENT_METHOD_AMOUNT_OUT_OF_RANGE
 *    PM-NC08  Valid active configured method → success (still works)
 *    PM-NC09  No methodRepo wired (legacy/test containers) → validation skipped (backward compat)
 *
 * B) Route fail-closed security (Task 4)
 *    PM-FC01  GET /v1/payment-intents/:id/payment-options — missing accessRepo → 503 SERVICE_MISCONFIGURED
 *    PM-FC02  GET /v1/merchants/:mid/payment-methods — missing accessRepo → 503 SERVICE_MISCONFIGURED
 *    PM-FC03  GET /v1/payment-intents/:id/payment-options — cross-merchant → 403 MERCHANT_ACCESS_DENIED
 *    PM-FC04  GET /v1/merchants/:mid/payment-methods — cross-merchant → 403 MERCHANT_ACCESS_DENIED
 *    PM-FC05  GET /v1/payment-intents/:id/payment-options — missing scope → 403 SCOPE_DENIED
 *    PM-FC06  GET /v1/merchants/:mid/payment-methods — missing scope → 403 SCOPE_DENIED
 *
 * C) Migration static check (Task 7 / Task 1+2)
 *    PM-MIG01  0007_po_provider_account_methods.sql must not contain ALTER TABLE ... ADD
 *    PM-MIG02  0007_supreme_wolfsbane.sql must not exist
 *    PM-MIG03  journal must reference 0007_po_provider_account_methods, not 0007_supreme_wolfsbane
 *
 * Run:
 *   npx tsx --tsconfig tests/tsconfig.json --test \
 *     tests/payment-orchestration-s7-5-hardening.test.ts
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

// ── Use cases under test ──────────────────────────────────────────────────────

import { CreateGatewayPayment } from '../apps/service/src/application/use-cases/CreateGatewayPayment.ts';
import { UpsertProviderAccountMethod } from '../apps/service/src/application/use-cases/UpsertProviderAccountMethod.ts';
import { createProviderRegistry } from '../apps/service/src/infrastructure/providers/providerRegistry.ts';

// ── App + Container ───────────────────────────────────────────────────────────

import { createApp } from '../apps/service/src/app.ts';
import type { ServiceContainer } from '../apps/service/src/container.ts';
import type { PaymentOrchestrationServiceConfig } from '../apps/service/src/config/env.ts';
import { CreateMerchant } from '../apps/service/src/application/use-cases/CreateMerchant.ts';
import { CreateProviderAccount } from '../apps/service/src/application/use-cases/CreateProviderAccount.ts';
import { CreatePaymentIntent } from '../apps/service/src/application/use-cases/CreatePaymentIntent.ts';
import { ConfirmFakeGatewayPayment } from '../apps/service/src/application/use-cases/ConfirmFakeGatewayPayment.ts';
import { GetPaymentIntentStatus } from '../apps/service/src/application/use-cases/GetPaymentIntentStatus.ts';
import { GetRefundability } from '../apps/service/src/application/use-cases/GetRefundability.ts';
import { HandleProviderWebhook } from '../apps/service/src/application/use-cases/HandleProviderWebhook.ts';
import { FakeGatewayWebhookHandler } from '../apps/service/src/infrastructure/providers/FakeGatewayWebhookHandler.ts';
import { FakeGatewayProvider } from '../apps/service/src/infrastructure/providers/FakeGatewayProvider.ts';

import {
  generateCredential,
  hashCredential,
} from '../apps/service/src/middleware/auth.ts';

import type {
  ProviderAccountPaymentMethodRepository,
  UpsertProviderAccountMethodInput,
  ProviderAccountPaymentMethod,
  ProviderAccountPaymentMethodStatus,
  PaymentMerchantRepository,
  PaymentProviderAccountRepository,
  PaymentIntentRepository,
  PaymentTransactionRepository,
  PaymentIdempotencyRepository,
  PaymentProviderEventRepository,
  ApiClientRepository,
  ClientCredentialRepository,
  ClientMerchantAccessRepository,
  PaymentMerchant,
  PaymentProviderAccount,
  PaymentIntentDTO,
  PaymentTransactionDTO,
  PaymentIdempotencyKeyDTO,
  PaymentProviderEventDTO,
  ApiClientDTO,
  ClientCredentialDTO,
  ClientMerchantAccessDTO,
  CreateApiClientInput,
  CreateClientCredentialInput,
  CreateClientMerchantAccessInput,
  ApiClientStatus,
} from '@northflow/payment-orchestration-core';

// ════════════════════════════════════════════════════════════════════
// IN-MEMORY REPOS (minimal — reused across sections)
// ════════════════════════════════════════════════════════════════════

class InMemoryMethodRepo implements ProviderAccountPaymentMethodRepository {
  private store = new Map<string, ProviderAccountPaymentMethod>();

  async findById(id: string) { return this.store.get(id) ?? null; }

  async listByMerchant(merchantId: string) {
    return [...this.store.values()]
      .filter((m) => m.merchantId === merchantId && m.status === 'active')
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  async listByProviderAccount(providerAccountId: string) {
    return [...this.store.values()]
      .filter((m) => m.providerAccountId === providerAccountId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  async findByProviderAccountAndMethod(providerAccountId: string, method: string) {
    return [...this.store.values()].find(
      (m) => m.providerAccountId === providerAccountId && m.method === method,
    ) ?? null;
  }

  async upsert(input: UpsertProviderAccountMethodInput): Promise<ProviderAccountPaymentMethod> {
    const existing = await this.findByProviderAccountAndMethod(input.providerAccountId, input.method);
    const now = new Date();
    const record: ProviderAccountPaymentMethod = {
      id: existing?.id ?? input.id,
      merchantId: input.merchantId,
      providerAccountId: input.providerAccountId,
      provider: input.provider,
      method: input.method,
      methodType: input.methodType ?? 'other',
      providerMethodCode: input.providerMethodCode ?? null,
      displayName: input.displayName,
      status: input.status ?? 'active',
      currency: input.currency ?? 'IDR',
      minAmount: input.minAmount ?? null,
      maxAmount: input.maxAmount ?? null,
      sortOrder: input.sortOrder ?? 0,
      publicConfig: input.publicConfig ?? {},
      providerMetadata: input.providerMetadata ?? {},
      metadata: input.metadata ?? {},
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.store.set(record.id, record);
    return record;
  }

  async updateStatus(id: string, status: ProviderAccountPaymentMethodStatus): Promise<ProviderAccountPaymentMethod> {
    const record = this.store.get(id);
    if (!record) throw new Error(`Method not found: ${id}`);
    const updated: ProviderAccountPaymentMethod = { ...record, status, updatedAt: new Date() };
    this.store.set(id, updated);
    return updated;
  }

  clear() { this.store.clear(); }
}

function makeProviderAccountRepo(providerAccounts: any[] = []) {
  const store = new Map(providerAccounts.map((pa) => [pa.id, pa]));
  return {
    findById: async (id: string, merchantId?: string) => {
      const pa = store.get(id);
      if (!pa) return null;
      if (merchantId && pa.merchantId !== merchantId) return null;
      return pa;
    },
    create: async (input: any) => { store.set(input.id, input); return input; },
    listByMerchant: async (merchantId: string) => [...store.values()].filter((p) => p.merchantId === merchantId),
  };
}

function makeIntentRepo(intents: any[] = []) {
  const store = new Map(intents.map((i) => [i.id, i]));
  return {
    findById: async (id: string, merchantId?: string) => {
      const intent = store.get(id);
      if (!intent) return null;
      if (merchantId && intent.merchantId !== merchantId) return null;
      return intent;
    },
    create: async (input: any) => { store.set(input.id, input); return input; },
    updateTotals: async (input: any) => { const i = store.get(input.id); if (i) Object.assign(i, input); return i; },
    updateStatus: async (input: any) => { const i = store.get(input.id); if (i) Object.assign(i, input); return i; },
  };
}

function makeMerchantRepo(merchants: any[] = []) {
  const store = new Map(merchants.map((m) => [m.id, m]));
  return {
    findById: async (id: string) => store.get(id) ?? null,
    create: async (input: any) => { store.set(input.id, input); return input; },
    findByExternalId: async () => null,
  };
}

function makeTxRepo() {
  const store = new Map<string, any>();
  return {
    create: async (input: any) => { store.set(input.id, input); return input; },
    findById: async (id: string) => store.get(id) ?? null,
    listByIntent: async () => [],
    findByProviderReference: async () => null,
    findByMerchantIdempotencyKey: async () => null,
  };
}

function makeIdempotencyRepo() {
  return {
    find: async () => null,
    reserve: async () => {},
    reserveOrGet: async () => ({ key: null, reserved: true }),
    markCompleted: async () => {},
    markFailed: async () => {},
  };
}

function makeMid() { return `mer_nc_${randomUUID().slice(0, 8)}`; }
function makePaId() { return `pa_nc_${randomUUID().slice(0, 8)}`; }

function makeProviderAccount(opts: { merchantId: string; paId?: string; provider?: string }) {
  return {
    id: opts.paId ?? makePaId(),
    merchantId: opts.merchantId,
    provider: opts.provider ?? 'fake_gateway',
    providerAccountRef: 'ref_test',
    environment: 'test',
    status: 'active',
    publicConfig: {},
    metadata: {},
    credentialsRef: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeIntent(opts: { merchantId: string; currency?: string; amountDue?: number }) {
  const amountDue = opts.amountDue ?? 100_000;
  return {
    id: `intent_${randomUUID().slice(0, 8)}`,
    merchantId: opts.merchantId,
    externalPayableType: 'order',
    externalPayableId: `order_${randomUUID().slice(0, 8)}`,
    currency: opts.currency ?? 'IDR',
    amountDue,
    amountPaid: 0,
    amountRefunded: 0,
    amountRemaining: amountDue,
    status: 'requires_payment',
    metadata: {},
    sourceApp: 'test',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeMerchant(merchantId: string) {
  return { id: merchantId, name: 'Test Merchant', status: 'active', metadata: {}, createdAt: new Date(), updatedAt: new Date() };
}

// ════════════════════════════════════════════════════════════════════
// IN-MEMORY AUTH REPOS (for HTTP route tests)
// ════════════════════════════════════════════════════════════════════

class InMemoryMerchantRepo2 implements PaymentMerchantRepository {
  readonly store = new Map<string, PaymentMerchant>();
  async findById(id: string) { return this.store.get(id) ?? null; }
  async findByExternalRef() { return null; }
  async create(input: any): Promise<PaymentMerchant> {
    const now = new Date();
    const m: PaymentMerchant = { id: input.id, displayName: input.name, legalName: null, externalRef: null, sourceApp: null, status: 'active', metadata: {}, createdAt: now, updatedAt: now };
    this.store.set(m.id, m);
    return m;
  }
  async updateStatus(id: string, status: PaymentMerchant['status']): Promise<PaymentMerchant> {
    const m = this.store.get(id)!;
    const u = { ...m, status, updatedAt: new Date() };
    this.store.set(id, u);
    return u;
  }
}

class InMemoryProviderAccountRepo2 implements PaymentProviderAccountRepository {
  private readonly store = new Map<string, PaymentProviderAccount>();
  async findById(id: string, merchantId: string) { const pa = this.store.get(id); return (!pa || pa.merchantId !== merchantId) ? null : pa; }
  async findByMerchantAndProvider() { return null; }
  async create(input: any): Promise<PaymentProviderAccount> {
    const now = new Date();
    const pa: PaymentProviderAccount = { id: input.id, merchantId: input.merchantId, provider: input.provider, environment: input.environment ?? 'test', providerAccountRef: null, credentialsRef: null, publicConfig: {}, status: 'active', metadata: {}, createdAt: now, updatedAt: now };
    this.store.set(pa.id, pa);
    return pa;
  }
  async updateStatus(id: string, merchantId: string, status: PaymentProviderAccount['status']): Promise<PaymentProviderAccount> {
    const pa = this.store.get(id)!;
    const u = { ...pa, status, updatedAt: new Date() };
    this.store.set(id, u);
    return u;
  }
}

class InMemoryIntentRepo2 implements PaymentIntentRepository {
  readonly store = new Map<string, PaymentIntentDTO>();
  async findById(id: string, merchantId: string) { const i = this.store.get(id); return (!i || i.merchantId !== merchantId) ? null : i; }
  async findByExternalPayable() { return null; }
  async create(input: any): Promise<PaymentIntentDTO> {
    const now = new Date();
    const i: PaymentIntentDTO = { id: input.id, merchantId: input.merchantId, providerAccountId: null, sourceApp: null, externalTenantId: null, externalOutletId: null, externalLocationId: null, externalPayableType: input.externalPayableType, externalPayableId: input.externalPayableId, amountDue: input.amountDue, amountPaid: 0, amountRefunded: 0, amountRemaining: input.amountDue, currency: input.currency ?? 'IDR', status: 'requires_payment', allowPartial: false, expiresAt: null, metadata: {}, createdAt: now, updatedAt: now };
    this.store.set(i.id, i);
    return i;
  }
  async updateTotals(input: any) { const i = this.store.get(input.id)!; const u = { ...i, ...input, updatedAt: new Date() }; this.store.set(input.id, u); return u; }
  async updateStatus(input: any) { const i = this.store.get(input.id)!; const u = { ...i, status: input.status, updatedAt: new Date() }; this.store.set(input.id, u); return u; }
}

class StubTxRepo implements PaymentTransactionRepository {
  readonly store = new Map<string, PaymentTransactionDTO>();
  async findById() { return null; }
  async findByIntentId() { return []; }
  async findByProviderReference() { return null; }
  async findByMerchantIdempotencyKey() { return null; }
  async create(input: any): Promise<PaymentTransactionDTO> {
    const now = new Date();
    const t: PaymentTransactionDTO = { id: input.id, merchantId: input.merchantId, intentId: input.intentId, providerAccountId: null, provider: input.provider, method: input.method, transactionType: input.transactionType, direction: input.direction, status: input.status, amount: input.amount, currency: input.currency ?? 'IDR', parentTransactionId: null, providerReference: input.providerReference ?? null, providerEventId: null, providerPaymentUrl: null, providerQrString: null, failureReason: null, idempotencyKey: null, expiresAt: null, metadata: {}, rawProviderResponse: null, createdAt: now, updatedAt: now };
    this.store.set(t.id, t);
    return t;
  }
  async updateStatus(input: any) { const t = this.store.get(input.id)!; const u = { ...t, status: input.status, updatedAt: new Date() }; this.store.set(input.id, u); return u; }
  async sumSucceededRefundsByParent() { return 0; }
  async markSucceededIfConfirmable() { return { transaction: null, changed: false }; }
}

class StubIdempotencyRepo implements PaymentIdempotencyRepository {
  async reserve(input: any): Promise<PaymentIdempotencyKeyDTO> { return { id: input.id, merchantId: input.merchantId, scope: input.scope, idempotencyKey: input.idempotencyKey, requestHash: input.requestHash, responseSnapshot: null, resourceType: null, resourceId: null, status: 'processing', createdAt: new Date(), updatedAt: new Date(), expiresAt: null }; }
  async find() { return null; }
  async markCompleted() {}
  async markFailed() {}
}

class StubProviderEventRepo implements PaymentProviderEventRepository {
  async reserveEvent(): Promise<PaymentProviderEventDTO> { throw new Error('not implemented'); }
  async findByProviderEventId() { return null; }
  async assignMerchant() {}
  async markProcessed() {}
  async markFailed() {}
  async findStalePending() { return []; }
}

class InMemoryApiClientRepo2 implements ApiClientRepository {
  private readonly store = new Map<string, ApiClientDTO>();
  async findById(id: string) { return this.store.get(id) ?? null; }
  async create(input: CreateApiClientInput): Promise<ApiClientDTO> {
    const now = new Date();
    const c: ApiClientDTO = { id: input.id, name: input.name, sourceApp: input.sourceApp, environment: input.environment, status: (input.status ?? 'active') as ApiClientStatus, scopes: input.scopes ?? [], metadata: input.metadata ?? {}, createdAt: now, updatedAt: now };
    this.store.set(c.id, c);
    return c;
  }
  async updateStatus(id: string, status: ApiClientStatus) { const c = this.store.get(id)!; const u = { ...c, status, updatedAt: new Date() }; this.store.set(id, u); return u; }
}

class InMemoryCredentialRepo2 implements ClientCredentialRepository {
  readonly store: ClientCredentialDTO[] = [];
  async findByPrefix(prefix: string) { return this.store.filter(c => c.credentialPrefix === prefix); }
  async findById(id: string) { return this.store.find(c => c.id === id) ?? null; }
  async listByClientId(clientId: string) { return this.store.filter(c => c.clientId === clientId); }
  async create(input: CreateClientCredentialInput): Promise<ClientCredentialDTO> {
    const now = new Date();
    const c: ClientCredentialDTO = { id: input.id, clientId: input.clientId, credentialPrefix: input.credentialPrefix, credentialHash: input.credentialHash, status: 'active', expiresAt: null, lastUsedAt: null, createdAt: now, revokedAt: null };
    this.store.push(c);
    return c;
  }
  async revoke(id: string) { const c = this.store.find(c => c.id === id); if (c) (c as any).status = 'revoked'; }
  async touchLastUsed() {}
}

class InMemoryAccessRepo2 implements ClientMerchantAccessRepository {
  private readonly store: ClientMerchantAccessDTO[] = [];
  async findByClientAndMerchant(clientId: string, merchantId: string) { return this.store.find(g => g.clientId === clientId && g.merchantId === merchantId) ?? null; }
  async findByClient(clientId: string) { return this.store.filter(g => g.clientId === clientId); }
  async create(input: CreateClientMerchantAccessInput): Promise<ClientMerchantAccessDTO> {
    const g: ClientMerchantAccessDTO = { id: input.id, clientId: input.clientId, merchantId: input.merchantId, scopes: input.scopes, status: 'active', createdAt: new Date(), revokedAt: null };
    this.store.push(g);
    return g;
  }
  async revoke(id: string) { const g = this.store.find(g => g.id === id); if (g) (g as any).status = 'revoked'; }
  grant(clientId: string, merchantId: string, scopes: string[]) {
    this.store.push({ id: randomUUID(), clientId, merchantId, scopes, status: 'active', createdAt: new Date(), revokedAt: null });
  }
}

// ════════════════════════════════════════════════════════════════════
// TEST CONTAINER FACTORY
// ════════════════════════════════════════════════════════════════════

type BuildContainerOpts = {
  /** If true, authRepos is set to undefined (simulates misconfigured container) */
  omitAuthRepos?: boolean;
  /** If true, clientMerchantAccessRepo is omitted from authRepos (fail-closed test) */
  omitAccessRepo?: boolean;
  methodRepo?: InMemoryMethodRepo;
};

function buildRouteTestContainer(opts: BuildContainerOpts = {}): {
  container: ServiceContainer;
  accessRepo: InMemoryAccessRepo2;
  intentRepo: InMemoryIntentRepo2;
  seedClient: (id: string, scopes: string[], sourceApp?: string) => { raw: string };
} {
  const merchantRepo = new InMemoryMerchantRepo2();
  const providerAccountRepo = new InMemoryProviderAccountRepo2();
  const intentRepo = new InMemoryIntentRepo2();
  const transactionRepo = new StubTxRepo();
  const idempotencyRepo = new StubIdempotencyRepo();
  const providerEventRepo = new StubProviderEventRepo();
  const methodRepo = opts.methodRepo ?? new InMemoryMethodRepo();

  const apiClientRepo = new InMemoryApiClientRepo2();
  const credentialRepo = new InMemoryCredentialRepo2();
  const accessRepo = new InMemoryAccessRepo2();

  const fakeGateway = new FakeGatewayProvider();
  const providerRegistry = new Map([[fakeGateway.providerCode, fakeGateway]]);
  const fakeGatewayWebhookHandler = new FakeGatewayWebhookHandler({ nodeEnv: 'test' });

  const config: PaymentOrchestrationServiceConfig = {
    port: 0,
    nodeEnv: 'test',
    serviceToken: 'test-svc-token',
    dbUrl: '',
    version: '0.3.0',
    phase: 'S7.5-hardening',
    legacyServiceTokenEnabled: false,
  };

  const useCases = {
    createMerchant: new CreateMerchant(merchantRepo),
    createProviderAccount: new CreateProviderAccount(merchantRepo, providerAccountRepo),
    createPaymentIntent: new CreatePaymentIntent(merchantRepo, intentRepo, idempotencyRepo),
    createGatewayPayment: new CreateGatewayPayment(merchantRepo, intentRepo, transactionRepo, providerRegistry, providerAccountRepo, idempotencyRepo, 'test'),
    confirmFakeGatewayPayment: new ConfirmFakeGatewayPayment(transactionRepo, intentRepo, 'test'),
    getPaymentIntentStatus: new GetPaymentIntentStatus(intentRepo, transactionRepo),
    getRefundability: new GetRefundability(intentRepo, transactionRepo),
    handleProviderWebhook: new HandleProviderWebhook(transactionRepo, intentRepo, providerEventRepo, fakeGatewayWebhookHandler),
    reconcilePaymentIntentTotals: {} as any,
    refreshProviderStatus: {} as any,
    refundPaymentTransaction: {} as any,
    voidPaymentTransaction: {} as any,
  };

  let authRepos: ServiceContainer['authRepos'];
  if (!opts.omitAuthRepos) {
    authRepos = {
      apiClientRepo,
      clientCredentialRepo: credentialRepo,
      clientMerchantAccessRepo: opts.omitAccessRepo ? undefined as any : accessRepo,
    };
  }

  const container: ServiceContainer = {
    config,
    db: null as any,
    repos: { merchantRepo, providerAccountRepo, intentRepo, transactionRepo, providerEventRepo, idempotencyRepo },
    authRepos,
    providerRegistry,
    useCases,
    providerAccountMethodRepo: methodRepo,
  };

  function seedClient(clientId: string, scopes: string[], sourceApp = 'testapp') {
    const credentialId = randomUUID().replace(/-/g, '');
    const { raw, prefix, hash } = generateCredential('live', credentialId);
    apiClientRepo.create({ id: clientId, name: `Client ${clientId}`, sourceApp, environment: 'live', scopes, status: 'active' }).catch(() => {});
    credentialRepo.store.push({ id: credentialId, clientId, credentialPrefix: prefix, credentialHash: hash, status: 'active', expiresAt: null, lastUsedAt: null, createdAt: new Date(), revokedAt: null });
    return { raw };
  }

  return { container, accessRepo, intentRepo, seedClient };
}

async function startServer(container: ServiceContainer): Promise<{ server: http.Server; baseUrl: string }> {
  const app = createApp(container);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;
  return { server, baseUrl: `http://localhost:${port}` };
}

async function stopServer(server: http.Server): Promise<void> {
  return new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
}

async function httpGet(
  baseUrl: string,
  path: string,
  opts: { bearer?: string; merchantId?: string } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.bearer) headers['authorization'] = `Bearer ${opts.bearer}`;
  if (opts.merchantId) headers['x-payment-merchant-id'] = opts.merchantId;
  const response = await fetch(`${baseUrl}${path}`, { headers });
  const body = await response.json() as Record<string, unknown>;
  return { status: response.status, body };
}

function errCode(body: Record<string, unknown>): string {
  const err = body['error'];
  if (typeof err === 'object' && err !== null) return (err as any)['code'] as string;
  return String(err);
}

// ════════════════════════════════════════════════════════════════════
// A. GATEWAY VALIDATION FAIL-CLOSED TESTS (Task 3)
// ════════════════════════════════════════════════════════════════════

describe('S7.5 Hardening: CreateGatewayPayment fail-closed validation', () => {

  // PM-NC01 ──────────────────────────────────────────────────────────────────
  test('PM-NC01: PAYMENT_METHODS_NOT_CONFIGURED when provider account has zero configured methods', async () => {
    const merchantId = makeMid();
    const merchant = makeMerchant(merchantId);
    const pa = makeProviderAccount({ merchantId, provider: 'fake_gateway' });
    const paRepo = makeProviderAccountRepo([pa]);
    const methodRepo = new InMemoryMethodRepo();
    const registry = createProviderRegistry('test', { xenditSandboxEnabled: false, xenditBaseUrl: undefined });

    // methodRepo wired but NO methods configured for this PA → fail closed
    const intent = makeIntent({ merchantId, currency: 'IDR', amountDue: 100_000 });
    const intentRepo = makeIntentRepo([intent]);
    const merchantRepo = makeMerchantRepo([merchant]);

    const uc = new CreateGatewayPayment(
      merchantRepo as any, intentRepo as any, makeTxRepo() as any,
      registry as any, paRepo as any, makeIdempotencyRepo() as any, 'test', methodRepo,
    );

    await assert.rejects(
      () => uc.execute({
        merchantId, intentId: intent.id, provider: 'fake_gateway',
        method: 'qris', amount: 100_000, providerAccountId: pa.id,
      }),
      (err: any) => {
        assert.equal(err.code, 'PAYMENT_METHODS_NOT_CONFIGURED',
          `Expected PAYMENT_METHODS_NOT_CONFIGURED, got ${err.code}: ${err.message}`);
        assert.equal(err.statusCode, 422);
        return true;
      },
    );
  });

  // PM-NC02 ──────────────────────────────────────────────────────────────────
  test('PM-NC02: PAYMENT_METHOD_DISABLED when method status is unsupported', async () => {
    const merchantId = makeMid();
    const merchant = makeMerchant(merchantId);
    const pa = makeProviderAccount({ merchantId, provider: 'fake_gateway' });
    const paRepo = makeProviderAccountRepo([pa]);
    const methodRepo = new InMemoryMethodRepo();
    const registry = createProviderRegistry('test', { xenditSandboxEnabled: false, xenditBaseUrl: undefined });

    const upsertUC = new UpsertProviderAccountMethod(paRepo as any, methodRepo);
    const m = await upsertUC.execute({
      merchantId, providerAccountId: pa.id, method: 'qris',
      displayName: 'QRIS', status: 'active', currency: 'IDR',
    });
    // Set status to 'unsupported' (not 'active') — must reject with PAYMENT_METHOD_DISABLED
    await methodRepo.updateStatus(m.method.id, 'unsupported' as any);

    const intent = makeIntent({ merchantId, currency: 'IDR', amountDue: 100_000 });
    const intentRepo = makeIntentRepo([intent]);
    const merchantRepo = makeMerchantRepo([merchant]);

    const uc = new CreateGatewayPayment(
      merchantRepo as any, intentRepo as any, makeTxRepo() as any,
      registry as any, paRepo as any, makeIdempotencyRepo() as any, 'test', methodRepo,
    );

    await assert.rejects(
      () => uc.execute({
        merchantId, intentId: intent.id, provider: 'fake_gateway',
        method: 'qris', amount: 100_000, providerAccountId: pa.id,
      }),
      (err: any) => {
        assert.equal(err.code, 'PAYMENT_METHOD_DISABLED',
          `Expected PAYMENT_METHOD_DISABLED for unsupported status, got ${err.code}`);
        assert.equal(err.statusCode, 422);
        return true;
      },
    );
  });

  // PM-NC03 ──────────────────────────────────────────────────────────────────
  test('PM-NC03: PAYMENT_METHOD_DISABLED when method status is explicitly disabled', async () => {
    const merchantId = makeMid();
    const merchant = makeMerchant(merchantId);
    const pa = makeProviderAccount({ merchantId, provider: 'fake_gateway' });
    const paRepo = makeProviderAccountRepo([pa]);
    const methodRepo = new InMemoryMethodRepo();
    const registry = createProviderRegistry('test', { xenditSandboxEnabled: false, xenditBaseUrl: undefined });

    const upsertUC = new UpsertProviderAccountMethod(paRepo as any, methodRepo);
    const m = await upsertUC.execute({
      merchantId, providerAccountId: pa.id, method: 'va_bca',
      displayName: 'VA BCA', status: 'active', currency: 'IDR',
    });
    await methodRepo.updateStatus(m.method.id, 'disabled');

    const intent = makeIntent({ merchantId, currency: 'IDR', amountDue: 100_000 });
    const intentRepo = makeIntentRepo([intent]);
    const merchantRepo = makeMerchantRepo([merchant]);

    const uc = new CreateGatewayPayment(
      merchantRepo as any, intentRepo as any, makeTxRepo() as any,
      registry as any, paRepo as any, makeIdempotencyRepo() as any, 'test', methodRepo,
    );

    await assert.rejects(
      () => uc.execute({
        merchantId, intentId: intent.id, provider: 'fake_gateway',
        method: 'va_bca', amount: 100_000, providerAccountId: pa.id,
      }),
      (err: any) => {
        assert.equal(err.code, 'PAYMENT_METHOD_DISABLED');
        return true;
      },
    );
  });

  // PM-NC04 ──────────────────────────────────────────────────────────────────
  test('PM-NC04: PAYMENT_METHOD_NOT_AVAILABLE when method not in DB but other methods exist', async () => {
    const merchantId = makeMid();
    const merchant = makeMerchant(merchantId);
    const pa = makeProviderAccount({ merchantId, provider: 'fake_gateway' });
    const paRepo = makeProviderAccountRepo([pa]);
    const methodRepo = new InMemoryMethodRepo();
    const registry = createProviderRegistry('test', { xenditSandboxEnabled: false, xenditBaseUrl: undefined });

    // Seed a different method so the PA has configured methods (triggers validation)
    const upsertUC = new UpsertProviderAccountMethod(paRepo as any, methodRepo);
    await upsertUC.execute({
      merchantId, providerAccountId: pa.id, method: 'qris',
      displayName: 'QRIS', status: 'active', currency: 'IDR',
    });

    const intent = makeIntent({ merchantId, currency: 'IDR', amountDue: 100_000 });
    const intentRepo = makeIntentRepo([intent]);
    const merchantRepo = makeMerchantRepo([merchant]);

    const uc = new CreateGatewayPayment(
      merchantRepo as any, intentRepo as any, makeTxRepo() as any,
      registry as any, paRepo as any, makeIdempotencyRepo() as any, 'test', methodRepo,
    );

    await assert.rejects(
      () => uc.execute({
        merchantId, intentId: intent.id, provider: 'fake_gateway',
        method: 'unknown_channel', amount: 100_000, providerAccountId: pa.id,
      }),
      (err: any) => {
        assert.equal(err.code, 'PAYMENT_METHOD_NOT_AVAILABLE');
        return true;
      },
    );
  });

  // PM-NC05 ──────────────────────────────────────────────────────────────────
  test('PM-NC05: PAYMENT_METHOD_CURRENCY_UNSUPPORTED when intent currency differs from method currency', async () => {
    const merchantId = makeMid();
    const merchant = makeMerchant(merchantId);
    const pa = makeProviderAccount({ merchantId, provider: 'fake_gateway' });
    const paRepo = makeProviderAccountRepo([pa]);
    const methodRepo = new InMemoryMethodRepo();
    const registry = createProviderRegistry('test', { xenditSandboxEnabled: false, xenditBaseUrl: undefined });

    const upsertUC = new UpsertProviderAccountMethod(paRepo as any, methodRepo);
    await upsertUC.execute({
      merchantId, providerAccountId: pa.id, method: 'qris',
      displayName: 'QRIS', status: 'active', currency: 'IDR',
    });

    // Intent in USD, method only supports IDR
    const intent = makeIntent({ merchantId, currency: 'USD', amountDue: 100 });
    const intentRepo = makeIntentRepo([intent]);
    const merchantRepo = makeMerchantRepo([merchant]);

    const uc = new CreateGatewayPayment(
      merchantRepo as any, intentRepo as any, makeTxRepo() as any,
      registry as any, paRepo as any, makeIdempotencyRepo() as any, 'test', methodRepo,
    );

    await assert.rejects(
      () => uc.execute({
        merchantId, intentId: intent.id, provider: 'fake_gateway',
        method: 'qris', amount: 100, providerAccountId: pa.id,
      }),
      (err: any) => {
        assert.equal(err.code, 'PAYMENT_METHOD_CURRENCY_UNSUPPORTED');
        return true;
      },
    );
  });

  // PM-NC06 ──────────────────────────────────────────────────────────────────
  test('PM-NC06: PAYMENT_METHOD_AMOUNT_OUT_OF_RANGE when amount is below minAmount', async () => {
    const merchantId = makeMid();
    const merchant = makeMerchant(merchantId);
    const pa = makeProviderAccount({ merchantId, provider: 'fake_gateway' });
    const paRepo = makeProviderAccountRepo([pa]);
    const methodRepo = new InMemoryMethodRepo();
    const registry = createProviderRegistry('test', { xenditSandboxEnabled: false, xenditBaseUrl: undefined });

    const upsertUC = new UpsertProviderAccountMethod(paRepo as any, methodRepo);
    await upsertUC.execute({
      merchantId, providerAccountId: pa.id, method: 'va_bca',
      displayName: 'VA BCA', status: 'active', currency: 'IDR',
      minAmount: 10_000, maxAmount: null,
    });

    const intent = makeIntent({ merchantId, currency: 'IDR', amountDue: 5_000 });
    const intentRepo = makeIntentRepo([intent]);
    const merchantRepo = makeMerchantRepo([merchant]);

    const uc = new CreateGatewayPayment(
      merchantRepo as any, intentRepo as any, makeTxRepo() as any,
      registry as any, paRepo as any, makeIdempotencyRepo() as any, 'test', methodRepo,
    );

    await assert.rejects(
      () => uc.execute({
        merchantId, intentId: intent.id, provider: 'fake_gateway',
        method: 'va_bca', amount: 5_000, providerAccountId: pa.id,
      }),
      (err: any) => {
        assert.equal(err.code, 'PAYMENT_METHOD_AMOUNT_OUT_OF_RANGE');
        return true;
      },
    );
  });

  // PM-NC07 ──────────────────────────────────────────────────────────────────
  test('PM-NC07: PAYMENT_METHOD_AMOUNT_OUT_OF_RANGE when amount exceeds maxAmount', async () => {
    const merchantId = makeMid();
    const merchant = makeMerchant(merchantId);
    const pa = makeProviderAccount({ merchantId, provider: 'fake_gateway' });
    const paRepo = makeProviderAccountRepo([pa]);
    const methodRepo = new InMemoryMethodRepo();
    const registry = createProviderRegistry('test', { xenditSandboxEnabled: false, xenditBaseUrl: undefined });

    const upsertUC = new UpsertProviderAccountMethod(paRepo as any, methodRepo);
    await upsertUC.execute({
      merchantId, providerAccountId: pa.id, method: 'gopay',
      displayName: 'GoPay', status: 'active', currency: 'IDR',
      minAmount: 1, maxAmount: 2_000_000,
    });

    const intent = makeIntent({ merchantId, currency: 'IDR', amountDue: 5_000_000 });
    const intentRepo = makeIntentRepo([intent]);
    const merchantRepo = makeMerchantRepo([merchant]);

    const uc = new CreateGatewayPayment(
      merchantRepo as any, intentRepo as any, makeTxRepo() as any,
      registry as any, paRepo as any, makeIdempotencyRepo() as any, 'test', methodRepo,
    );

    await assert.rejects(
      () => uc.execute({
        merchantId, intentId: intent.id, provider: 'fake_gateway',
        method: 'gopay', amount: 5_000_000, providerAccountId: pa.id,
      }),
      (err: any) => {
        assert.equal(err.code, 'PAYMENT_METHOD_AMOUNT_OUT_OF_RANGE');
        return true;
      },
    );
  });

  // PM-NC08 ──────────────────────────────────────────────────────────────────
  test('PM-NC08: succeeds when valid active method is configured and amount/currency match', async () => {
    const merchantId = makeMid();
    const merchant = makeMerchant(merchantId);
    const pa = makeProviderAccount({ merchantId, provider: 'fake_gateway' });
    const paRepo = makeProviderAccountRepo([pa]);
    const methodRepo = new InMemoryMethodRepo();
    const registry = createProviderRegistry('test', { xenditSandboxEnabled: false, xenditBaseUrl: undefined });

    const upsertUC = new UpsertProviderAccountMethod(paRepo as any, methodRepo);
    await upsertUC.execute({
      merchantId, providerAccountId: pa.id, method: 'qris',
      displayName: 'QRIS', status: 'active', currency: 'IDR',
      minAmount: 1, maxAmount: 10_000_000,
    });

    const intent = makeIntent({ merchantId, currency: 'IDR', amountDue: 100_000 });
    const intentRepo = makeIntentRepo([intent]);
    const merchantRepo = makeMerchantRepo([merchant]);

    const uc = new CreateGatewayPayment(
      merchantRepo as any, intentRepo as any, makeTxRepo() as any,
      registry as any, paRepo as any, makeIdempotencyRepo() as any, 'test', methodRepo,
    );

    const result = await uc.execute({
      merchantId, intentId: intent.id, provider: 'fake_gateway',
      method: 'qris', amount: 100_000, providerAccountId: pa.id,
    });

    assert.ok(result.transaction, 'transaction should be returned');
    assert.equal(result.transaction.method, 'qris');
  });

  // PM-NC09 ──────────────────────────────────────────────────────────────────
  test('PM-NC09: validation skipped when methodRepo is not wired (backward compat for legacy/test containers)', async () => {
    const merchantId = makeMid();
    const merchant = makeMerchant(merchantId);
    const pa = makeProviderAccount({ merchantId, provider: 'fake_gateway' });
    const paRepo = makeProviderAccountRepo([pa]);
    const registry = createProviderRegistry('test', { xenditSandboxEnabled: false, xenditBaseUrl: undefined });

    const intent = makeIntent({ merchantId, currency: 'IDR', amountDue: 100_000 });
    const intentRepo = makeIntentRepo([intent]);
    const merchantRepo = makeMerchantRepo([merchant]);

    // NO methodRepo passed (undefined) — legacy container behavior
    const uc = new CreateGatewayPayment(
      merchantRepo as any, intentRepo as any, makeTxRepo() as any,
      registry as any, paRepo as any, makeIdempotencyRepo() as any, 'test',
      // methodRepo intentionally omitted
    );

    const result = await uc.execute({
      merchantId, intentId: intent.id, provider: 'fake_gateway',
      method: 'any_method', amount: 100_000, providerAccountId: pa.id,
    });

    assert.ok(result.transaction, 'validation skipped — legacy container should succeed');
  });
});

// ════════════════════════════════════════════════════════════════════
// B. ROUTE FAIL-CLOSED TESTS (Task 4)
// ════════════════════════════════════════════════════════════════════

describe('S7.5 Hardening: Route fail-closed security (HTTP)', () => {
  let server: http.Server;
  let baseUrl: string;
  let accessRepo: InMemoryAccessRepo2;
  let intentRepo: InMemoryIntentRepo2;
  let methodRepo: InMemoryMethodRepo;

  // Client credentials
  let normalClientToken: string;
  let crossClientToken: string;
  let narrowScopeToken: string;

  const merchantId = `mer_fc_${randomUUID().slice(0, 8)}`;
  const otherMerchantId = `mer_fc_${randomUUID().slice(0, 8)}`;
  let intentId: string;

  // ── Container WITH accessRepo (for MERCHANT_ACCESS_DENIED and SCOPE_DENIED tests)
  let serverWithAccessRepo: http.Server;
  let baseUrlWithAccess: string;
  let accessRepoFull: InMemoryAccessRepo2;
  let normalClientTokenFull: string;
  let crossClientTokenFull: string;
  let narrowScopeTokenFull: string;

  before(async () => {
    methodRepo = new InMemoryMethodRepo();

    // ── Server 1: omitAccessRepo=true → SERVICE_MISCONFIGURED for normal clients
    const { container: containerNoAccess, accessRepo: ar, intentRepo: ir, seedClient } = buildRouteTestContainer({
      omitAccessRepo: true,
      methodRepo,
    });
    accessRepo = ar;
    intentRepo = ir;

    // Seed an intent for payment-options tests
    intentId = `intent_fc_${randomUUID().slice(0, 8)}`;
    await intentRepo.create({
      id: intentId,
      merchantId,
      externalPayableType: 'order',
      externalPayableId: `order_fc_${randomUUID().slice(0, 8)}`,
      amountDue: 100_000,
      currency: 'IDR',
    });

    const { raw } = seedClient(`client-fc-normal`, ['payment_method:read', 'intent:read']);
    normalClientToken = raw;

    const res = await startServer(containerNoAccess);
    server = res.server;
    baseUrl = res.baseUrl;

    // ── Server 2: WITH full accessRepo → for MERCHANT_ACCESS_DENIED and SCOPE_DENIED tests
    const {
      container: containerWithAccess,
      accessRepo: ar2,
      intentRepo: ir2,
      seedClient: seedClient2,
    } = buildRouteTestContainer({ methodRepo });
    accessRepoFull = ar2;

    // Seed intent in second repo
    await ir2.create({
      id: intentId,
      merchantId,
      externalPayableType: 'order',
      externalPayableId: `order_fc2_${randomUUID().slice(0, 8)}`,
      amountDue: 100_000,
      currency: 'IDR',
    });

    const { raw: rawFull } = seedClient2(`client-fc-full`, ['payment_method:read', 'intent:read']);
    normalClientTokenFull = rawFull;

    const { raw: rawCross } = seedClient2(`client-fc-cross`, ['payment_method:read', 'intent:read']);
    crossClientTokenFull = rawCross;
    // Grant cross client access to otherMerchant only, NOT to merchantId → MERCHANT_ACCESS_DENIED
    accessRepoFull.grant('client-fc-cross', otherMerchantId, ['payment_method:read', 'intent:read']);

    const { raw: rawNarrow } = seedClient2(`client-fc-narrow`, ['payment_method:read', 'intent:read']);
    narrowScopeTokenFull = rawNarrow;
    // Grant narrow client access to merchantId, but with restricted scope
    accessRepoFull.grant('client-fc-narrow', merchantId, ['merchant:read']); // NOT payment_method:read or intent:read

    // Grant full client access to merchantId
    accessRepoFull.grant('client-fc-full', merchantId, ['payment_method:read', 'intent:read']);

    const res2 = await startServer(containerWithAccess);
    serverWithAccessRepo = res2.server;
    baseUrlWithAccess = res2.baseUrl;
  });

  after(async () => {
    await stopServer(server);
    await stopServer(serverWithAccessRepo);
  });

  // PM-FC01 ──────────────────────────────────────────────────────────────────
  test('PM-FC01: GET /payment-options — missing accessRepo → 503 SERVICE_MISCONFIGURED', async () => {
    const res = await httpGet(baseUrl,
      `/v1/payment-intents/${intentId}/payment-options?merchantId=${merchantId}`,
      { bearer: normalClientToken },
    );
    assert.equal(res.status, 503,
      `Expected 503 SERVICE_MISCONFIGURED, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(errCode(res.body), 'SERVICE_MISCONFIGURED');
  });

  // PM-FC02 ──────────────────────────────────────────────────────────────────
  test('PM-FC02: GET /payment-methods — missing accessRepo → 503 SERVICE_MISCONFIGURED', async () => {
    const res = await httpGet(baseUrl,
      `/v1/merchants/${merchantId}/payment-methods`,
      { bearer: normalClientToken },
    );
    assert.equal(res.status, 503,
      `Expected 503 SERVICE_MISCONFIGURED, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(errCode(res.body), 'SERVICE_MISCONFIGURED');
  });

  // PM-FC03 ──────────────────────────────────────────────────────────────────
  test('PM-FC03: GET /payment-options — cross-merchant access → 403 MERCHANT_ACCESS_DENIED', async () => {
    // crossClientToken has access to otherMerchantId only, NOT to merchantId
    const res = await httpGet(baseUrlWithAccess,
      `/v1/payment-intents/${intentId}/payment-options?merchantId=${merchantId}`,
      { bearer: crossClientTokenFull },
    );
    assert.equal(res.status, 403,
      `Expected 403 MERCHANT_ACCESS_DENIED, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(errCode(res.body), 'MERCHANT_ACCESS_DENIED');
  });

  // PM-FC04 ──────────────────────────────────────────────────────────────────
  test('PM-FC04: GET /payment-methods — cross-merchant access → 403 MERCHANT_ACCESS_DENIED', async () => {
    const res = await httpGet(baseUrlWithAccess,
      `/v1/merchants/${merchantId}/payment-methods`,
      { bearer: crossClientTokenFull },
    );
    assert.equal(res.status, 403,
      `Expected 403 MERCHANT_ACCESS_DENIED, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(errCode(res.body), 'MERCHANT_ACCESS_DENIED');
  });

  // PM-FC05 ──────────────────────────────────────────────────────────────────
  test('PM-FC05: GET /payment-options — grant scope mismatch → 403 SCOPE_DENIED', async () => {
    // narrowScopeToken has grant for merchantId but scope is 'merchant:read', NOT 'payment_method:read' or 'intent:read'
    const res = await httpGet(baseUrlWithAccess,
      `/v1/payment-intents/${intentId}/payment-options?merchantId=${merchantId}`,
      { bearer: narrowScopeTokenFull },
    );
    assert.equal(res.status, 403,
      `Expected 403 SCOPE_DENIED, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(errCode(res.body), 'SCOPE_DENIED');
  });

  // PM-FC06 ──────────────────────────────────────────────────────────────────
  test('PM-FC06: GET /payment-methods — grant scope mismatch → 403 SCOPE_DENIED', async () => {
    const res = await httpGet(baseUrlWithAccess,
      `/v1/merchants/${merchantId}/payment-methods`,
      { bearer: narrowScopeTokenFull },
    );
    assert.equal(res.status, 403,
      `Expected 403 SCOPE_DENIED, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(errCode(res.body), 'SCOPE_DENIED');
  });
});

// ════════════════════════════════════════════════════════════════════
// C. MIGRATION STATIC CHECKS (Task 7 / Task 1+2 verification)
// ════════════════════════════════════════════════════════════════════

describe('S7.5 Hardening: Migration file static checks', () => {
  const migrationsDir = path.join(process.cwd(), 'migrations');
  const newMigrationFile = path.join(migrationsDir, '0007_po_provider_account_methods.sql');
  const oldMigrationFile = path.join(migrationsDir, '0007_supreme_wolfsbane.sql');
  const journalFile = path.join(migrationsDir, 'meta', '_journal.json');

  // PM-MIG01 ─────────────────────────────────────────────────────────────────
  test('PM-MIG01: 0007_po_provider_account_methods.sql must not contain ALTER TABLE ... ADD', () => {
    assert.ok(fs.existsSync(newMigrationFile),
      `Migration file must exist: ${newMigrationFile}`);

    const content = fs.readFileSync(newMigrationFile, 'utf-8');

    // Must NOT contain ALTER TABLE ... ADD (constraint or column)
    const hasAlterAdd = /ALTER TABLE.*ADD/i.test(content);
    assert.ok(!hasAlterAdd,
      `Migration 0007 must not contain "ALTER TABLE ... ADD". Found in:\n${content}`);

    // Must define FK constraints inline in CREATE TABLE
    assert.ok(content.includes('CONSTRAINT'), 'Migration must define FK constraints inline');
    assert.ok(content.includes('FOREIGN KEY'), 'Migration must include FOREIGN KEY definitions');
    assert.ok(content.includes('po_merchants'), 'Migration must reference po_merchants FK');
    assert.ok(content.includes('po_provider_accounts'), 'Migration must reference po_provider_accounts FK');
  });

  // PM-MIG02 ─────────────────────────────────────────────────────────────────
  test('PM-MIG02: 0007_supreme_wolfsbane.sql must not exist', () => {
    assert.ok(!fs.existsSync(oldMigrationFile),
      `Old migration file must be deleted: ${oldMigrationFile}`);
  });

  // PM-MIG03 ─────────────────────────────────────────────────────────────────
  test('PM-MIG03: Drizzle journal must reference 0007_po_provider_account_methods, not 0007_supreme_wolfsbane', () => {
    assert.ok(fs.existsSync(journalFile), `Journal file must exist: ${journalFile}`);
    const journal = JSON.parse(fs.readFileSync(journalFile, 'utf-8'));

    const entry007 = journal.entries.find((e: any) => e.idx === 7);
    assert.ok(entry007, 'Journal must have entry with idx=7');
    assert.equal(entry007.tag, '0007_po_provider_account_methods',
      `Journal tag must be '0007_po_provider_account_methods', got '${entry007.tag}'`);

    const hasOldName = journal.entries.some((e: any) => e.tag === '0007_supreme_wolfsbane');
    assert.ok(!hasOldName, 'Journal must not reference 0007_supreme_wolfsbane');
  });
});
