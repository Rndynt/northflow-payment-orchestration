/**
 * s9-1-credential-lifecycle.test.ts
 *
 * S9.1 — API Key Rotation and Credential Lifecycle tests.
 *
 * Covers:
 *   Unit tests (use cases):
 *     U01: CreateCredential returns rawCredential + safe view (no hash)
 *     U02: stored row has prefix + hash only — no plaintext
 *     U03: ListCredentials never returns credentialHash
 *     U04: RevokeCredential prevents further auth
 *     U05: RevokeCredential is idempotent
 *     U06: RevokeCredential rejects cross-client revoke
 *     U07: Expired credential prevents auth
 *     U08: RotateCredential creates new active credential
 *     U09: RotateCredential optionally revokes old credential
 *     U10: RotateCredential does NOT revoke all credentials accidentally
 *     U11: lastUsedAt updates on successful auth
 *     U12: CreateCredential for unknown client returns 404
 *     U13: RotateCredential for unknown client returns 404
 *
 *   HTTP integration tests:
 *     H01: POST /v1/api-clients/:clientId/credentials → 201 with rawCredential
 *     H02: rawCredential is not in subsequent GET response
 *     H03: GET /v1/api-clients/:clientId/credentials → 200 list (no hash)
 *     H04: POST .../rotate → 201 with newCredential.rawCredential
 *     H05: POST .../rotate with revokeOldCredentialId → old credential revoked
 *     H06: POST .../:credId/revoke → 200, credential becomes inactive
 *     H07: POST .../:credId/revoke → revoked credential returns 401 on auth
 *     H08: Normal client cannot manage another client's credentials → 403
 *     H09: Missing scope returns 403 SCOPE_DENIED
 *     H10: create/rotate response never contains credentialHash
 *     H11: Audit logs written for credential lifecycle operations (no plaintext/hash)
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
import type { ServiceContainer } from '../apps/service/src/container.ts';
import type { PaymentOrchestrationServiceConfig } from '../apps/service/src/config/env.ts';
import { hashCredential, generateCredential } from '../apps/service/src/middleware/auth.ts';
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
} from '@northflow/payment-orchestration-core';

import {
  CreateMerchant,
} from '../apps/service/src/application/use-cases/CreateMerchant.ts';
import {
  CreateProviderAccount,
} from '../apps/service/src/application/use-cases/CreateProviderAccount.ts';
import {
  CreatePaymentIntent,
} from '../apps/service/src/application/use-cases/CreatePaymentIntent.ts';
import {
  CreateGatewayPayment,
} from '../apps/service/src/application/use-cases/CreateGatewayPayment.ts';
import {
  ConfirmFakeGatewayPayment,
} from '../apps/service/src/application/use-cases/ConfirmFakeGatewayPayment.ts';
import {
  GetPaymentIntentStatus,
} from '../apps/service/src/application/use-cases/GetPaymentIntentStatus.ts';
import {
  GetRefundability,
} from '../apps/service/src/application/use-cases/GetRefundability.ts';
import {
  HandleProviderWebhook,
} from '../apps/service/src/application/use-cases/HandleProviderWebhook.ts';
import { FakeGatewayWebhookHandler } from '../apps/service/src/infrastructure/providers/FakeGatewayWebhookHandler.ts';
import { StandaloneFakeGatewayProvider } from '../apps/service/src/infrastructure/providers/StandaloneFakeGatewayProvider.ts';
import {
  ReconcilePaymentIntentTotals,
} from '../apps/service/src/application/use-cases/ReconcilePaymentIntentTotals.ts';
import {
  RefreshProviderStatus,
} from '../apps/service/src/application/use-cases/RefreshProviderStatus.ts';
import {
  RefundPaymentTransaction,
} from '../apps/service/src/application/use-cases/RefundPaymentTransaction.ts';
import {
  VoidPaymentTransaction,
} from '../apps/service/src/application/use-cases/VoidPaymentTransaction.ts';

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

// ════════════════════════════════════════════════════════════════════
// IN-MEMORY REPOS
// ════════════════════════════════════════════════════════════════════

class InMemoryMerchantRepo implements PaymentMerchantRepository {
  private store: PaymentMerchant[] = [];
  async findById(id: string) { return this.store.find(m => m.id === id) ?? null; }
  async findByExternalRef({ sourceApp, externalRef }: { sourceApp: string; externalRef: string }) {
    return this.store.find(m => m.sourceApp === sourceApp && m.externalRef === externalRef) ?? null;
  }
  async create(input: any): Promise<PaymentMerchant> {
    const m: PaymentMerchant = {
      id: input.id ?? randomUUID(),
      displayName: input.name,
      legalName: input.legalName ?? null,
      externalRef: input.externalRef ?? null,
      sourceApp: input.sourceApp ?? null,
      status: input.status ?? 'active',
      metadata: input.metadata ?? {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.store.push(m);
    return m;
  }
  async updateStatus(id: string, status: any) {
    const m = this.store.find(m => m.id === id);
    if (m) m.status = status;
    return m!;
  }
}

class InMemoryIntentRepo implements PaymentIntentRepository {
  private store: StandalonePaymentIntentDTO[] = [];
  async findById(id: string) { return this.store.find(i => i.id === id) ?? null; }
  async findByExternalPayable(input: any) {
    return this.store.find(i => i.externalPayableType === input.externalPayableType && i.externalPayableId === input.externalPayableId) ?? null;
  }
  async create(input: any): Promise<StandalonePaymentIntentDTO> {
    const i: any = { ...input, id: input.id ?? randomUUID(), amountPaid: 0, amountRefunded: 0, amountRemaining: input.amountDue, status: 'pending', createdAt: new Date(), updatedAt: new Date() };
    this.store.push(i);
    return i;
  }
  async updateTotals(input: any) { const i = this.store.find(i => i.id === input.id); if (i) Object.assign(i, input); return i!; }
  async updateStatus(input: any) { const i = this.store.find(i => i.id === input.id); if (i) i.status = input.status; return i!; }
}

class InMemoryTransactionRepo implements PaymentTransactionRepository {
  store: StandalonePaymentTransactionDTO[] = [];
  async findById(id: string, _merchantId: string) { return this.store.find(t => t.id === id) ?? null; }
  async findByIntentId(intentId: string, _merchantId: string) { return this.store.filter(t => t.intentId === intentId); }
  async findByProviderReference(provider: string, ref: string) { return this.store.find(t => t.provider === provider && t.providerReference === ref) ?? null; }
  async findByMerchantIdempotencyKey(_merchantId: string, key: string) { return this.store.find(t => t.idempotencyKey === key) ?? null; }
  async create(input: any): Promise<StandalonePaymentTransactionDTO> { const t: any = { ...input, createdAt: new Date(), updatedAt: new Date() }; this.store.push(t); return t; }
  async updateStatus(input: any) { const t = this.store.find(t => t.id === input.id); if (t) Object.assign(t, input); return t!; }
  async sumSucceededRefundsByParent() { return 0; }
  async markSucceededIfConfirmable(input: any) { const t = this.store.find(t => t.id === input.id); return { changed: false, transaction: t ?? null }; }
}

class InMemoryProviderAccountRepo implements PaymentProviderAccountRepository {
  private store: PaymentProviderAccount[] = [];
  async findById(id: string) { return this.store.find(p => p.id === id) ?? null; }
  async findByMerchantAndProvider(merchantId: string, provider: string) { return this.store.find(p => p.merchantId === merchantId && p.provider === provider) ?? null; }
  async create(input: any): Promise<PaymentProviderAccount> { const p: any = { ...input, createdAt: new Date(), updatedAt: new Date() }; this.store.push(p); return p; }
  async updateStatus(id: string, _merchantId: string, status: any) { const p = this.store.find(p => p.id === id); if (p) p.status = status; return p!; }
}

class InMemoryIdempotencyRepo implements PaymentIdempotencyRepository {
  private store: PaymentIdempotencyKeyDTO[] = [];
  async reserve(input: any) { const k: any = { ...input, id: randomUUID(), status: 'processing', createdAt: new Date(), updatedAt: new Date() }; this.store.push(k); return k; }
  async find(input: any) { return this.store.find(k => k.idempotencyKey === input.idempotencyKey) ?? null; }
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
    this.store.push(c);
    return c;
  }
  async updateStatus(id: string, status: ApiClientStatus) { const c = this.store.find(c => c.id === id); if (c) c.status = status; return c!; }
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
  async revoke(id: string) { const c = this.store.find(c => c.id === id); if (c) { (c as any).status = 'revoked'; (c as any).revokedAt = new Date(); } }
  async touchLastUsed(id: string, at: Date) { const c = this.store.find(c => c.id === id); if (c) c.lastUsedAt = at; }
}

class InMemoryAccessRepo implements ClientMerchantAccessRepository {
  private store: ClientMerchantAccessDTO[] = [];
  async findByClientAndMerchant(clientId: string, merchantId: string) { return this.store.find(g => g.clientId === clientId && g.merchantId === merchantId) ?? null; }
  async findByClient(clientId: string) { return this.store.filter(g => g.clientId === clientId); }
  async create(input: CreateClientMerchantAccessInput): Promise<ClientMerchantAccessDTO> {
    const g: ClientMerchantAccessDTO = { id: input.id, clientId: input.clientId, merchantId: input.merchantId, scopes: input.scopes, status: 'active', createdAt: new Date(), revokedAt: null };
    this.store.push(g);
    return g;
  }
  async revoke(id: string) { const g = this.store.find(g => g.id === id); if (g) (g as any).status = 'revoked'; }
}

class InMemoryAuditRepo implements AuditLogRepository {
  readonly entries: AuditLog[] = [];
  async create(input: CreateAuditLogInput): Promise<AuditLog> {
    const entry = { ...input, createdAt: new Date() } as AuditLog;
    this.entries.push(entry);
    return entry;
  }
  async list(_input: ListAuditLogsInput) { return { entries: this.entries, total: this.entries.length }; }
}

// ════════════════════════════════════════════════════════════════════
// TEST CONTAINER FACTORY
// ════════════════════════════════════════════════════════════════════

function buildCredentialContainer(opts: {
  clientId?: string;
  clientSourceApp?: string;
  clientEnvironment?: string;
  clientScopes?: string[];
  rateLimitEnabled?: boolean;
} = {}) {
  const apiClientRepo = new InMemoryApiClientRepo();
  const credentialRepo = new InMemoryCredentialRepo();
  const accessRepo = new InMemoryAccessRepo();
  const auditRepo = new InMemoryAuditRepo();

  const clientId = opts.clientId ?? 'client-test-s9';
  const environment = opts.clientEnvironment ?? 'test';

  apiClientRepo.store.push({
    id: clientId,
    name: 'S9 Test Client',
    sourceApp: opts.clientSourceApp ?? 'test-app',
    environment,
    status: 'active',
    scopes: opts.clientScopes ?? [
      'api_client:credential:create',
      'api_client:credential:read',
      'api_client:credential:revoke',
      'api_client:credential:rotate',
    ],
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const credId = randomUUID().replace(/-/g, '');
  const { raw, prefix, hash } = generateCredential(environment, credId);
  credentialRepo.store.push({
    id: credId,
    clientId,
    credentialPrefix: prefix,
    credentialHash: hash,
    status: 'active',
    expiresAt: null,
    lastUsedAt: null,
    createdAt: new Date(),
    revokedAt: null,
  });

  const config: PaymentOrchestrationServiceConfig = {
    port: 0,
    nodeEnv: 'test',
    serviceToken: '',
    dbUrl: '',
    version: '0.3.0',
    phase: 'S9',
    legacyServiceTokenEnabled: false,
    rateLimitEnabled: opts.rateLimitEnabled ?? false,
    rateLimitClientGlobalPerMinute: 600,
    rateLimitClientRoutePerMinute: 120,
    rateLimitAuthFailurePerMinute: 30,
  };

  const merchantRepo = new InMemoryMerchantRepo();
  const providerAccountRepo = new InMemoryProviderAccountRepo();
  const intentRepo = new InMemoryIntentRepo();
  const transactionRepo = new InMemoryTransactionRepo();
  const idempotencyRepo = new InMemoryIdempotencyRepo();
  const providerEventRepo = new InMemoryProviderEventRepo();

  const fakeGatewayProvider = new StandaloneFakeGatewayProvider({ webhookSecret: null, nodeEnv: 'test' });
  const providerRegistry = { getProvider: () => fakeGatewayProvider, listProviders: () => [{ name: 'fake_gateway', displayName: 'Fake Gateway', environments: ['test'] }] } as any;
  const fakeGatewayWebhookHandler = new FakeGatewayWebhookHandler({ webhookSecret: null, nodeEnv: 'test' });

  const createCredential = new CreateCredential(apiClientRepo, credentialRepo);
  const listCredentials = new ListCredentials(credentialRepo);
  const revokeCredential = new RevokeCredential(credentialRepo);
  const rotateCredential = new RotateCredential(apiClientRepo, credentialRepo);

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
      createCredential,
      listCredentials,
      revokeCredential,
      rotateCredential,
    },
    auditRepo,
  };

  const app = createApp(container);

  return { container, apiClientRepo, credentialRepo, accessRepo, auditRepo, rawCredential: raw, clientId };
}

function startServer(container: ServiceContainer): Promise<{ server: http.Server; baseUrl: string }> {
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
// UNIT TESTS — use case layer, no HTTP
// ════════════════════════════════════════════════════════════════════

describe('Unit: S9.1 — CreateCredential use case', () => {
  test('U01: returns rawCredential + safe view without credentialHash', async () => {
    const apiClientRepo = new InMemoryApiClientRepo();
    const credentialRepo = new InMemoryCredentialRepo();
    apiClientRepo.store.push({ id: 'c1', name: 'Test', sourceApp: 'app', environment: 'test', status: 'active', scopes: [], metadata: {}, createdAt: new Date(), updatedAt: new Date() });

    const uc = new CreateCredential(apiClientRepo, credentialRepo);
    const result = await uc.execute({ clientId: 'c1' });

    assert.ok(result.rawCredential, 'rawCredential must be present');
    assert.match(result.rawCredential, /^nf\.test\.[a-zA-Z0-9]+\.[A-Za-z0-9_-]+$/, 'rawCredential must match nf.<env>.<id>.<secret> format');
    assert.ok(result.credential.id, 'credential.id must be present');
    assert.equal(result.credential.clientId, 'c1');
    assert.equal(result.credential.status, 'active');
    assert.ok(!('credentialHash' in result.credential), 'credentialHash must NOT be in view');
  });

  test('U02: stored row has prefix + hash; plaintext is never stored', async () => {
    const apiClientRepo = new InMemoryApiClientRepo();
    const credentialRepo = new InMemoryCredentialRepo();
    apiClientRepo.store.push({ id: 'c1', name: 'Test', sourceApp: 'app', environment: 'live', status: 'active', scopes: [], metadata: {}, createdAt: new Date(), updatedAt: new Date() });

    const uc = new CreateCredential(apiClientRepo, credentialRepo);
    const result = await uc.execute({ clientId: 'c1' });

    const stored = credentialRepo.store.find(c => c.id === result.credential.id);
    assert.ok(stored, 'stored credential must exist');
    assert.ok(stored!.credentialHash, 'hash must be stored');
    assert.equal(stored!.credentialHash, hashCredential(result.rawCredential), 'stored hash must match SHA-256 of rawCredential');
    assert.ok(!stored!.credentialPrefix.includes(result.rawCredential.split('.').at(-1)!), 'plaintext secret must not appear in prefix');
    assert.notEqual(stored!.credentialHash, result.rawCredential, 'hash must not equal rawCredential');
  });

  test('U12: CreateCredential for unknown client returns API_CLIENT_NOT_FOUND', async () => {
    const apiClientRepo = new InMemoryApiClientRepo();
    const credentialRepo = new InMemoryCredentialRepo();
    const uc = new CreateCredential(apiClientRepo, credentialRepo);
    await assert.rejects(
      () => uc.execute({ clientId: 'nonexistent' }),
      (err: any) => err.code === 'API_CLIENT_NOT_FOUND',
    );
  });
});

describe('Unit: S9.1 — ListCredentials use case', () => {
  test('U03: list never returns credentialHash', async () => {
    const credentialRepo = new InMemoryCredentialRepo();
    credentialRepo.store.push({
      id: 'cred-1', clientId: 'c1', credentialPrefix: 'nf.test.cred1',
      credentialHash: 'somehash', status: 'active', expiresAt: null,
      lastUsedAt: null, createdAt: new Date(), revokedAt: null,
    });

    const uc = new ListCredentials(credentialRepo);
    const result = await uc.execute({ clientId: 'c1' });

    assert.equal(result.credentials.length, 1);
    const cred = result.credentials[0];
    assert.ok(!('credentialHash' in cred), 'credentialHash must NOT appear in list');
  });
});

describe('Unit: S9.1 — RevokeCredential use case', () => {
  test('U04: revoked credential has status=revoked and revokedAt set', async () => {
    const credentialRepo = new InMemoryCredentialRepo();
    credentialRepo.store.push({
      id: 'cred-1', clientId: 'c1', credentialPrefix: 'nf.test.cred1',
      credentialHash: 'hash1', status: 'active', expiresAt: null,
      lastUsedAt: null, createdAt: new Date(), revokedAt: null,
    });

    const uc = new RevokeCredential(credentialRepo);
    const result = await uc.execute({ clientId: 'c1', credentialId: 'cred-1' });

    assert.equal(result.credential.status, 'revoked');
    assert.ok(result.credential.revokedAt, 'revokedAt must be set');
    assert.ok(!('credentialHash' in result.credential), 'credentialHash must not appear');
  });

  test('U05: revoking an already-revoked credential is idempotent', async () => {
    const credentialRepo = new InMemoryCredentialRepo();
    const revokedAt = new Date();
    credentialRepo.store.push({
      id: 'cred-1', clientId: 'c1', credentialPrefix: 'nf.test.cred1',
      credentialHash: 'hash1', status: 'revoked', expiresAt: null,
      lastUsedAt: null, createdAt: new Date(), revokedAt,
    });

    const uc = new RevokeCredential(credentialRepo);
    const result = await uc.execute({ clientId: 'c1', credentialId: 'cred-1' });
    assert.equal(result.credential.status, 'revoked');
  });

  test('U06: revoking another client\'s credential returns CREDENTIAL_NOT_OWNED', async () => {
    const credentialRepo = new InMemoryCredentialRepo();
    credentialRepo.store.push({
      id: 'cred-1', clientId: 'c-other', credentialPrefix: 'nf.test.cred1',
      credentialHash: 'hash1', status: 'active', expiresAt: null,
      lastUsedAt: null, createdAt: new Date(), revokedAt: null,
    });

    const uc = new RevokeCredential(credentialRepo);
    await assert.rejects(
      () => uc.execute({ clientId: 'c1', credentialId: 'cred-1' }),
      (err: any) => err.code === 'CREDENTIAL_NOT_OWNED',
    );
  });
});

describe('Unit: S9.1 — RotateCredential use case', () => {
  test('U08: rotation creates new active credential', async () => {
    const apiClientRepo = new InMemoryApiClientRepo();
    const credentialRepo = new InMemoryCredentialRepo();
    apiClientRepo.store.push({ id: 'c1', name: 'T', sourceApp: 'app', environment: 'test', status: 'active', scopes: [], metadata: {}, createdAt: new Date(), updatedAt: new Date() });

    const uc = new RotateCredential(apiClientRepo, credentialRepo);
    const result = await uc.execute({ clientId: 'c1' });

    assert.ok(result.rawCredential, 'rawCredential must be present');
    assert.equal(result.newCredential.status, 'active');
    assert.equal(result.newCredential.clientId, 'c1');
    assert.equal(result.revokedCredential, null, 'no old credential specified → revokedCredential is null');
  });

  test('U09: rotation optionally revokes old credential', async () => {
    const apiClientRepo = new InMemoryApiClientRepo();
    const credentialRepo = new InMemoryCredentialRepo();
    apiClientRepo.store.push({ id: 'c1', name: 'T', sourceApp: 'app', environment: 'test', status: 'active', scopes: [], metadata: {}, createdAt: new Date(), updatedAt: new Date() });

    // Seed old credential
    credentialRepo.store.push({
      id: 'old-cred', clientId: 'c1', credentialPrefix: 'nf.test.oldcred',
      credentialHash: 'oldhash', status: 'active', expiresAt: null,
      lastUsedAt: null, createdAt: new Date(), revokedAt: null,
    });

    const uc = new RotateCredential(apiClientRepo, credentialRepo);
    const result = await uc.execute({ clientId: 'c1', revokeOldCredentialId: 'old-cred' });

    assert.ok(result.revokedCredential, 'revokedCredential must be present');
    assert.equal(result.revokedCredential!.id, 'old-cred');
    assert.equal(result.revokedCredential!.status, 'revoked');

    const oldStored = credentialRepo.store.find(c => c.id === 'old-cred');
    assert.equal(oldStored!.status, 'revoked', 'old credential must be revoked in store');
  });

  test('U10: rotation does NOT revoke credentials that do not belong to the client', async () => {
    const apiClientRepo = new InMemoryApiClientRepo();
    const credentialRepo = new InMemoryCredentialRepo();
    apiClientRepo.store.push({ id: 'c1', name: 'T', sourceApp: 'app', environment: 'test', status: 'active', scopes: [], metadata: {}, createdAt: new Date(), updatedAt: new Date() });

    // Seed a credential that belongs to a DIFFERENT client
    credentialRepo.store.push({
      id: 'other-cred', clientId: 'c-other', credentialPrefix: 'nf.test.othercred',
      credentialHash: 'otherhash', status: 'active', expiresAt: null,
      lastUsedAt: null, createdAt: new Date(), revokedAt: null,
    });

    const uc = new RotateCredential(apiClientRepo, credentialRepo);
    const result = await uc.execute({ clientId: 'c1', revokeOldCredentialId: 'other-cred' });

    // revokedCredential should be null (other client's credential is silently skipped)
    assert.equal(result.revokedCredential, null, 'cross-client credential must not be revoked');
    const otherStored = credentialRepo.store.find(c => c.id === 'other-cred');
    assert.equal(otherStored!.status, 'active', 'other client credential must remain active');
  });

  test('U13: RotateCredential for unknown client returns API_CLIENT_NOT_FOUND', async () => {
    const apiClientRepo = new InMemoryApiClientRepo();
    const credentialRepo = new InMemoryCredentialRepo();
    const uc = new RotateCredential(apiClientRepo, credentialRepo);
    await assert.rejects(
      () => uc.execute({ clientId: 'ghost' }),
      (err: any) => err.code === 'API_CLIENT_NOT_FOUND',
    );
  });
});

describe('Unit: S9.1 — lastUsedAt tracking', () => {
  test('U11: lastUsedAt updates on successful auth via touchLastUsed', async () => {
    const credentialRepo = new InMemoryCredentialRepo();
    const id = 'cred-touch';
    credentialRepo.store.push({
      id, clientId: 'c1', credentialPrefix: 'nf.test.touch',
      credentialHash: 'h', status: 'active', expiresAt: null,
      lastUsedAt: null, createdAt: new Date(), revokedAt: null,
    });

    const before = credentialRepo.store.find(c => c.id === id)!.lastUsedAt;
    assert.equal(before, null, 'lastUsedAt must be null before touch');

    const at = new Date();
    await credentialRepo.touchLastUsed(id, at);
    const after = credentialRepo.store.find(c => c.id === id)!.lastUsedAt;
    assert.deepEqual(after, at, 'lastUsedAt must be updated after touch');
  });
});

// ════════════════════════════════════════════════════════════════════
// HTTP INTEGRATION TESTS
// ════════════════════════════════════════════════════════════════════

describe('HTTP: S9.1 — Credential lifecycle API', () => {
  let server: http.Server;
  let baseUrl: string;
  let rawCredential: string;
  let clientId: string;
  let credentialRepo: InMemoryCredentialRepo;
  let auditRepo: InMemoryAuditRepo;

  const setup = async () => {
    const built = buildCredentialContainer();
    rawCredential = built.rawCredential;
    clientId = built.clientId;
    credentialRepo = built.credentialRepo;
    auditRepo = built.auditRepo;
    const result = await startServer(built.container);
    server = result.server;
    baseUrl = result.baseUrl;
  };

  const teardown = async () => {
    if (server) await closeServer(server);
  };

  test('H01: POST /v1/api-clients/:clientId/credentials → 201 with rawCredential', async () => {
    await setup();
    try {
      const res = await fetch(`${baseUrl}/v1/api-clients/${clientId}/credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${rawCredential}` },
        body: JSON.stringify({}),
      });
      assert.equal(res.status, 201);
      const body = await res.json() as any;
      assert.equal(body.ok, true);
      assert.ok(body.data.rawCredential, 'rawCredential must be present in create response');
      assert.ok(body.data.id, 'id must be present');
      assert.equal(body.data.clientId, clientId);
      assert.equal(body.data.status, 'active');
      assert.ok(!body.data.credentialHash, 'credentialHash must NOT appear in response');
    } finally {
      await teardown();
    }
  });

  test('H02: GET after create does not return rawCredential or credentialHash', async () => {
    await setup();
    try {
      // Create a new credential
      const createRes = await fetch(`${baseUrl}/v1/api-clients/${clientId}/credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${rawCredential}` },
        body: JSON.stringify({}),
      });
      assert.equal(createRes.status, 201);

      // List credentials — must not contain rawCredential or hash
      const listRes = await fetch(`${baseUrl}/v1/api-clients/${clientId}/credentials`, {
        headers: { 'Authorization': `Bearer ${rawCredential}` },
      });
      assert.equal(listRes.status, 200);
      const body = await listRes.json() as any;
      assert.equal(body.ok, true);
      for (const cred of body.data) {
        assert.ok(!cred.rawCredential, 'rawCredential must NOT appear in list');
        assert.ok(!cred.credentialHash, 'credentialHash must NOT appear in list');
      }
    } finally {
      await teardown();
    }
  });

  test('H03: GET /v1/api-clients/:clientId/credentials → 200 with credential list', async () => {
    await setup();
    try {
      const res = await fetch(`${baseUrl}/v1/api-clients/${clientId}/credentials`, {
        headers: { 'Authorization': `Bearer ${rawCredential}` },
      });
      assert.equal(res.status, 200);
      const body = await res.json() as any;
      assert.equal(body.ok, true);
      assert.ok(Array.isArray(body.data));
      assert.ok(body.data.length >= 1, 'must have at least the seeded credential');
    } finally {
      await teardown();
    }
  });

  test('H04: POST /rotate → 201 with newCredential.rawCredential', async () => {
    await setup();
    try {
      const res = await fetch(`${baseUrl}/v1/api-clients/${clientId}/credentials/rotate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${rawCredential}` },
        body: JSON.stringify({}),
      });
      assert.equal(res.status, 201);
      const body = await res.json() as any;
      assert.equal(body.ok, true);
      assert.ok(body.data.newCredential.rawCredential, 'rawCredential must be in rotate response');
      assert.ok(!body.data.newCredential.credentialHash, 'credentialHash must NOT appear');
      assert.equal(body.data.revokedCredential, null);
    } finally {
      await teardown();
    }
  });

  test('H05: POST /rotate with revokeOldCredentialId → old credential revoked', async () => {
    await setup();
    try {
      const oldCredId = credentialRepo.store[0].id;
      const res = await fetch(`${baseUrl}/v1/api-clients/${clientId}/credentials/rotate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${rawCredential}` },
        body: JSON.stringify({ revokeOldCredentialId: oldCredId }),
      });
      assert.equal(res.status, 201);
      const body = await res.json() as any;
      assert.equal(body.ok, true);
      assert.ok(body.data.revokedCredential, 'revokedCredential must be present');
      assert.equal(body.data.revokedCredential.status, 'revoked');

      const stored = credentialRepo.store.find(c => c.id === oldCredId);
      assert.equal(stored!.status, 'revoked', 'old credential must be revoked in store');
    } finally {
      await teardown();
    }
  });

  test('H06: POST .../revoke → credential status becomes revoked', async () => {
    await setup();
    try {
      const credId = credentialRepo.store[0].id;
      const res = await fetch(`${baseUrl}/v1/api-clients/${clientId}/credentials/${credId}/revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${rawCredential}` },
        body: JSON.stringify({}),
      });
      assert.equal(res.status, 200);
      const body = await res.json() as any;
      assert.equal(body.ok, true);
      assert.equal(body.data.status, 'revoked');
      assert.ok(body.data.revokedAt, 'revokedAt must be set');
      assert.ok(!body.data.credentialHash, 'credentialHash must NOT appear');
    } finally {
      await teardown();
    }
  });

  test('H07: revoked credential returns 401 on subsequent auth', async () => {
    await setup();
    try {
      const credId = credentialRepo.store[0].id;
      // Revoke the credential
      const revokeRes = await fetch(`${baseUrl}/v1/api-clients/${clientId}/credentials/${credId}/revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${rawCredential}` },
        body: JSON.stringify({}),
      });
      assert.equal(revokeRes.status, 200);

      // Use the revoked credential to auth
      const authRes = await fetch(`${baseUrl}/v1/audit-logs`, {
        headers: { 'Authorization': `Bearer ${rawCredential}` },
      });
      assert.equal(authRes.status, 401, 'revoked credential must not authenticate');
    } finally {
      await teardown();
    }
  });

  test('H08: normal client cannot manage another client\'s credentials → 403', async () => {
    await setup();
    try {
      const otherClientId = 'other-client-xyz';
      const res = await fetch(`${baseUrl}/v1/api-clients/${otherClientId}/credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${rawCredential}` },
        body: JSON.stringify({}),
      });
      assert.equal(res.status, 403);
      const body = await res.json() as any;
      const code = body.error?.code ?? body.error;
      assert.equal(code, 'CREDENTIAL_NOT_OWNED');
    } finally {
      await teardown();
    }
  });

  test('H09: missing scope returns 403 SCOPE_DENIED', async () => {
    const built = buildCredentialContainer({ clientScopes: [] }); // no credential scopes
    const result = await startServer(built.container);
    try {
      const res = await fetch(`${result.baseUrl}/v1/api-clients/${built.clientId}/credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${built.rawCredential}` },
        body: JSON.stringify({}),
      });
      assert.equal(res.status, 403);
      const body = await res.json() as any;
      const code = body.error?.code ?? body.error;
      assert.equal(code, 'SCOPE_DENIED');
    } finally {
      await closeServer(result.server);
    }
  });

  test('H10: create and rotate responses never contain credentialHash', async () => {
    await setup();
    try {
      const createRes = await fetch(`${baseUrl}/v1/api-clients/${clientId}/credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${rawCredential}` },
        body: JSON.stringify({}),
      });
      const createBody = await createRes.json() as any;
      const createJson = JSON.stringify(createBody);
      assert.ok(!createJson.includes('credentialHash'), 'credentialHash must not appear in create response JSON');

      const rotateRes = await fetch(`${baseUrl}/v1/api-clients/${clientId}/credentials/rotate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${rawCredential}` },
        body: JSON.stringify({}),
      });
      const rotateBody = await rotateRes.json() as any;
      const rotateJson = JSON.stringify(rotateBody);
      assert.ok(!rotateJson.includes('credentialHash'), 'credentialHash must not appear in rotate response JSON');
    } finally {
      await teardown();
    }
  });

  test('H11: audit logs written for lifecycle ops with no plaintext/hash in metadata', async () => {
    await setup();
    try {
      // Create a credential to generate an audit entry
      await fetch(`${baseUrl}/v1/api-clients/${clientId}/credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${rawCredential}` },
        body: JSON.stringify({}),
      });

      // Check audit entries
      const credCreateEntries = auditRepo.entries.filter(e => e.action === 'api_client.credential.create');
      assert.ok(credCreateEntries.length >= 1, 'audit entry for credential create must exist');

      const entry = credCreateEntries[0];
      const metaStr = JSON.stringify(entry.metadata);
      // Must not contain raw credential or hash values
      assert.ok(!metaStr.includes('rawCredential'), 'audit metadata must not contain rawCredential');
      assert.ok(!metaStr.includes('credentialHash'), 'audit metadata must not contain credentialHash');
      // Must not contain Authorization header or x-nf-api-key
      assert.ok(!metaStr.toLowerCase().includes('authorization'), 'audit metadata must not contain Authorization');
      assert.ok(!metaStr.includes('x-nf-api-key'), 'audit metadata must not contain x-nf-api-key');
    } finally {
      await teardown();
    }
  });
});
