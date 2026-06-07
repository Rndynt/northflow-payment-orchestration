/**
 * payment-orchestration-s7-client-integration-smoke.test.ts
 *
 * Phase S7 — Integration Smoke Tests for Client Integration Contract (S6).
 *
 * Covers:
 *   S7.1: Seed test clients and merchants (in-memory repos)
 *
 *   S7.2: Positive smoke flows
 *     Consumer A REST: create merchant → provider account → intent → gateway payment → get status → void
 *     Consumer B SDK: create merchant → provider account → intent → gateway payment → get status
 *     Consumer C REST: create merchant → provider account → intent → gateway payment → get status
 *
 *   S7.3: Negative isolation tests
 *     N01-N06: Cross-app merchant access → 403 MERCHANT_ACCESS_DENIED
 *     N07-N09: sourceApp spoofing → 403 SOURCE_APP_MISMATCH
 *     N10-N12: Missing scope → 403 SCOPE_DENIED
 *
 *   S7.4: REST vs SDK parity
 *     P01: SDK sends Authorization: Bearer with apiKey
 *     P02: SDK injects merchantId into POST body
 *     P03: SDK passes idempotencyKey in body
 *     P04: SDK error codes match REST for auth/access/scope failures
 *     P05: SDK and REST share same sourceApp behavior
 *
 * S1-S5 security guarantees are preserved throughout — these tests verify them
 * from the consumer integration perspective.
 *
 * Run:
 *   pnpm test
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';

// ── Middleware imports ────────────────────────────────────────────────────────

import {
  generateCredential,
} from '../apps/service/src/middleware/auth.ts';

// ── Service + container imports ───────────────────────────────────────────────

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
import { VoidPaymentTransaction } from '../apps/service/src/application/use-cases/VoidPaymentTransaction.ts';
import { RefundPaymentTransaction } from '../apps/service/src/application/use-cases/RefundPaymentTransaction.ts';
import { FakeGatewayWebhookHandler } from '../apps/service/src/infrastructure/providers/FakeGatewayWebhookHandler.ts';
import { StandaloneFakeGatewayProvider } from '../apps/service/src/infrastructure/providers/StandaloneFakeGatewayProvider.ts';

// ── Core domain types ─────────────────────────────────────────────────────────

import type {
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
  StandalonePaymentIntentDTO,
  StandalonePaymentTransactionDTO,
  PaymentIdempotencyKeyDTO,
  PaymentProviderEventDTO,
  ApiClientDTO,
  ClientCredentialDTO,
  ClientMerchantAccessDTO,
  CreateApiClientInput,
  CreateClientCredentialInput,
  CreateClientMerchantAccessInput,
  ApiClientStatus,
  ClientMerchantAccessStatus,
} from '@northflow/payment-orchestration-core';

// ── SDK ───────────────────────────────────────────────────────────────────────

import { PaymentOrchestrationClient } from '../packages/client-sdk/src/client.ts';
import { PaymentOrchestrationClientError } from '../packages/client-sdk/src/errors.ts';

// ════════════════════════════════════════════════════════════════════
// IN-MEMORY REPOSITORIES
// ════════════════════════════════════════════════════════════════════

type MerchantStatus = 'active' | 'suspended' | 'closed';
type IntentStatus = 'requires_payment' | 'partially_paid' | 'paid' | 'overpaid' | 'refunded' | 'voided' | 'expired' | 'cancelled' | 'failed';
type TxStatus = 'pending' | 'requires_action' | 'succeeded' | 'failed' | 'cancelled' | 'expired' | 'reversed';

class InMemoryMerchantRepo implements PaymentMerchantRepository {
  readonly store = new Map<string, PaymentMerchant>();
  async findById(id: string) { return this.store.get(id) ?? null; }
  async findByExternalRef(input: { sourceApp: string; externalRef: string }) {
    for (const m of this.store.values()) {
      if (m.sourceApp === input.sourceApp && m.externalRef === input.externalRef) return m;
    }
    return null;
  }
  async create(input: { id: string; name: string; legalName?: string | null; externalRef?: string | null; sourceApp?: string | null; status?: string; metadata?: Record<string, unknown> }): Promise<PaymentMerchant> {
    const now = new Date();
    const m: PaymentMerchant = {
      id: input.id, displayName: input.name, legalName: input.legalName ?? null,
      externalRef: input.externalRef ?? null, sourceApp: input.sourceApp ?? null,
      status: (input.status ?? 'active') as MerchantStatus, metadata: input.metadata ?? {},
      createdAt: now, updatedAt: now,
    };
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

class InMemoryProviderAccountRepo implements PaymentProviderAccountRepository {
  readonly store = new Map<string, PaymentProviderAccount>();
  async findById(id: string, merchantId: string) { const pa = this.store.get(id); return (!pa || pa.merchantId !== merchantId) ? null : pa; }
  async findByMerchantAndProvider(merchantId: string, provider: string, env?: string) {
    for (const pa of this.store.values()) {
      if (pa.merchantId === merchantId && pa.provider === provider && (!env || pa.environment === env)) return pa;
    }
    return null;
  }
  async create(input: any): Promise<PaymentProviderAccount> {
    const now = new Date();
    const pa: PaymentProviderAccount = { id: input.id, merchantId: input.merchantId, provider: input.provider, environment: input.environment, providerAccountRef: input.providerAccountRef ?? null, credentialsRef: input.credentialsRef ?? null, publicConfig: input.publicConfig ?? {}, status: (input.status ?? 'active') as PaymentProviderAccount['status'], metadata: input.metadata ?? {}, createdAt: now, updatedAt: now };
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

class InMemoryIntentRepo implements PaymentIntentRepository {
  readonly store = new Map<string, StandalonePaymentIntentDTO>();
  async findById(id: string, merchantId: string) { const i = this.store.get(id); return (!i || i.merchantId !== merchantId) ? null : i; }
  async findByExternalPayable(input: any) {
    for (const i of this.store.values()) {
      if (i.merchantId === input.merchantId && i.externalPayableType === input.externalPayableType && i.externalPayableId === input.externalPayableId) return i;
    }
    return null;
  }
  async create(input: any): Promise<StandalonePaymentIntentDTO> {
    const now = new Date();
    const i: StandalonePaymentIntentDTO = { id: input.id, merchantId: input.merchantId, providerAccountId: input.providerAccountId ?? null, sourceApp: input.sourceApp ?? null, externalTenantId: input.externalTenantId ?? null, externalOutletId: input.externalOutletId ?? null, externalLocationId: input.externalLocationId ?? null, externalPayableType: input.externalPayableType, externalPayableId: input.externalPayableId, amountDue: input.amountDue, amountPaid: 0, amountRefunded: 0, amountRemaining: input.amountDue, currency: input.currency ?? 'IDR', status: 'requires_payment', allowPartial: input.allowPartial ?? false, expiresAt: null, metadata: input.metadata ?? {}, createdAt: now, updatedAt: now };
    this.store.set(i.id, i);
    return i;
  }
  async updateTotals(input: any) { const i = this.store.get(input.id)!; const u = { ...i, amountPaid: input.amountPaid, amountRefunded: input.amountRefunded, amountRemaining: input.amountRemaining, updatedAt: new Date() }; this.store.set(input.id, u); return u; }
  async updateStatus(input: any) { const i = this.store.get(input.id)!; const u = { ...i, status: input.status as IntentStatus, updatedAt: new Date() }; this.store.set(input.id, u); return u; }
}

class InMemoryTransactionRepo implements PaymentTransactionRepository {
  readonly store = new Map<string, StandalonePaymentTransactionDTO>();
  async findById(id: string, merchantId: string) { const t = this.store.get(id); return (!t || t.merchantId !== merchantId) ? null : t; }
  async findByIntentId(intentId: string, merchantId: string) { return [...this.store.values()].filter(t => t.intentId === intentId && t.merchantId === merchantId); }
  async findByProviderReference(provider: string, ref: string) { for (const t of this.store.values()) { if (t.provider === provider && t.providerReference === ref) return t; } return null; }
  async findByMerchantIdempotencyKey(merchantId: string, key: string) { for (const t of this.store.values()) { if (t.merchantId === merchantId && t.idempotencyKey === key) return t; } return null; }
  async create(input: any): Promise<StandalonePaymentTransactionDTO> {
    const now = new Date();
    const t: StandalonePaymentTransactionDTO = { id: input.id, merchantId: input.merchantId, intentId: input.intentId, providerAccountId: input.providerAccountId ?? null, provider: input.provider, method: input.method, transactionType: input.transactionType, direction: input.direction, status: input.status as TxStatus, amount: input.amount, currency: input.currency ?? 'IDR', parentTransactionId: input.parentTransactionId ?? null, providerReference: input.providerReference ?? null, providerEventId: input.providerEventId ?? null, providerPaymentUrl: input.providerPaymentUrl ?? null, providerQrString: input.providerQrString ?? null, failureReason: input.failureReason ?? null, idempotencyKey: input.idempotencyKey ?? null, expiresAt: null, metadata: input.metadata ?? {}, rawProviderResponse: input.rawProviderResponse ?? null, createdAt: now, updatedAt: now };
    this.store.set(t.id, t);
    return t;
  }
  async updateStatus(input: any) { const t = this.store.get(input.id)!; const u = { ...t, status: input.status as TxStatus, failureReason: input.failureReason !== undefined ? input.failureReason : t.failureReason, updatedAt: new Date() }; this.store.set(input.id, u); return u; }
  async sumSucceededRefundsByParent(parentId: string) { let s = 0; for (const t of this.store.values()) { if (t.parentTransactionId === parentId && t.transactionType === 'refund' && t.direction === 'outgoing' && t.status === 'succeeded') s += t.amount; } return s; }
  async markSucceededIfConfirmable(input: any) { const t = this.store.get(input.id); if (!t || t.merchantId !== input.merchantId) return { transaction: null, changed: false }; if (t.status !== 'requires_action' && t.status !== 'pending') return { transaction: null, changed: false }; const u: StandalonePaymentTransactionDTO = { ...t, status: 'succeeded' as TxStatus, updatedAt: new Date() }; this.store.set(input.id, u); return { transaction: u, changed: true }; }
}

class InMemoryIdempotencyRepo implements PaymentIdempotencyRepository {
  private readonly store = new Map<string, PaymentIdempotencyKeyDTO>();
  async reserve(input: any): Promise<PaymentIdempotencyKeyDTO> { const now = new Date(); const r: PaymentIdempotencyKeyDTO = { id: input.id, merchantId: input.merchantId, scope: input.scope, idempotencyKey: input.idempotencyKey, requestHash: input.requestHash, responseSnapshot: null, resourceType: null, resourceId: null, status: 'processing', createdAt: now, updatedAt: now, expiresAt: input.expiresAt ?? null }; this.store.set(`${input.merchantId}:${input.scope}:${input.idempotencyKey}`, r); return r; }
  async find(input: any) { return this.store.get(`${input.merchantId}:${input.scope}:${input.idempotencyKey}`) ?? null; }
  async markCompleted(input: any) { const k = `${input.merchantId}:${input.scope}:${input.idempotencyKey}`; const r = this.store.get(k); if (r) this.store.set(k, { ...r, status: 'completed', responseSnapshot: input.responseSnapshot, resourceType: input.resourceType ?? null, resourceId: input.resourceId ?? null, updatedAt: new Date() }); }
  async markFailed(input: any) { const k = `${input.merchantId}:${input.scope}:${input.idempotencyKey}`; const r = this.store.get(k); if (r) this.store.set(k, { ...r, status: 'failed', responseSnapshot: { error: input.error }, updatedAt: new Date() }); }
}

class StubProviderEventRepo implements PaymentProviderEventRepository {
  async reserveEvent(): Promise<PaymentProviderEventDTO> { throw new Error('not implemented'); }
  async findByProviderEventId() { return null; }
  async assignMerchant() { return; }
  async markProcessed() { return; }
  async markFailed() { return; }
  async findStalePending() { return []; }
}

class InMemoryApiClientRepo implements ApiClientRepository {
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

class InMemoryCredentialRepo implements ClientCredentialRepository {
  readonly store: ClientCredentialDTO[] = [];
  async findByPrefix(prefix: string) { return this.store.filter(c => c.credentialPrefix === prefix); }
  async findById(id: string) { return this.store.find(c => c.id === id) ?? null; }
  async listByClientId(clientId: string) { return this.store.filter(c => c.clientId === clientId); }
  async create(input: CreateClientCredentialInput): Promise<ClientCredentialDTO> {
    const now = new Date();
    const c: ClientCredentialDTO = { id: input.id, clientId: input.clientId, credentialPrefix: input.credentialPrefix, credentialHash: input.credentialHash, status: 'active', expiresAt: input.expiresAt ?? null, lastUsedAt: null, createdAt: now, revokedAt: null };
    this.store.push(c);
    return c;
  }
  async revoke(id: string) { const c = this.store.find(c => c.id === id); if (c) c.status = 'revoked' as any; }
  async touchLastUsed(id: string, at: Date) { const c = this.store.find(c => c.id === id); if (c) c.lastUsedAt = at; }
}

class InMemoryAccessRepo implements ClientMerchantAccessRepository {
  readonly store: ClientMerchantAccessDTO[] = [];
  async findByClientAndMerchant(clientId: string, merchantId: string) { return this.store.find(g => g.clientId === clientId && g.merchantId === merchantId) ?? null; }
  async findByClient(clientId: string) { return this.store.filter(g => g.clientId === clientId); }
  async create(input: CreateClientMerchantAccessInput): Promise<ClientMerchantAccessDTO> {
    const g: ClientMerchantAccessDTO = { id: input.id, clientId: input.clientId, merchantId: input.merchantId, scopes: input.scopes, status: 'active', createdAt: new Date(), revokedAt: null };
    this.store.push(g);
    return g;
  }
  async revoke(id: string) { const g = this.store.find(g => g.id === id); if (g) g.status = 'revoked' as any; }
  /** Convenience helper: directly add a grant to the in-memory store. */
  grant(clientId: string, merchantId: string, scopes: string[]) {
    this.store.push({ id: randomUUID(), clientId, merchantId, scopes, status: 'active', createdAt: new Date(), revokedAt: null });
  }
}

// ════════════════════════════════════════════════════════════════════
// S7 CONTAINER FACTORY
// ════════════════════════════════════════════════════════════════════

type S7ClientSpec = {
  id: string;
  sourceApp: string;
  scopes: string[];
};

type S7ContainerResult = {
  container: ServiceContainer;
  apiClientRepo: InMemoryApiClientRepo;
  credentialRepo: InMemoryCredentialRepo;
  accessRepo: InMemoryAccessRepo;
  merchantRepo: InMemoryMerchantRepo;
  providerAccountRepo: InMemoryProviderAccountRepo;
  intentRepo: InMemoryIntentRepo;
  transactionRepo: InMemoryTransactionRepo;
  /**
   * Seed an API client with a credential.
   * Returns the raw credential token (shown once — pass as apiKey to SDK or Bearer to REST).
   */
  seedClient: (spec: S7ClientSpec) => string;
};

/** All scopes needed for a full flow (create + manage payment). */
const FULL_SCOPES = [
  'merchant:create', 'merchant:read',
  'provider_account:create', 'provider_account:read',
  'intent:create', 'intent:read',
  'payment:create', 'payment:refund', 'payment:void',
];

/** Scopes that deliberately exclude refund, void, and provider_account:create. */
const LIMITED_SCOPES = ['merchant:create', 'merchant:read', 'intent:create', 'intent:read', 'payment:create'];

function buildS7Container(): S7ContainerResult {
  const nodeEnv = 'test';
  const serviceToken = 'legacy-s7-test-token';

  const merchantRepo = new InMemoryMerchantRepo();
  const providerAccountRepo = new InMemoryProviderAccountRepo();
  const intentRepo = new InMemoryIntentRepo();
  const transactionRepo = new InMemoryTransactionRepo();
  const idempotencyRepo = new InMemoryIdempotencyRepo();
  const providerEventRepo = new StubProviderEventRepo();

  const apiClientRepo = new InMemoryApiClientRepo();
  const credentialRepo = new InMemoryCredentialRepo();
  const accessRepo = new InMemoryAccessRepo();

  const fakeGateway = new StandaloneFakeGatewayProvider();
  const providerRegistry = new Map([[fakeGateway.providerCode, fakeGateway]]);
  const fakeGatewayWebhookHandler = new FakeGatewayWebhookHandler({ nodeEnv });

  const config: PaymentOrchestrationServiceConfig = {
    port: 0,
    nodeEnv,
    serviceToken,
    dbUrl: '',
    version: '0.3.0',
    phase: 'S7-smoke',
    legacyServiceTokenEnabled: false,
  };

  const useCases = {
    createMerchant: new CreateMerchant(merchantRepo),
    createProviderAccount: new CreateProviderAccount(merchantRepo, providerAccountRepo),
    createPaymentIntent: new CreatePaymentIntent(merchantRepo, intentRepo, idempotencyRepo),
    createGatewayPayment: new CreateGatewayPayment(merchantRepo, intentRepo, transactionRepo, providerRegistry, providerAccountRepo, idempotencyRepo, nodeEnv),
    confirmFakeGatewayPayment: new ConfirmFakeGatewayPayment(transactionRepo, intentRepo, nodeEnv),
    getPaymentIntentStatus: new GetPaymentIntentStatus(intentRepo, transactionRepo),
    getRefundability: new GetRefundability(intentRepo, transactionRepo),
    handleProviderWebhook: new HandleProviderWebhook(transactionRepo, intentRepo, providerEventRepo, fakeGatewayWebhookHandler),
    reconcilePaymentIntentTotals: {} as any,
    refreshProviderStatus: {} as any,
    refundPaymentTransaction: new RefundPaymentTransaction(transactionRepo, intentRepo, providerAccountRepo, providerRegistry),
    voidPaymentTransaction: new VoidPaymentTransaction(transactionRepo, intentRepo, providerAccountRepo, providerRegistry),
  };

  const container: ServiceContainer = {
    config,
    db: null as any,
    repos: { merchantRepo, providerAccountRepo, intentRepo, transactionRepo, providerEventRepo, idempotencyRepo },
    authRepos: { apiClientRepo, clientCredentialRepo: credentialRepo, clientMerchantAccessRepo: accessRepo },
    providerRegistry,
    useCases,
  };

  function seedClient(spec: S7ClientSpec): string {
    const credentialId = randomUUID().replace(/-/g, '');
    const env = 'live';
    const { raw, prefix, hash } = generateCredential(env, credentialId);
    apiClientRepo.create({
      id: spec.id,
      name: `S7 Test Client — ${spec.sourceApp}`,
      sourceApp: spec.sourceApp,
      environment: env,
      scopes: spec.scopes,
      status: 'active',
    }).catch(() => {});
    credentialRepo.store.push({
      id: credentialId,
      clientId: spec.id,
      credentialPrefix: prefix,
      credentialHash: hash,
      status: 'active',
      expiresAt: null,
      lastUsedAt: null,
      createdAt: new Date(),
      revokedAt: null,
    });
    return raw;
  }

  return { container, apiClientRepo, credentialRepo, accessRepo, merchantRepo, providerAccountRepo, intentRepo, transactionRepo, seedClient };
}

// ════════════════════════════════════════════════════════════════════
// HTTP HELPERS
// ════════════════════════════════════════════════════════════════════

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

async function req(
  baseUrl: string,
  path: string,
  opts: {
    method?: string;
    bearer?: string;
    body?: unknown;
    qs?: Record<string, string>;
  } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.bearer) headers['authorization'] = `Bearer ${opts.bearer}`;

  let url = `${baseUrl}${path}`;
  if (opts.qs) {
    const params = new URLSearchParams(opts.qs).toString();
    if (params) url += `?${params}`;
  }

  const res = await fetch(url, {
    method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const body = await res.json().catch(() => ({})) as Record<string, unknown>;
  return { status: res.status, body };
}

function errCode(body: Record<string, unknown>): string {
  const err = body['error'] as any;
  if (!err) return '';
  if (typeof err === 'string') return err;
  return typeof err === 'object' ? (err.code ?? '') : '';
}

// ════════════════════════════════════════════════════════════════════
// S7.2 — CONSUMER A REST POSITIVE SMOKE FLOW
// ════════════════════════════════════════════════════════════════════

describe('S7.2 Consumer A REST: positive smoke flow', () => {
  let server: http.Server;
  let baseUrl: string;
  let token: string;
  let accessRepo: InMemoryAccessRepo;
  const clientId = 'client-consumer-a-s7';

  // Shared state across sequential tests
  let merchantId: string;
  let providerAccountId: string;
  let intentId: string;
  let transactionId: string;

  before(async () => {
    const built = buildS7Container();
    accessRepo = built.accessRepo;
    token = built.seedClient({ id: clientId, sourceApp: 'consumer-a', scopes: FULL_SCOPES });
    const srv = await startServer(built.container);
    server = srv.server;
    baseUrl = srv.baseUrl;
  });

  after(() => stopServer(server));

  test('AP1: create merchant (201)', async () => {
    const { status, body } = await req(baseUrl, '/v1/merchants', {
      bearer: token,
      body: {
        name: 'Consumer A Cafe Test',
        sourceApp: 'consumer-a',
        externalRef: 'mer_consumer-a_cafe_test',
      },
    });
    assert.equal(status, 201, `expected 201, got ${status}: ${JSON.stringify(body)}`);
    const data = body['data'] as any;
    assert.ok(data?.id, 'merchant id must be returned');
    merchantId = data.id;
    // Grant client access to the newly created merchant
    accessRepo.grant(clientId, merchantId, FULL_SCOPES);
  });

  test('AP2: create provider account (201)', async () => {
    const { status, body } = await req(baseUrl, `/v1/merchants/${merchantId}/provider-accounts`, {
      bearer: token,
      body: {
        provider: 'fake_gateway',
        environment: 'test',
        providerAccountRef: 'fake-account-consumer-a',
      },
    });
    assert.equal(status, 201, `expected 201, got ${status}: ${JSON.stringify(body)}`);
    const data = body['data'] as any;
    assert.ok(data?.id, 'provider account id must be returned');
    assert.equal(data.provider, 'fake_gateway');
    providerAccountId = data.id;
  });

  test('AP3: create payment intent (201)', async () => {
    const { status, body } = await req(baseUrl, '/v1/payment-intents', {
      bearer: token,
      body: {
        merchantId,
        sourceApp: 'consumer-a',
        externalTenantId: 'tenant-consumer-a-001',
        externalOutletId: 'outlet-42',
        externalPayableType: 'pos_order',
        externalPayableId: `order-${randomUUID()}`,
        currency: 'IDR',
        amountDue: 75000,
        allowPartial: false,
        idempotencyKey: `consumer-a:tenant-001:${randomUUID()}:create-intent`,
      },
    });
    assert.equal(status, 201, `expected 201, got ${status}: ${JSON.stringify(body)}`);
    const data = body['data'] as any;
    assert.ok(data?.id, 'intent id must be returned');
    assert.equal(data.status, 'requires_payment');
    assert.equal(data.amountDue, 75000);
    assert.equal(data.merchantId, merchantId);
    intentId = data.id;
  });

  test('AP4: create gateway payment (201)', async () => {
    const { status, body } = await req(baseUrl, `/v1/payment-intents/${intentId}/gateway-payments`, {
      bearer: token,
      body: {
        merchantId,
        provider: 'fake_gateway',
        method: 'qris',
        amount: 75000,
        providerAccountId,
        idempotencyKey: `consumer-a:tenant-001:${intentId}:gateway-payment:qris`,
      },
    });
    assert.equal(status, 201, `expected 201, got ${status}: ${JSON.stringify(body)}`);
    const data = body['data'] as any;
    assert.ok(data?.transaction?.id, 'transaction id must be returned');
    assert.equal(data.transaction.provider, 'fake_gateway');
    assert.equal(data.transaction.status, 'requires_action');
    assert.equal(data.idempotentReplay, false);
    transactionId = data.transaction.id;
  });

  test('AP5: get intent status (200)', async () => {
    const { status, body } = await req(baseUrl, `/v1/payment-intents/${intentId}/status`, {
      bearer: token,
      qs: { merchantId },
    });
    assert.equal(status, 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
    const data = body['data'] as any;
    assert.ok(data?.intent, 'intent field must be present');
    assert.equal(data.intent.id, intentId);
    assert.equal(data.requiresAction, true);
    assert.equal(data.isTerminal, false);
  });

  test('AP6: void transaction according to granted scope (200)', async () => {
    const { status, body } = await req(baseUrl, `/v1/payment-transactions/${transactionId}/void`, {
      bearer: token,
      body: {
        merchantId,
        reason: 'order_cancelled',
        idempotencyKey: `consumer-a:tenant-001:${transactionId}:void`,
      },
    });
    assert.equal(status, 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
    const data = body['data'] as any;
    assert.ok(data?.transaction, 'transaction field must be present');
    assert.equal(data.transaction.status, 'cancelled');
    assert.equal(data.idempotentReplay, false);
  });
});

// ════════════════════════════════════════════════════════════════════
// S7.2 — CONSUMER B SDK POSITIVE SMOKE FLOW
// ════════════════════════════════════════════════════════════════════

describe('S7.2 Consumer B SDK: positive smoke flow', () => {
  let server: http.Server;
  let baseUrl: string;
  let sdkClient: PaymentOrchestrationClient;
  let accessRepo: InMemoryAccessRepo;
  const clientId = 'client-consumer-b-s7';

  let merchantId: string;
  let providerAccountId: string;
  let intentId: string;

  before(async () => {
    const built = buildS7Container();
    accessRepo = built.accessRepo;
    const token = built.seedClient({ id: clientId, sourceApp: 'consumer-b', scopes: FULL_SCOPES });
    const srv = await startServer(built.container);
    server = srv.server;
    baseUrl = srv.baseUrl;
    sdkClient = new PaymentOrchestrationClient({ baseUrl, apiKey: token });
  });

  after(() => stopServer(server));

  test('TR1: SDK creates merchant (201)', async () => {
    const merchant = await sdkClient.createMerchant({
      name: 'Consumer B Shuttle Test',
      sourceApp: 'consumer-b',
      externalRef: 'mer_consumer-b_shuttle_test',
    });
    assert.ok(merchant.id, 'merchant id must be returned');
    assert.equal(merchant.status, 'active');
    merchantId = merchant.id;
    // Grant client access to the newly created merchant
    accessRepo.grant(clientId, merchantId, FULL_SCOPES);
  });

  test('TR2: SDK creates provider account (201)', async () => {
    const pa = await sdkClient.createProviderAccount(merchantId, {
      provider: 'fake_gateway',
      environment: 'test',
      providerAccountRef: 'fake-account-consumer-b',
    });
    assert.ok(pa.id, 'provider account id must be returned');
    assert.equal(pa.merchantId, merchantId);
    assert.equal(pa.provider, 'fake_gateway');
    providerAccountId = pa.id;
  });

  test('TR3: SDK creates payment intent (201)', async () => {
    const intent = await sdkClient.createPaymentIntent({
      merchantId,
      sourceApp: 'consumer-b',
      externalTenantId: 'tenant-consumer-b-001',
      externalPayableType: 'booking',
      externalPayableId: `booking-${randomUUID()}`,
      currency: 'IDR',
      amountDue: 150000,
      idempotencyKey: `consumer-b:tenant-001:${randomUUID()}:create-intent`,
    });
    assert.ok(intent.id, 'intent id must be returned');
    assert.equal(intent.status, 'requires_payment');
    assert.equal(intent.amountDue, 150000);
    assert.equal(intent.merchantId, merchantId);
    intentId = intent.id;
  });

  test('TR4: SDK creates gateway payment (201)', async () => {
    const result = await sdkClient.createGatewayPayment(intentId, {
      merchantId,
      provider: 'fake_gateway',
      method: 'qris',
      amount: 150000,
      providerAccountId,
      idempotencyKey: `consumer-b:tenant-001:${intentId}:gateway-payment:qris`,
    });
    assert.ok(result.transaction.id, 'transaction id must be returned');
    assert.equal(result.transaction.status, 'requires_action');
    assert.equal(result.idempotentReplay, false);
  });

  test('TR5: SDK gets intent status (200)', async () => {
    const status = await sdkClient.getPaymentIntentStatus(intentId, { merchantId });
    assert.ok(status.intent, 'intent field must be present');
    assert.equal(status.intent.id, intentId);
    assert.equal(status.requiresAction, true);
    assert.equal(status.isTerminal, false);
  });
});

// ════════════════════════════════════════════════════════════════════
// S7.2 — CONSUMER C REST POSITIVE SMOKE FLOW
// ════════════════════════════════════════════════════════════════════

describe('S7.2 Consumer C REST: positive smoke flow', () => {
  let server: http.Server;
  let baseUrl: string;
  let token: string;
  let accessRepo: InMemoryAccessRepo;
  const clientId = 'client-consumer-c-s7';

  let merchantId: string;
  let intentId: string;

  before(async () => {
    const built = buildS7Container();
    accessRepo = built.accessRepo;
    token = built.seedClient({ id: clientId, sourceApp: 'consumer-c', scopes: FULL_SCOPES });
    const srv = await startServer(built.container);
    server = srv.server;
    baseUrl = srv.baseUrl;
  });

  after(() => stopServer(server));

  test('KK1: create merchant (201)', async () => {
    const { status, body } = await req(baseUrl, '/v1/merchants', {
      bearer: token,
      body: {
        name: 'Consumer C Main Test',
        sourceApp: 'consumer-c',
        externalRef: 'mer_consumer-c_main_test',
      },
    });
    assert.equal(status, 201, `expected 201, got ${status}: ${JSON.stringify(body)}`);
    const data = body['data'] as any;
    assert.ok(data?.id);
    merchantId = data.id;
    accessRepo.grant(clientId, merchantId, FULL_SCOPES);
  });

  test('KK2: create provider account (201)', async () => {
    const { status, body } = await req(baseUrl, `/v1/merchants/${merchantId}/provider-accounts`, {
      bearer: token,
      body: {
        provider: 'fake_gateway',
        environment: 'test',
        providerAccountRef: 'fake-account-consumer-c',
      },
    });
    assert.equal(status, 201, `expected 201, got ${status}: ${JSON.stringify(body)}`);
    const data = body['data'] as any;
    assert.ok(data?.id);
    assert.equal(data.provider, 'fake_gateway');
  });

  test('KK3: create payment intent with OTC references (201)', async () => {
    const { status, body } = await req(baseUrl, '/v1/payment-intents', {
      bearer: token,
      body: {
        merchantId,
        sourceApp: 'consumer-c',
        externalPayableType: 'otc_order',
        externalPayableId: `otc-${randomUUID()}`,
        currency: 'IDR',
        amountDue: 25000,
        idempotencyKey: `consumer-c:${randomUUID()}:create-intent`,
      },
    });
    assert.equal(status, 201, `expected 201, got ${status}: ${JSON.stringify(body)}`);
    const data = body['data'] as any;
    assert.ok(data?.id);
    assert.equal(data.externalPayableType, 'otc_order');
    assert.equal(data.amountDue, 25000);
    intentId = data.id;
  });

  test('KK4: create gateway payment (201)', async () => {
    const { status, body } = await req(baseUrl, `/v1/payment-intents/${intentId}/gateway-payments`, {
      bearer: token,
      body: {
        merchantId,
        provider: 'fake_gateway',
        method: 'qris',
        amount: 25000,
        idempotencyKey: `consumer-c:${intentId}:gateway-payment:qris`,
      },
    });
    assert.equal(status, 201, `expected 201, got ${status}: ${JSON.stringify(body)}`);
    const data = body['data'] as any;
    assert.ok(data?.transaction?.id);
    assert.equal(data.transaction.status, 'requires_action');
  });

  test('KK5: get intent status (200)', async () => {
    const { status, body } = await req(baseUrl, `/v1/payment-intents/${intentId}/status`, {
      bearer: token,
      qs: { merchantId },
    });
    assert.equal(status, 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
    const data = body['data'] as any;
    assert.ok(data?.intent);
    assert.equal(data.intent.id, intentId);
  });
});

// ════════════════════════════════════════════════════════════════════
// S7.3 — NEGATIVE ISOLATION TESTS
// ════════════════════════════════════════════════════════════════════

describe('S7.3 Negative: cross-app merchant access, sourceApp spoofing, and scope denial', () => {
  let server: http.Server;
  let baseUrl: string;

  // 3 client tokens
  let tokenConsumerA: string;
  let tokenConsumerB: string;
  let tokenConsumerC: string;

  // 3 merchant IDs — one per client
  let merchantConsumerA: string;
  let merchantConsumerB: string;
  let merchantConsumerC: string;

  // A limited-scope client for scope tests
  let tokenLimitedScope: string;
  let merchantLimitedScope: string;

  before(async () => {
    const built = buildS7Container();
    const { accessRepo, merchantRepo } = built;

    tokenConsumerA = built.seedClient({ id: 'client-consumer-a-n', sourceApp: 'consumer-a', scopes: FULL_SCOPES });
    tokenConsumerB = built.seedClient({ id: 'client-consumer-b-n', sourceApp: 'consumer-b', scopes: FULL_SCOPES });
    tokenConsumerC = built.seedClient({ id: 'client-consumer-c-n', sourceApp: 'consumer-c', scopes: FULL_SCOPES });
    tokenLimitedScope = built.seedClient({ id: 'client-limited-n', sourceApp: 'consumer-a', scopes: LIMITED_SCOPES });

    const srv = await startServer(built.container);
    server = srv.server;
    baseUrl = srv.baseUrl;

    // Seed merchants directly in the in-memory store
    const now = new Date();
    merchantConsumerA = 'mer-consumer-a-smoke';
    merchantConsumerB = 'mer-consumer-b-smoke';
    merchantConsumerC = 'mer-consumer-c-smoke';
    merchantLimitedScope = 'mer-limited-smoke';

    for (const [id, app] of [
      [merchantConsumerA, 'consumer-a'],
      [merchantConsumerB, 'consumer-b'],
      [merchantConsumerC, 'consumer-c'],
      [merchantLimitedScope, 'consumer-a'],
    ] as const) {
      await merchantRepo.create({ id, name: `Smoke ${id}`, sourceApp: app });
    }

    // Grant each client access ONLY to its own merchant
    accessRepo.grant('client-consumer-a-n', merchantConsumerA, FULL_SCOPES);
    accessRepo.grant('client-consumer-b-n', merchantConsumerB, FULL_SCOPES);
    accessRepo.grant('client-consumer-c-n', merchantConsumerC, FULL_SCOPES);
    // Limited-scope client has access to its merchant but with limited scopes (no refund/void/pa:create)
    accessRepo.grant('client-limited-n', merchantLimitedScope, FULL_SCOPES);
  });

  after(() => stopServer(server));

  // ── N01-N06: Cross-app merchant access ───────────────────────────

  test('N01: Consumer A credential → Consumer B merchant → 403 MERCHANT_ACCESS_DENIED', async () => {
    const { status, body } = await req(baseUrl, '/v1/merchants/' + merchantConsumerB, {
      bearer: tokenConsumerA,
    });
    assert.equal(status, 403);
    assert.equal(errCode(body), 'MERCHANT_ACCESS_DENIED');
  });

  test('N02: Consumer A credential → Consumer C merchant → 403 MERCHANT_ACCESS_DENIED', async () => {
    const { status, body } = await req(baseUrl, '/v1/merchants/' + merchantConsumerC, {
      bearer: tokenConsumerA,
    });
    assert.equal(status, 403);
    assert.equal(errCode(body), 'MERCHANT_ACCESS_DENIED');
  });

  test('N03: Consumer B credential → Consumer A merchant → 403 MERCHANT_ACCESS_DENIED', async () => {
    const { status, body } = await req(baseUrl, '/v1/merchants/' + merchantConsumerA, {
      bearer: tokenConsumerB,
    });
    assert.equal(status, 403);
    assert.equal(errCode(body), 'MERCHANT_ACCESS_DENIED');
  });

  test('N04: Consumer B credential → Consumer C merchant → 403 MERCHANT_ACCESS_DENIED', async () => {
    const { status, body } = await req(baseUrl, '/v1/merchants/' + merchantConsumerC, {
      bearer: tokenConsumerB,
    });
    assert.equal(status, 403);
    assert.equal(errCode(body), 'MERCHANT_ACCESS_DENIED');
  });

  test('N05: Consumer C credential → Consumer A merchant → 403 MERCHANT_ACCESS_DENIED', async () => {
    const { status, body } = await req(baseUrl, '/v1/merchants/' + merchantConsumerA, {
      bearer: tokenConsumerC,
    });
    assert.equal(status, 403);
    assert.equal(errCode(body), 'MERCHANT_ACCESS_DENIED');
  });

  test('N06: Consumer C credential → Consumer B merchant → 403 MERCHANT_ACCESS_DENIED', async () => {
    const { status, body } = await req(baseUrl, '/v1/merchants/' + merchantConsumerB, {
      bearer: tokenConsumerC,
    });
    assert.equal(status, 403);
    assert.equal(errCode(body), 'MERCHANT_ACCESS_DENIED');
  });

  // ── N07-N09: sourceApp spoofing ───────────────────────────────────

  test('N07: Consumer A credential sends sourceApp=consumer-b → 403 SOURCE_APP_MISMATCH', async () => {
    const { status, body } = await req(baseUrl, '/v1/payment-intents', {
      bearer: tokenConsumerA,
      body: {
        merchantId: merchantConsumerA,
        sourceApp: 'consumer-b',          // spoofed — credential is consumer-a
        externalPayableType: 'pos_order',
        externalPayableId: `order-spoof-${randomUUID()}`,
        currency: 'IDR',
        amountDue: 10000,
      },
    });
    assert.equal(status, 403);
    assert.equal(errCode(body), 'SOURCE_APP_MISMATCH');
  });

  test('N08: Consumer B credential sends sourceApp=consumer-c → 403 SOURCE_APP_MISMATCH', async () => {
    const { status, body } = await req(baseUrl, '/v1/payment-intents', {
      bearer: tokenConsumerB,
      body: {
        merchantId: merchantConsumerB,
        sourceApp: 'consumer-c',           // spoofed — credential is consumer-b
        externalPayableType: 'booking',
        externalPayableId: `booking-spoof-${randomUUID()}`,
        currency: 'IDR',
        amountDue: 10000,
      },
    });
    assert.equal(status, 403);
    assert.equal(errCode(body), 'SOURCE_APP_MISMATCH');
  });

  test('N09: Consumer C credential sends sourceApp=consumer-a → 403 SOURCE_APP_MISMATCH', async () => {
    const { status, body } = await req(baseUrl, '/v1/payment-intents', {
      bearer: tokenConsumerC,
      body: {
        merchantId: merchantConsumerC,
        sourceApp: 'consumer-a',            // spoofed — credential is consumer-c
        externalPayableType: 'otc_order',
        externalPayableId: `otc-spoof-${randomUUID()}`,
        currency: 'IDR',
        amountDue: 10000,
      },
    });
    assert.equal(status, 403);
    assert.equal(errCode(body), 'SOURCE_APP_MISMATCH');
  });

  // ── N10-N12: Scope denial ─────────────────────────────────────────

  test('N10: client without payment:refund tries refund → 403 SCOPE_DENIED', async () => {
    const { status, body } = await req(baseUrl, `/v1/payment-transactions/tx-fake/refund`, {
      bearer: tokenLimitedScope,
      body: {
        merchantId: merchantLimitedScope,
        amount: 1000,
        idempotencyKey: `test:${randomUUID()}:refund`,
      },
    });
    // requireScope('payment:refund') middleware fires before the handler reaches the repo
    assert.equal(status, 403);
    assert.equal(errCode(body), 'SCOPE_DENIED');
  });

  test('N11: client without payment:void tries void → 403 SCOPE_DENIED', async () => {
    const { status, body } = await req(baseUrl, `/v1/payment-transactions/tx-fake/void`, {
      bearer: tokenLimitedScope,
      body: {
        merchantId: merchantLimitedScope,
        idempotencyKey: `test:${randomUUID()}:void`,
      },
    });
    assert.equal(status, 403);
    assert.equal(errCode(body), 'SCOPE_DENIED');
  });

  test('N12: client without provider_account:create tries provider account create → 403 SCOPE_DENIED', async () => {
    const { status, body } = await req(baseUrl, `/v1/merchants/${merchantLimitedScope}/provider-accounts`, {
      bearer: tokenLimitedScope,
      body: {
        provider: 'fake_gateway',
        environment: 'test',
      },
    });
    assert.equal(status, 403);
    assert.equal(errCode(body), 'SCOPE_DENIED');
  });
});

// ════════════════════════════════════════════════════════════════════
// S7.4 — REST vs SDK PARITY
// ════════════════════════════════════════════════════════════════════

describe('S7.4 REST vs SDK parity', () => {

  test('P01: SDK sends Authorization: Bearer <apiKey> — same as REST auth header', () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const savedFetch = globalThis.fetch;

    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(
        JSON.stringify({ ok: true, data: { id: 'mer-1', name: 'T', legalName: null, status: 'active', metadata: {} } }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;

    try {
      const client = new PaymentOrchestrationClient({
        baseUrl: 'http://localhost:3001',
        apiKey: 'nf.live.testcred.fakesecret',
      });
      // Fire-and-forget — we just need the headers captured
      client.createMerchant({ name: 'Test', sourceApp: 'consumer-b' }).catch(() => {});
      // Verify header immediately after call is made
      assert.equal(calls.length, 1);
      const headers = calls[0]!.init.headers as Record<string, string>;
      assert.equal(headers['authorization'], 'Bearer nf.live.testcred.fakesecret',
        'SDK must send Authorization: Bearer with apiKey');
      assert.equal(headers['x-payment-orchestration-service-token'], undefined,
        'SDK must NOT send legacy header when apiKey is used');
    } finally {
      globalThis.fetch = savedFetch;
    }
  });

  test('P02: SDK legacy serviceToken uses x-payment-orchestration-service-token', () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const savedFetch = globalThis.fetch;

    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(
        JSON.stringify({ ok: true, data: { id: 'mer-1', name: 'T', legalName: null, status: 'active', metadata: {} } }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;

    try {
      const client = new PaymentOrchestrationClient({
        baseUrl: 'http://localhost:3001',
        serviceToken: 'legacy-token-here',
      });
      client.createMerchant({ name: 'Test' }).catch(() => {});
      assert.equal(calls.length, 1);
      const headers = calls[0]!.init.headers as Record<string, string>;
      assert.equal(headers['x-payment-orchestration-service-token'], 'legacy-token-here');
      assert.equal(headers['authorization'], undefined,
        'legacy mode must NOT set Authorization header');
    } finally {
      globalThis.fetch = savedFetch;
    }
  });

  test('P03: SDK injects merchantId into POST body — same as REST contract', () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const savedFetch = globalThis.fetch;

    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(
        JSON.stringify({
          ok: true, data: {
            id: 'intent-1', merchantId: 'mer-abc', externalPayableType: 'booking',
            externalPayableId: 'b-1', currency: 'IDR', amountDue: 100000,
            amountPaid: 0, amountRefunded: 0, amountRemaining: 100000,
            status: 'requires_payment', allowPartial: false,
            expiresAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
          },
        }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;

    try {
      const client = new PaymentOrchestrationClient({
        baseUrl: 'http://localhost:3001',
        apiKey: 'nf.live.testcred.fakesecret',
        merchantId: 'mer-abc',
      });
      client.createPaymentIntent({
        externalPayableType: 'booking',
        externalPayableId: 'b-1',
        currency: 'IDR',
        amountDue: 100000,
        idempotencyKey: 'consumer-b:t1:b-1:create-intent',
      }).catch(() => {});
      assert.equal(calls.length, 1);
      const sentBody = JSON.parse(calls[0]!.init.body as string);
      assert.equal(sentBody.merchantId, 'mer-abc', 'merchantId must be injected from config');
      assert.equal(sentBody.idempotencyKey, 'consumer-b:t1:b-1:create-intent', 'idempotencyKey must pass through');
    } finally {
      globalThis.fetch = savedFetch;
    }
  });

  test('P04: SDK throws PaymentOrchestrationClientError with correct code on auth failure', async () => {
    const savedFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({ error: 'UNAUTHORIZED', message: 'Missing authentication credential.' }),
        { status: 401, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;

    try {
      const client = new PaymentOrchestrationClient({ baseUrl: 'http://localhost:3001' });
      let threw = false;
      try {
        await client.createMerchant({ name: 'Test' });
      } catch (err) {
        threw = true;
        assert.ok(err instanceof PaymentOrchestrationClientError,
          'must throw PaymentOrchestrationClientError');
        assert.equal((err as PaymentOrchestrationClientError).status, 401);
        assert.equal((err as PaymentOrchestrationClientError).code, 'UNAUTHORIZED');
      }
      assert.ok(threw, 'SDK must throw on 401');
    } finally {
      globalThis.fetch = savedFetch;
    }
  });

  test('P05: SDK throws PaymentOrchestrationClientError for MERCHANT_ACCESS_DENIED (403)', async () => {
    const savedFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({ error: 'MERCHANT_ACCESS_DENIED', message: 'Access to this merchant is not permitted.' }),
        { status: 403, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;

    try {
      const client = new PaymentOrchestrationClient({
        baseUrl: 'http://localhost:3001',
        apiKey: 'nf.live.testcred.fakesecret',
      });
      let threw = false;
      try {
        await client.getMerchant('mer-forbidden');
      } catch (err) {
        threw = true;
        assert.ok(err instanceof PaymentOrchestrationClientError);
        assert.equal((err as PaymentOrchestrationClientError).status, 403);
        assert.equal((err as PaymentOrchestrationClientError).code, 'MERCHANT_ACCESS_DENIED');
      }
      assert.ok(threw, 'SDK must throw on 403 MERCHANT_ACCESS_DENIED');
    } finally {
      globalThis.fetch = savedFetch;
    }
  });

  test('P06: SDK throws PaymentOrchestrationClientError for SCOPE_DENIED (403)', async () => {
    const savedFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({ error: 'SCOPE_DENIED', message: 'Client does not have the required scope.' }),
        { status: 403, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;

    try {
      const client = new PaymentOrchestrationClient({
        baseUrl: 'http://localhost:3001',
        apiKey: 'nf.live.testcred.fakesecret',
      });
      let threw = false;
      try {
        await client.refundPaymentTransaction('tx-1', { amount: 100 });
      } catch (err) {
        threw = true;
        assert.ok(err instanceof PaymentOrchestrationClientError);
        assert.equal((err as PaymentOrchestrationClientError).status, 403);
        assert.equal((err as PaymentOrchestrationClientError).code, 'SCOPE_DENIED');
      }
      assert.ok(threw, 'SDK must throw on 403 SCOPE_DENIED');
    } finally {
      globalThis.fetch = savedFetch;
    }
  });

  test('P07: SDK sourceApp field is passed through in the request body', () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const savedFetch = globalThis.fetch;

    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(
        JSON.stringify({ ok: true, data: { id: 'mer-1', name: 'T', legalName: null, status: 'active', metadata: {} } }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;

    try {
      const client = new PaymentOrchestrationClient({
        baseUrl: 'http://localhost:3001',
        apiKey: 'nf.live.testcred.fakesecret',
        sourceApp: 'consumer-b',
      });
      client.createMerchant({ name: 'Test', sourceApp: 'consumer-b' }).catch(() => {});
      assert.equal(calls.length, 1);
      const sentBody = JSON.parse(calls[0]!.init.body as string);
      assert.equal(sentBody.sourceApp, 'consumer-b',
        'sourceApp must pass through in the body — same semantics as REST');
    } finally {
      globalThis.fetch = savedFetch;
    }
  });
});
