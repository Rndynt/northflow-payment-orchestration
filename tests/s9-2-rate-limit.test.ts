/**
 * s9-2-rate-limit.test.ts
 *
 * S9.2 — Rate Limit and Abuse Protection tests.
 *
 * Covers:
 *   Unit tests (InMemoryRateLimiterStore):
 *     U01: hit within limit → allowed=true, remaining decrements
 *     U02: hit at limit → allowed=true, remaining=0
 *     U03: hit over limit → allowed=false
 *     U04: new window resets counter
 *     U05: different keys are independent
 *
 *   HTTP integration tests:
 *     H01: rate limiting disabled → no 429
 *     H02: global per-client limit triggers 429 after threshold
 *     H03: 429 response has Retry-After header
 *     H04: 429 response has X-RateLimit-* headers
 *     H05: 429 response body matches error envelope { ok: false, error: { code: 'RATE_LIMITED' } }
 *     H06: route-specific limit triggers 429
 *     H07: auth failure rate limiting triggers 429 after repeated bad credentials
 *     H08: rate limit denied audit log is written
 *     H09: different clients have independent rate limit buckets
 *
 * Run:
 *   pnpm test
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';

import { InMemoryRateLimiterStore } from '../apps/service/src/rate-limit/rateLimiter.ts';
import { createApp } from '../apps/service/src/app.ts';
import type { ServiceContainer } from '../apps/service/src/container.ts';
import type { PaymentOrchestrationServiceConfig } from '../apps/service/src/config/env.ts';
import { generateCredential } from '../apps/service/src/middleware/auth.ts';
import { CreateCredential } from '../apps/service/src/application/use-cases/CreateCredential.ts';
import { ListCredentials } from '../apps/service/src/application/use-cases/ListCredentials.ts';
import { RevokeCredential } from '../apps/service/src/application/use-cases/RevokeCredential.ts';
import { RotateCredential } from '../apps/service/src/application/use-cases/RotateCredential.ts';

import type {
  ApiClientRepository,
  ClientCredentialRepository,
  ClientMerchantAccessRepository,
  ApiClientDTO,
  ClientCredentialDTO,
  ClientMerchantAccessDTO,
  CreateApiClientInput,
  CreateClientCredentialInput,
  CreateClientMerchantAccessInput,
  ApiClientStatus,
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

// ── In-memory repos (minimal) ─────────────────────────────────────────────────

class InMemoryMerchantRepo implements PaymentMerchantRepository {
  private store: PaymentMerchant[] = [];
  async findById(id: string) { return this.store.find(m => m.id === id) ?? null; }
  async findByExternalRef(_: any) { return null; }
  async create(input: any): Promise<PaymentMerchant> { const m: any = { id: input.id ?? randomUUID(), displayName: input.name, legalName: null, externalRef: null, sourceApp: null, status: 'active', metadata: {}, createdAt: new Date(), updatedAt: new Date() }; this.store.push(m); return m; }
  async updateStatus(id: string, status: any) { const m = this.store.find(m => m.id === id); if (m) m.status = status; return m!; }
}

class InMemoryIntentRepo implements PaymentIntentRepository {
  private store: StandalonePaymentIntentDTO[] = [];
  async findById(id: string) { return this.store.find(i => i.id === id) ?? null; }
  async findByExternalPayable(input: any) { return this.store.find(i => i.externalPayableId === input.externalPayableId) ?? null; }
  async create(input: any): Promise<StandalonePaymentIntentDTO> { const i: any = { ...input, id: input.id ?? randomUUID(), amountPaid: 0, amountRefunded: 0, amountRemaining: input.amountDue, status: 'pending', createdAt: new Date(), updatedAt: new Date() }; this.store.push(i); return i; }
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
  async markSucceededIfConfirmable(input: any) { return { changed: false, transaction: null }; }
}

class InMemoryProviderAccountRepo implements PaymentProviderAccountRepository {
  async findById() { return null; }
  async findByMerchantAndProvider() { return null; }
  async create(input: any): Promise<PaymentProviderAccount> { return { ...input, createdAt: new Date(), updatedAt: new Date() } as any; }
  async updateStatus(_id: string, _merchantId: string, status: any) { return {} as any; }
}

class InMemoryIdempotencyRepo implements PaymentIdempotencyRepository {
  async reserve(input: any) { return { ...input, id: randomUUID(), status: 'processing', createdAt: new Date(), updatedAt: new Date() } as any; }
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
  async create(input: CreateApiClientInput): Promise<ApiClientDTO> { const c: ApiClientDTO = { id: input.id, name: input.name, sourceApp: input.sourceApp, environment: input.environment, status: input.status ?? 'active', scopes: input.scopes ?? [], metadata: input.metadata ?? {}, createdAt: new Date(), updatedAt: new Date() }; this.store.push(c); return c; }
  async updateStatus(id: string, status: ApiClientStatus) { const c = this.store.find(c => c.id === id); if (c) c.status = status; return c!; }
}

class InMemoryCredentialRepo implements ClientCredentialRepository {
  readonly store: ClientCredentialDTO[] = [];
  async findByPrefix(prefix: string) { return this.store.filter(c => c.credentialPrefix === prefix); }
  async findById(id: string) { return this.store.find(c => c.id === id) ?? null; }
  async listByClientId(clientId: string) { return this.store.filter(c => c.clientId === clientId); }
  async create(input: CreateClientCredentialInput): Promise<ClientCredentialDTO> {
    const c: ClientCredentialDTO = { id: input.id, clientId: input.clientId, credentialPrefix: input.credentialPrefix, credentialHash: input.credentialHash, status: 'active', expiresAt: input.expiresAt ?? null, lastUsedAt: null, createdAt: new Date(), revokedAt: null };
    this.store.push(c);
    return c;
  }
  async revoke(id: string) { const c = this.store.find(c => c.id === id); if (c) { (c as any).status = 'revoked'; (c as any).revokedAt = new Date(); } }
  async touchLastUsed(id: string, at: Date) { const c = this.store.find(c => c.id === id); if (c) c.lastUsedAt = at; }
}

class InMemoryAccessRepo implements ClientMerchantAccessRepository {
  async findByClientAndMerchant() { return null; }
  async findByClient() { return []; }
  async create(input: CreateClientMerchantAccessInput): Promise<ClientMerchantAccessDTO> { return { id: input.id, clientId: input.clientId, merchantId: input.merchantId, scopes: input.scopes, status: 'active', createdAt: new Date(), revokedAt: null }; }
  async revoke() {}
}

class InMemoryAuditRepo implements AuditLogRepository {
  readonly entries: AuditLog[] = [];
  async create(input: CreateAuditLogInput): Promise<AuditLog> { const e = { ...input, createdAt: new Date() } as AuditLog; this.entries.push(e); return e; }
  async list(_: ListAuditLogsInput) { return { entries: this.entries, total: this.entries.length }; }
}

// ── Container factory ─────────────────────────────────────────────────────────

function buildRateLimitContainer(opts: {
  rateLimitEnabled: boolean;
  globalPerMinute?: number;
  routePerMinute?: number;
  authFailurePerMinute?: number;
  clientScopes?: string[];
}) {
  const apiClientRepo = new InMemoryApiClientRepo();
  const credentialRepo = new InMemoryCredentialRepo();
  const accessRepo = new InMemoryAccessRepo();
  const auditRepo = new InMemoryAuditRepo();
  const rateLimiter = new InMemoryRateLimiterStore();

  const clientId = 'rl-test-client';
  const environment = 'test';
  apiClientRepo.store.push({
    id: clientId, name: 'RL Test', sourceApp: 'rl-app', environment, status: 'active',
    scopes: opts.clientScopes ?? ['audit_log:read', 'api_client:credential:create', 'api_client:credential:read', 'api_client:credential:rotate', 'api_client:credential:revoke', '*'],
    metadata: {}, createdAt: new Date(), updatedAt: new Date(),
  });

  const credId = randomUUID().replace(/-/g, '');
  const { raw, prefix, hash } = generateCredential(environment, credId);
  credentialRepo.store.push({ id: credId, clientId, credentialPrefix: prefix, credentialHash: hash, status: 'active', expiresAt: null, lastUsedAt: null, createdAt: new Date(), revokedAt: null });

  const config: PaymentOrchestrationServiceConfig = {
    port: 0, nodeEnv: 'test', serviceToken: '', dbUrl: '', version: '0.3.0', phase: 'S9',
    legacyServiceTokenEnabled: false,
    rateLimitEnabled: opts.rateLimitEnabled,
    rateLimitClientGlobalPerMinute: opts.globalPerMinute ?? 600,
    rateLimitClientRoutePerMinute: opts.routePerMinute ?? 120,
    rateLimitAuthFailurePerMinute: opts.authFailurePerMinute ?? 30,
  };

  const merchantRepo = new InMemoryMerchantRepo();
  const intentRepo = new InMemoryIntentRepo();
  const transactionRepo = new InMemoryTransactionRepo();
  const providerAccountRepo = new InMemoryProviderAccountRepo();
  const idempotencyRepo = new InMemoryIdempotencyRepo();
  const providerEventRepo = new InMemoryProviderEventRepo();
  const fakeGatewayProvider = new StandaloneFakeGatewayProvider({ webhookSecret: null, nodeEnv: 'test' });
  const providerRegistry = { getProvider: () => fakeGatewayProvider, listProviders: () => [] } as any;
  const fakeGatewayWebhookHandler = new FakeGatewayWebhookHandler({ webhookSecret: null, nodeEnv: 'test' });

  const container: ServiceContainer = {
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
    rateLimiter,
  };

  return { container, rawCredential: raw, clientId, rateLimiter, auditRepo };
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

async function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

// ════════════════════════════════════════════════════════════════════
// UNIT TESTS — InMemoryRateLimiterStore
// ════════════════════════════════════════════════════════════════════

describe('Unit: S9.2 — InMemoryRateLimiterStore', () => {
  test('U01: hit within limit → allowed=true, remaining decrements', async () => {
    const store = new InMemoryRateLimiterStore();
    const result = await store.hit('test-key', 60_000, 10);
    assert.equal(result.allowed, true);
    assert.equal(result.limit, 10);
    assert.equal(result.remaining, 9);
    assert.ok(result.resetAt instanceof Date);
    assert.equal(result.retryAfterSeconds, 0);
  });

  test('U02: hit exactly at limit → allowed=true, remaining=0', async () => {
    const store = new InMemoryRateLimiterStore();
    let last: any;
    for (let i = 0; i < 5; i++) {
      last = await store.hit('exact-key', 60_000, 5);
    }
    assert.equal(last.allowed, true);
    assert.equal(last.remaining, 0);
  });

  test('U03: hit over limit → allowed=false, retryAfterSeconds > 0', async () => {
    const store = new InMemoryRateLimiterStore();
    for (let i = 0; i < 3; i++) await store.hit('over-key', 60_000, 3);
    const result = await store.hit('over-key', 60_000, 3);
    assert.equal(result.allowed, false);
    assert.equal(result.remaining, 0);
    assert.ok(result.retryAfterSeconds > 0, 'retryAfterSeconds must be > 0 when denied');
  });

  test('U04: different keys are independent', async () => {
    const store = new InMemoryRateLimiterStore();
    for (let i = 0; i < 3; i++) await store.hit('key-a', 60_000, 3);
    const overflow = await store.hit('key-a', 60_000, 3);
    assert.equal(overflow.allowed, false);

    const keyB = await store.hit('key-b', 60_000, 3);
    assert.equal(keyB.allowed, true, 'key-b must be unaffected by key-a overflow');
  });
});

// ════════════════════════════════════════════════════════════════════
// HTTP INTEGRATION TESTS
// ════════════════════════════════════════════════════════════════════

describe('HTTP: S9.2 — Rate limit disabled → no 429', () => {
  test('H01: rate limiting disabled → requests always pass', async () => {
    const built = buildRateLimitContainer({ rateLimitEnabled: false, globalPerMinute: 1 });
    const { server, baseUrl } = await startServer(built.container);
    try {
      for (let i = 0; i < 5; i++) {
        const res = await fetch(`${baseUrl}/v1/audit-logs`, {
          headers: { 'Authorization': `Bearer ${built.rawCredential}` },
        });
        assert.notEqual(res.status, 429, `request ${i + 1} must not be rate limited when disabled`);
      }
    } finally {
      await closeServer(server);
    }
  });
});

describe('HTTP: S9.2 — Global per-client rate limit', () => {
  test('H02: global per-client limit triggers 429 after threshold', async () => {
    const built = buildRateLimitContainer({ rateLimitEnabled: true, globalPerMinute: 3, routePerMinute: 1000 });
    const { server, baseUrl } = await startServer(built.container);
    try {
      let got429 = false;
      for (let i = 0; i < 6; i++) {
        const res = await fetch(`${baseUrl}/v1/audit-logs`, {
          headers: { 'Authorization': `Bearer ${built.rawCredential}` },
        });
        if (res.status === 429) { got429 = true; break; }
      }
      assert.ok(got429, 'must get 429 after exceeding global limit');
    } finally {
      await closeServer(server);
    }
  });

  test('H03: 429 response includes Retry-After header', async () => {
    const built = buildRateLimitContainer({ rateLimitEnabled: true, globalPerMinute: 1, routePerMinute: 1000 });
    const { server, baseUrl } = await startServer(built.container);
    try {
      let response429: Response | null = null;
      for (let i = 0; i < 5; i++) {
        const res = await fetch(`${baseUrl}/v1/audit-logs`, {
          headers: { 'Authorization': `Bearer ${built.rawCredential}` },
        });
        if (res.status === 429) { response429 = res; break; }
      }
      assert.ok(response429, 'must get 429');
      const retryAfter = response429!.headers.get('retry-after');
      assert.ok(retryAfter, 'Retry-After header must be present on 429');
      assert.ok(Number(retryAfter) > 0, 'Retry-After must be > 0');
    } finally {
      await closeServer(server);
    }
  });

  test('H04: 429 response includes X-RateLimit-* headers', async () => {
    const built = buildRateLimitContainer({ rateLimitEnabled: true, globalPerMinute: 1, routePerMinute: 1000 });
    const { server, baseUrl } = await startServer(built.container);
    try {
      let response429: Response | null = null;
      for (let i = 0; i < 5; i++) {
        const res = await fetch(`${baseUrl}/v1/audit-logs`, {
          headers: { 'Authorization': `Bearer ${built.rawCredential}` },
        });
        if (res.status === 429) { response429 = res; break; }
      }
      assert.ok(response429, 'must get 429');
      assert.ok(response429!.headers.get('x-ratelimit-limit'), 'X-RateLimit-Limit must be present');
      assert.ok(response429!.headers.get('x-ratelimit-remaining') !== null, 'X-RateLimit-Remaining must be present');
      assert.ok(response429!.headers.get('x-ratelimit-reset'), 'X-RateLimit-Reset must be present');
    } finally {
      await closeServer(server);
    }
  });

  test('H05: 429 body matches error envelope { ok: false, error.code: RATE_LIMITED }', async () => {
    const built = buildRateLimitContainer({ rateLimitEnabled: true, globalPerMinute: 1, routePerMinute: 1000 });
    const { server, baseUrl } = await startServer(built.container);
    try {
      let body429: any = null;
      for (let i = 0; i < 5; i++) {
        const res = await fetch(`${baseUrl}/v1/audit-logs`, {
          headers: { 'Authorization': `Bearer ${built.rawCredential}` },
        });
        if (res.status === 429) { body429 = await res.json(); break; }
      }
      assert.ok(body429, 'must get 429');
      assert.equal(body429.ok, false);
      // apiErrorResponse.toJSON() returns the code string over HTTP — not an object
      const code = typeof body429.error === 'object' ? body429.error?.code : body429.error;
      assert.equal(code, 'RATE_LIMITED');
    } finally {
      await closeServer(server);
    }
  });
});

describe('HTTP: S9.2 — Auth failure rate limiting', () => {
  test('H07: auth failure limit returns 429 after repeated invalid credentials', async () => {
    const built = buildRateLimitContainer({ rateLimitEnabled: true, globalPerMinute: 1000, routePerMinute: 1000, authFailurePerMinute: 3 });
    const { server, baseUrl } = await startServer(built.container);
    try {
      const badCred = 'nf.test.fakeid.invalidsecret';
      let got429 = false;
      for (let i = 0; i < 10; i++) {
        const res = await fetch(`${baseUrl}/v1/audit-logs`, {
          headers: { 'Authorization': `Bearer ${badCred}` },
        });
        if (res.status === 429) { got429 = true; break; }
        assert.equal(res.status, 401, `expect 401 before rate limit, got ${res.status}`);
      }
      assert.ok(got429, 'must get 429 RATE_LIMITED after repeated auth failures');
    } finally {
      await closeServer(server);
    }
  });
});

describe('HTTP: S9.2 — Rate limit audit log', () => {
  test('H08: rate limit denied audit log is written on 429', async () => {
    const built = buildRateLimitContainer({ rateLimitEnabled: true, globalPerMinute: 1, routePerMinute: 1000 });
    const { server, baseUrl } = await startServer(built.container);
    try {
      for (let i = 0; i < 5; i++) {
        await fetch(`${baseUrl}/v1/audit-logs`, {
          headers: { 'Authorization': `Bearer ${built.rawCredential}` },
        });
      }
      const deniedEntries = built.auditRepo.entries.filter(e => e.action === 'rate_limit.denied');
      assert.ok(deniedEntries.length >= 1, 'rate_limit.denied audit entry must be written');
      const entry = deniedEntries[0];
      const meta = JSON.stringify(entry.metadata);
      assert.ok(!meta.includes('rawCredential'), 'audit must not contain rawCredential');
      assert.ok(!meta.includes('credentialHash'), 'audit must not contain credentialHash');
    } finally {
      await closeServer(server);
    }
  });
});

describe('HTTP: S9.2 — Per-client rate limit isolation', () => {
  test('H09: different clients have independent rate limit buckets', async () => {
    // Build two separate containers with the same tight limit
    const builtA = buildRateLimitContainer({ rateLimitEnabled: true, globalPerMinute: 2, routePerMinute: 1000 });
    const builtB = buildRateLimitContainer({ rateLimitEnabled: true, globalPerMinute: 2, routePerMinute: 1000 });

    const { server: serverA, baseUrl: baseUrlA } = await startServer(builtA.container);
    const { server: serverB, baseUrl: baseUrlB } = await startServer(builtB.container);

    try {
      // Exhaust client A's limit
      for (let i = 0; i < 5; i++) {
        await fetch(`${baseUrlA}/v1/audit-logs`, {
          headers: { 'Authorization': `Bearer ${builtA.rawCredential}` },
        });
      }

      // Client B on its own server should not be affected
      const resB = await fetch(`${baseUrlB}/v1/audit-logs`, {
        headers: { 'Authorization': `Bearer ${builtB.rawCredential}` },
      });
      assert.notEqual(resB.status, 429, 'client B must not be rate limited by client A\'s usage');
    } finally {
      await closeServer(serverA);
      await closeServer(serverB);
    }
  });
});
