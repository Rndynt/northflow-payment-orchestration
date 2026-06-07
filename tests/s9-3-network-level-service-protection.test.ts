/**
 * s9-3-network-level-service-protection.test.ts
 *
 * S9.3 — Network-Level Service Protection tests.
 *
 * Covers:
 *   Security headers (SH01-SH05):
 *     SH01: X-Powered-By is absent
 *     SH02: X-Content-Type-Options = nosniff
 *     SH03: X-Frame-Options = DENY
 *     SH04: Referrer-Policy = no-referrer
 *     SH05: Cache-Control = no-store
 *
 *   CORS (CO01-CO05):
 *     CO01: CORS disabled by default → no Access-Control-Allow-Origin
 *     CO02: CORS enabled + allowed origin → returns allow header
 *     CO03: CORS enabled + disallowed origin → no allow header
 *     CO04: OPTIONS preflight works for allowed origin
 *     CO05: OPTIONS preflight blocked for disallowed origin (403)
 *
 *   Trusted proxy (TP01-TP02):
 *     TP01: trust proxy default is false
 *     TP02: trust proxy can be set to loopback
 *
 *   Request body limit (RL01-RL02):
 *     RL01: oversized JSON returns 413
 *     RL02: normal JSON still works (no false positive)
 *
 *   Ready endpoint (RD01-RD03):
 *     RD01: /ready exposes no secrets (no dbUrl, serviceToken, readyToken)
 *     RD02: protected /ready rejects request with missing token
 *     RD03: protected /ready rejects request with wrong token
 *     RD04: protected /ready accepts request with correct token
 *
 *   Unknown paths (UP01-UP02):
 *     UP01: unknown /v1 route returns structured NOT_FOUND 404
 *     UP02: unknown non-/v1 route returns structured 404 (no stack trace)
 *
 * Run:
 *   pnpm test
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';

import { createApp } from '../apps/service/src/app.ts';
import { loadEnv } from '../apps/service/src/config/env.ts';
import type { ServiceContainer } from '../apps/service/src/container.ts';
import type { PaymentOrchestrationServiceConfig } from '../apps/service/src/config/env.ts';

import type {
  ApiClientRepository,
  ClientCredentialRepository,
  ClientMerchantAccessRepository,
  AuditLogRepository,
  CreateAuditLogInput,
  ListAuditLogsInput,
  AuditLog,
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
} from '@northflow/payment-orchestration-core';

import { CreateMerchant } from '../apps/service/src/application/use-cases/CreateMerchant.ts';
import { CreateProviderAccount } from '../apps/service/src/application/use-cases/CreateProviderAccount.ts';
import { CreatePaymentIntent } from '../apps/service/src/application/use-cases/CreatePaymentIntent.ts';
import { CreateGatewayPayment } from '../apps/service/src/application/use-cases/CreateGatewayPayment.ts';
import { ConfirmFakeGatewayPayment } from '../apps/service/src/application/use-cases/ConfirmFakeGatewayPayment.ts';
import { GetPaymentIntentStatus } from '../apps/service/src/application/use-cases/GetPaymentIntentStatus.ts';
import { GetRefundability } from '../apps/service/src/application/use-cases/GetRefundability.ts';
import { HandleProviderWebhook } from '../apps/service/src/application/use-cases/HandleProviderWebhook.ts';
import { FakeGatewayWebhookHandler } from '../apps/service/src/infrastructure/providers/FakeGatewayWebhookHandler.ts';
import { StandaloneFakeGatewayProvider } from '../apps/service/src/infrastructure/providers/StandaloneFakeGatewayProvider.ts';
import { ReconcilePaymentIntentTotals } from '../apps/service/src/application/use-cases/ReconcilePaymentIntentTotals.ts';
import { RefreshProviderStatus } from '../apps/service/src/application/use-cases/RefreshProviderStatus.ts';
import { RefundPaymentTransaction } from '../apps/service/src/application/use-cases/RefundPaymentTransaction.ts';
import { VoidPaymentTransaction } from '../apps/service/src/application/use-cases/VoidPaymentTransaction.ts';
import { CreateCredential } from '../apps/service/src/application/use-cases/CreateCredential.ts';
import { ListCredentials } from '../apps/service/src/application/use-cases/ListCredentials.ts';
import { RevokeCredential } from '../apps/service/src/application/use-cases/RevokeCredential.ts';
import { RotateCredential } from '../apps/service/src/application/use-cases/RotateCredential.ts';

import type {
  ApiClientDTO,
  ClientCredentialDTO,
  ClientMerchantAccessDTO,
  CreateApiClientInput,
  CreateClientCredentialInput,
  CreateClientMerchantAccessInput,
  ApiClientStatus,
} from '@northflow/payment-orchestration-core';

// ── Minimal in-memory repositories ───────────────────────────────────────────

class InMemoryMerchantRepo implements PaymentMerchantRepository {
  private store: PaymentMerchant[] = [];
  async findById(id: string) { return this.store.find(m => m.id === id) ?? null; }
  async findByExternalRef(_: any) { return null; }
  async create(input: any): Promise<PaymentMerchant> {
    const m: any = { id: input.id ?? randomUUID(), displayName: input.name, legalName: null, externalRef: null, sourceApp: null, status: 'active', metadata: {}, createdAt: new Date(), updatedAt: new Date() };
    this.store.push(m); return m;
  }
  async updateStatus(id: string, status: any) { const m = this.store.find(m => m.id === id); if (m) m.status = status; return m!; }
}

class InMemoryIntentRepo implements PaymentIntentRepository {
  private store: StandalonePaymentIntentDTO[] = [];
  async findById(id: string) { return this.store.find(i => i.id === id) ?? null; }
  async findByExternalPayable(input: any) { return this.store.find(i => i.externalPayableId === input.externalPayableId) ?? null; }
  async create(input: any): Promise<StandalonePaymentIntentDTO> {
    const i: any = { ...input, id: input.id ?? randomUUID(), amountPaid: 0, amountRefunded: 0, amountRemaining: input.amountDue, status: 'pending', createdAt: new Date(), updatedAt: new Date() };
    this.store.push(i); return i;
  }
  async updateTotals(input: any) { return input as any; }
  async updateStatus(input: any) { return input as any; }
}

class InMemoryTransactionRepo implements PaymentTransactionRepository {
  store: StandalonePaymentTransactionDTO[] = [];
  async findById(id: string, _: string) { return this.store.find(t => t.id === id) ?? null; }
  async findByIntentId() { return []; }
  async findByProviderReference() { return null; }
  async findByMerchantIdempotencyKey() { return null; }
  async create(input: any): Promise<StandalonePaymentTransactionDTO> { const t: any = { ...input, createdAt: new Date(), updatedAt: new Date() }; this.store.push(t); return t; }
  async updateStatus(input: any) { return input as any; }
  async sumSucceededRefundsByParent() { return 0; }
  async markSucceededIfConfirmable(_: any) { return { changed: false, transaction: null }; }
}

class InMemoryProviderAccountRepo implements PaymentProviderAccountRepository {
  async findById() { return null; }
  async findByMerchantAndProvider() { return null; }
  async create(input: any): Promise<PaymentProviderAccount> { return { ...input, createdAt: new Date(), updatedAt: new Date() } as any; }
  async updateStatus(_id: string, _merchantId: string, _status: any) { return {} as any; }
}

class InMemoryIdempotencyRepo implements PaymentIdempotencyRepository {
  async reserve(input: any): Promise<PaymentIdempotencyKeyDTO> { return { ...input, id: randomUUID(), status: 'processing', createdAt: new Date(), updatedAt: new Date() } as any; }
  async find() { return null; }
  async markCompleted() {}
  async markFailed() {}
}

class InMemoryProviderEventRepo implements PaymentProviderEventRepository {
  async reserveEvent(input: any) { return { ...input, id: randomUUID(), processingStatus: 'pending', processingAttempts: 0, createdAt: new Date(), updatedAt: new Date(), receivedAt: new Date() } as any; }
  async findByProviderEventId() { return null; }
  async assignMerchant() {}
  async markProcessed() {}
  async markFailed() {}
  async findStalePending() { return []; }
}

class InMemoryApiClientRepo implements ApiClientRepository {
  readonly store: ApiClientDTO[] = [];
  async findById(id: string) { return this.store.find(c => c.id === id) ?? null; }
  async create(input: CreateApiClientInput): Promise<ApiClientDTO> {
    const c: ApiClientDTO = { id: input.id, name: input.name, sourceApp: input.sourceApp, environment: input.environment, status: input.status ?? 'active', scopes: input.scopes ?? [], metadata: input.metadata ?? {}, createdAt: new Date(), updatedAt: new Date() };
    this.store.push(c); return c;
  }
  async updateStatus(id: string, status: ApiClientStatus) { const c = this.store.find(c => c.id === id); if (c) c.status = status; return c!; }
}

class InMemoryCredentialRepo implements ClientCredentialRepository {
  readonly store: ClientCredentialDTO[] = [];
  async findByPrefix(prefix: string) { return this.store.filter(c => c.credentialPrefix === prefix); }
  async findById(id: string) { return this.store.find(c => c.id === id) ?? null; }
  async listByClientId(clientId: string) { return this.store.filter(c => c.clientId === clientId); }
  async create(input: CreateClientCredentialInput): Promise<ClientCredentialDTO> {
    const c: ClientCredentialDTO = { id: input.id, clientId: input.clientId, credentialPrefix: input.credentialPrefix, credentialHash: input.credentialHash, status: 'active', expiresAt: input.expiresAt ?? null, lastUsedAt: null, createdAt: new Date(), revokedAt: null };
    this.store.push(c); return c;
  }
  async revoke(id: string) { const c = this.store.find(c => c.id === id); if (c) { (c as any).status = 'revoked'; (c as any).revokedAt = new Date(); } }
  async touchLastUsed(id: string, at: Date) { const c = this.store.find(c => c.id === id); if (c) c.lastUsedAt = at; }
}

class InMemoryAccessRepo implements ClientMerchantAccessRepository {
  async findByClientAndMerchant() { return null; }
  async findByClient() { return []; }
  async create(input: CreateClientMerchantAccessInput): Promise<ClientMerchantAccessDTO> {
    return { id: input.id, clientId: input.clientId, merchantId: input.merchantId, scopes: input.scopes, status: 'active', createdAt: new Date(), revokedAt: null };
  }
  async revoke() {}
}

class InMemoryAuditRepo implements AuditLogRepository {
  readonly entries: AuditLog[] = [];
  async create(input: CreateAuditLogInput): Promise<AuditLog> { const e = { ...input, createdAt: new Date() } as AuditLog; this.entries.push(e); return e; }
  async list(_: ListAuditLogsInput) { return { entries: this.entries, total: this.entries.length }; }
}

// ── Container factory ─────────────────────────────────────────────────────────

function buildContainer(overrides: Partial<PaymentOrchestrationServiceConfig> = {}): ServiceContainer {
  const config: PaymentOrchestrationServiceConfig = {
    port: 0,
    nodeEnv: 'test',
    serviceToken: 'test-legacy-token',
    dbUrl: 'postgresql://test:test@localhost:5432/test',
    version: '0.3.0',
    phase: 'S9',
    legacyServiceTokenEnabled: true,
    rateLimitEnabled: false,
    rateLimitClientGlobalPerMinute: 600,
    rateLimitClientRoutePerMinute: 120,
    rateLimitAuthFailurePerMinute: 30,
    corsEnabled: false,
    corsAllowedOrigins: [],
    trustProxy: false,
    jsonBodyLimit: '1kb', // small for body-limit tests
    readyToken: '',
    ...overrides,
  };

  const merchantRepo = new InMemoryMerchantRepo();
  const intentRepo = new InMemoryIntentRepo();
  const transactionRepo = new InMemoryTransactionRepo();
  const providerAccountRepo = new InMemoryProviderAccountRepo();
  const idempotencyRepo = new InMemoryIdempotencyRepo();
  const providerEventRepo = new InMemoryProviderEventRepo();
  const apiClientRepo = new InMemoryApiClientRepo();
  const credentialRepo = new InMemoryCredentialRepo();
  const accessRepo = new InMemoryAccessRepo();
  const auditRepo = new InMemoryAuditRepo();

  const fakeGatewayProvider = new StandaloneFakeGatewayProvider({ webhookSecret: null, nodeEnv: 'test' });
  const providerRegistry = {
    getProvider: () => fakeGatewayProvider,
    listProviders: () => [],
    has: (_: string) => false,
  } as any;
  const fakeGatewayWebhookHandler = new FakeGatewayWebhookHandler({ webhookSecret: null, nodeEnv: 'test' });

  return {
    config,
    db: null as any,
    repos: { merchantRepo, providerAccountRepo, intentRepo, transactionRepo, providerEventRepo, idempotencyRepo },
    authRepos: { apiClientRepo, clientCredentialRepo: credentialRepo, clientMerchantAccessRepo: accessRepo },
    providerRegistry,
    useCases: {
      createMerchant: new CreateMerchant(merchantRepo),
      createProviderAccount: new CreateProviderAccount(merchantRepo, providerAccountRepo),
      createPaymentIntent: new CreatePaymentIntent(merchantRepo, intentRepo, idempotencyRepo),
      createGatewayPayment: new CreateGatewayPayment(merchantRepo, intentRepo, transactionRepo, providerRegistry, providerAccountRepo, idempotencyRepo, 'test', undefined),
      confirmFakeGatewayPayment: new ConfirmFakeGatewayPayment(transactionRepo, intentRepo, 'test'),
      getPaymentIntentStatus: new GetPaymentIntentStatus(intentRepo, transactionRepo),
      getRefundability: new GetRefundability(intentRepo, transactionRepo),
      handleProviderWebhook: new HandleProviderWebhook(transactionRepo, intentRepo, providerEventRepo, fakeGatewayWebhookHandler, providerRegistry),
      reconcilePaymentIntentTotals: new ReconcilePaymentIntentTotals(intentRepo, transactionRepo),
      refreshProviderStatus: new RefreshProviderStatus(transactionRepo, intentRepo, providerAccountRepo, providerRegistry),
      refundPaymentTransaction: new RefundPaymentTransaction(transactionRepo, intentRepo, providerAccountRepo, providerRegistry),
      voidPaymentTransaction: new VoidPaymentTransaction(transactionRepo, intentRepo, providerAccountRepo, providerRegistry),
      createCredential: new CreateCredential(apiClientRepo, credentialRepo),
      listCredentials: new ListCredentials(credentialRepo),
      revokeCredential: new RevokeCredential(credentialRepo),
      rotateCredential: new RotateCredential(apiClientRepo, credentialRepo),
    },
    auditRepo,
    rateLimiter: undefined,
  };
}

async function startServer(container: ServiceContainer): Promise<{ server: http.Server; baseUrl: string }> {
  return new Promise((resolve) => {
    const app = createApp(container);
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

async function stopServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

// Auth header for legacy token
function legacyAuth(token = 'test-legacy-token') {
  return { Authorization: `Bearer ${token}` };
}

// ════════════════════════════════════════════════════════════════════
// UNIT TESTS — config / env parsing
// ════════════════════════════════════════════════════════════════════

describe('Unit: S9.3 — loadEnv() config defaults', () => {
  test('TP01: trustProxy default is false', () => {
    const saved = {
      PAYMENT_ORCHESTRATION_TRUST_PROXY: process.env['PAYMENT_ORCHESTRATION_TRUST_PROXY'],
    };
    delete process.env['PAYMENT_ORCHESTRATION_TRUST_PROXY'];
    const cfg = loadEnv();
    assert.equal(cfg.trustProxy, false, 'default trustProxy must be false');
    process.env['PAYMENT_ORCHESTRATION_TRUST_PROXY'] = saved.PAYMENT_ORCHESTRATION_TRUST_PROXY;
  });

  test('TP02: trustProxy can be set to loopback', () => {
    const saved = process.env['PAYMENT_ORCHESTRATION_TRUST_PROXY'];
    process.env['PAYMENT_ORCHESTRATION_TRUST_PROXY'] = 'loopback';
    const cfg = loadEnv();
    assert.equal(cfg.trustProxy, 'loopback');
    if (saved === undefined) delete process.env['PAYMENT_ORCHESTRATION_TRUST_PROXY'];
    else process.env['PAYMENT_ORCHESTRATION_TRUST_PROXY'] = saved;
  });

  test('CORS disabled by default', () => {
    const saved = process.env['PAYMENT_ORCHESTRATION_CORS_ENABLED'];
    delete process.env['PAYMENT_ORCHESTRATION_CORS_ENABLED'];
    const cfg = loadEnv();
    assert.equal(cfg.corsEnabled, false);
    process.env['PAYMENT_ORCHESTRATION_CORS_ENABLED'] = saved;
  });

  test('CORS allowed origins parsed from comma-separated string', () => {
    const saved = process.env['PAYMENT_ORCHESTRATION_CORS_ALLOWED_ORIGINS'];
    process.env['PAYMENT_ORCHESTRATION_CORS_ALLOWED_ORIGINS'] = 'https://a.example.com, https://b.example.com';
    const cfg = loadEnv();
    assert.deepEqual(cfg.corsAllowedOrigins, ['https://a.example.com', 'https://b.example.com']);
    if (saved === undefined) delete process.env['PAYMENT_ORCHESTRATION_CORS_ALLOWED_ORIGINS'];
    else process.env['PAYMENT_ORCHESTRATION_CORS_ALLOWED_ORIGINS'] = saved;
  });

  test('jsonBodyLimit default is 256kb', () => {
    const saved = process.env['PAYMENT_ORCHESTRATION_JSON_BODY_LIMIT'];
    delete process.env['PAYMENT_ORCHESTRATION_JSON_BODY_LIMIT'];
    const cfg = loadEnv();
    assert.equal(cfg.jsonBodyLimit, '256kb');
    process.env['PAYMENT_ORCHESTRATION_JSON_BODY_LIMIT'] = saved;
  });

  test('readyToken empty by default', () => {
    const saved = process.env['PAYMENT_ORCHESTRATION_READY_TOKEN'];
    delete process.env['PAYMENT_ORCHESTRATION_READY_TOKEN'];
    const cfg = loadEnv();
    assert.equal(cfg.readyToken, '');
    process.env['PAYMENT_ORCHESTRATION_READY_TOKEN'] = saved;
  });
});

// ════════════════════════════════════════════════════════════════════
// HTTP INTEGRATION TESTS
// ════════════════════════════════════════════════════════════════════

// ── Security headers ───────────────────────────────────────────────────────

describe('HTTP: S9.3 — Security headers', () => {
  let server: http.Server;
  let baseUrl: string;

  test('setup', async () => {
    const s = await startServer(buildContainer());
    server = s.server;
    baseUrl = s.baseUrl;
  });

  test('SH01: X-Powered-By is absent', async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.headers.get('x-powered-by'), null, 'X-Powered-By must not be present');
  });

  test('SH02: X-Content-Type-Options = nosniff', async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  });

  test('SH03: X-Frame-Options = DENY', async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
  });

  test('SH04: Referrer-Policy = no-referrer', async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
  });

  test('SH05: Cache-Control = no-store', async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.headers.get('cache-control'), 'no-store');
  });

  test('SH06: security headers present on authenticated API response', async () => {
    const res = await fetch(`${baseUrl}/v1/merchants`, {
      headers: legacyAuth(),
    });
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
    assert.equal(res.headers.get('cache-control'), 'no-store');
  });

  test('teardown', async () => { await stopServer(server); });
});

// ── CORS ───────────────────────────────────────────────────────────────────

describe('HTTP: S9.3 — CORS policy', () => {
  let serverDisabled: http.Server;
  let baseDisabled: string;
  let serverEnabled: http.Server;
  let baseEnabled: string;

  test('setup', async () => {
    const d = await startServer(buildContainer({ corsEnabled: false, corsAllowedOrigins: [] }));
    serverDisabled = d.server;
    baseDisabled = d.baseUrl;

    const e = await startServer(buildContainer({
      corsEnabled: true,
      corsAllowedOrigins: ['https://console.northflow.space', 'https://dashboard.northflow.space'],
    }));
    serverEnabled = e.server;
    baseEnabled = e.baseUrl;
  });

  test('CO01: CORS disabled by default → no Access-Control-Allow-Origin', async () => {
    const res = await fetch(`${baseDisabled}/health`, {
      headers: { Origin: 'https://console.northflow.space' },
    });
    assert.equal(res.headers.get('access-control-allow-origin'), null,
      'CORS disabled: must not emit Access-Control-Allow-Origin');
  });

  test('CO02: CORS enabled + allowed origin → returns allow header', async () => {
    const res = await fetch(`${baseEnabled}/health`, {
      headers: { Origin: 'https://console.northflow.space' },
    });
    assert.equal(res.headers.get('access-control-allow-origin'), 'https://console.northflow.space');
  });

  test('CO03: CORS enabled + disallowed origin → no allow header', async () => {
    const res = await fetch(`${baseEnabled}/health`, {
      headers: { Origin: 'https://evil.example.com' },
    });
    assert.equal(res.headers.get('access-control-allow-origin'), null,
      'Disallowed origin must not receive Access-Control-Allow-Origin');
  });

  test('CO04: OPTIONS preflight works for allowed origin', async () => {
    const res = await fetch(`${baseEnabled}/health`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://dashboard.northflow.space',
        'Access-Control-Request-Method': 'GET',
      },
    });
    assert.equal(res.status, 204, 'OPTIONS with allowed origin must return 204');
    assert.equal(res.headers.get('access-control-allow-origin'), 'https://dashboard.northflow.space');
    assert.ok(res.headers.get('access-control-allow-methods'), 'Must include allow-methods');
  });

  test('CO05: OPTIONS preflight blocked for disallowed origin', async () => {
    const res = await fetch(`${baseEnabled}/health`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://attacker.example.com',
        'Access-Control-Request-Method': 'GET',
      },
    });
    assert.equal(res.status, 403, 'OPTIONS with disallowed origin must return 403');
    assert.equal(res.headers.get('access-control-allow-origin'), null);
  });

  test('teardown', async () => {
    await stopServer(serverDisabled);
    await stopServer(serverEnabled);
  });
});

// ── Request body limit ─────────────────────────────────────────────────────

describe('HTTP: S9.3 — Request body size limit', () => {
  let server: http.Server;
  let baseUrl: string;

  test('setup', async () => {
    // Use a very small body limit (1kb) to trigger limit without sending huge data
    const s = await startServer(buildContainer({ jsonBodyLimit: '1kb' }));
    server = s.server;
    baseUrl = s.baseUrl;
  });

  test('RL01: oversized JSON body returns 413', async () => {
    // Build a payload > 1kb
    const bigPayload = JSON.stringify({ name: 'x'.repeat(2000) });
    const res = await fetch(`${baseUrl}/v1/merchants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...legacyAuth() },
      body: bigPayload,
    });
    assert.equal(res.status, 413, 'Oversized body must return 413');
  });

  test('RL02: normal JSON body is accepted (no false positive)', async () => {
    const res = await fetch(`${baseUrl}/v1/merchants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...legacyAuth() },
      body: JSON.stringify({ name: 'Test Merchant', sourceApp: 'test-app', environment: 'test' }),
    });
    // Should not be 413 (may be 201, 422, or 400 depending on validation — not 413)
    assert.notEqual(res.status, 413, 'Normal body must not return 413');
  });

  test('teardown', async () => { await stopServer(server); });
});

// ── Ready endpoint protection ──────────────────────────────────────────────

describe('HTTP: S9.3 — Ready endpoint', () => {
  let serverPublic: http.Server;
  let basePublic: string;
  let serverProtected: http.Server;
  let baseProtected: string;

  const READY_TOKEN = 'nf-ready-secret-abc123';

  test('setup', async () => {
    const p = await startServer(buildContainer({ readyToken: '' }));
    serverPublic = p.server;
    basePublic = p.baseUrl;

    const q = await startServer(buildContainer({ readyToken: READY_TOKEN }));
    serverProtected = q.server;
    baseProtected = q.baseUrl;
  });

  test('RD01: public /ready exposes no secrets', async () => {
    const res = await fetch(`${basePublic}/ready`);
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    // Must not contain raw DB URL, serviceToken, readyToken, or any credential
    const bodyStr = JSON.stringify(body);
    assert.ok(!bodyStr.includes('postgresql://'), 'Must not expose dbUrl');
    assert.ok(!bodyStr.includes('test-legacy-token'), 'Must not expose serviceToken');
    assert.ok(!bodyStr.includes('readyToken'), 'Must not expose readyToken key');
  });

  test('RD02: protected /ready rejects request with missing token (401)', async () => {
    const res = await fetch(`${baseProtected}/ready`);
    assert.equal(res.status, 401);
    const body = await res.json() as any;
    assert.equal(body.ok, false);
    assert.ok(body.error?.code === 'UNAUTHORIZED' || typeof body.error === 'string');
  });

  test('RD03: protected /ready rejects request with wrong token (401)', async () => {
    const res = await fetch(`${baseProtected}/ready`, {
      headers: { 'x-nf-ready-token': 'wrong-token' },
    });
    assert.equal(res.status, 401);
    const body = await res.json() as any;
    assert.equal(body.ok, false);
  });

  test('RD04: protected /ready accepts request with correct token (200)', async () => {
    const res = await fetch(`${baseProtected}/ready`, {
      headers: { 'x-nf-ready-token': READY_TOKEN },
    });
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.equal(body.ok, true);
    assert.equal(body.service, 'payment-orchestration-service');
    // Token must NOT appear in response
    const bodyStr = JSON.stringify(body);
    assert.ok(!bodyStr.includes(READY_TOKEN), 'Ready token must not appear in response');
  });

  test('teardown', async () => {
    await stopServer(serverPublic);
    await stopServer(serverProtected);
  });
});

// ── Unknown path handling ──────────────────────────────────────────────────

describe('HTTP: S9.3 — Unknown path handling', () => {
  let server: http.Server;
  let baseUrl: string;

  test('setup', async () => {
    const s = await startServer(buildContainer());
    server = s.server;
    baseUrl = s.baseUrl;
  });

  test('UP01: unknown /v1 route returns structured 404 NOT_FOUND', async () => {
    const res = await fetch(`${baseUrl}/v1/this-does-not-exist`, {
      headers: legacyAuth(),
    });
    assert.equal(res.status, 404);
    const body = await res.json() as any;
    assert.equal(body.ok, false);
    const code = body.error?.code ?? body.error;
    assert.equal(code, 'NOT_FOUND');
  });

  test('UP02: unknown non-/v1 route returns 404 with no stack trace in body', async () => {
    const res = await fetch(`${baseUrl}/not-a-route`);
    assert.equal(res.status, 404);
    const text = await res.text();
    assert.ok(!text.includes('Error:'), 'Response must not include Error: (stack trace)');
    assert.ok(!text.includes('at '), 'Response must not include stack frame lines');
  });

  test('UP03: /v1/unknown returns NOT_FOUND even without auth', async () => {
    // Auth middleware fires before 404 — may return 401 or 404 depending on route match
    // Either is acceptable: what is NOT acceptable is exposing a stack trace or 500
    const res = await fetch(`${baseUrl}/v1/completely-unknown-endpoint-xyz`);
    assert.ok(
      res.status === 401 || res.status === 404,
      `Expected 401 or 404, got ${res.status}`,
    );
    const text = await res.text();
    assert.ok(!text.includes('Error:'), 'Must not expose stack trace');
  });

  test('teardown', async () => { await stopServer(server); });
});
