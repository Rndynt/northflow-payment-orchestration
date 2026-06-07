/**
 * s9-4-signed-requests-hmac — S9.4 HMAC signed request auth tests.
 *
 * All tests are self-contained (in-process server + InMemory repos).
 * No live service dependency.
 *
 * Covers:
 *   Signing key lifecycle (L01-L06):
 *     L01: POST /signing-keys → 201 with rawSigningSecret
 *     L02: GET  /signing-keys → 200, secretCiphertext never in response
 *     L03: POST /signing-keys/rotate → 201 new key + rawSigningSecret
 *     L04: POST /signing-keys/rotate with revokeOldKeyId → old key revoked
 *     L05: POST /signing-keys/:id/revoke → 200, key becomes revoked
 *     L06: another client cannot list/manage signing keys
 *
 *   Signed request auth flow (A01-A09):
 *     A01: valid signed request is accepted
 *     A02: expired timestamp → 401 SIGNED_REQUEST_TIMESTAMP_EXPIRED
 *     A03: future timestamp beyond skew → 401 SIGNED_REQUEST_TIMESTAMP_EXPIRED
 *     A04: invalid timestamp (non-numeric) → 401 SIGNED_REQUEST_TIMESTAMP_INVALID
 *     A05: invalid signature → 401 SIGNED_REQUEST_SIGNATURE_INVALID
 *     A06: unknown key → 401 SIGNED_REQUEST_KEY_NOT_FOUND
 *     A07: nonce replay → 401 SIGNED_REQUEST_NONCE_REPLAYED
 *     A08: bearer auth works in optional mode (no signed headers)
 *     A09: required mode rejects bearer-only
 *
 *   signingSecretProtector unit tests (E01-E04):
 *     E01: encrypt + decrypt round-trip
 *     E02: random IV produces different ciphertexts each time
 *     E03: encrypt throws when encryption secret not configured
 *     E04: decrypt throws on tampered ciphertext
 *
 *   Config env tests (C01-C02):
 *     C01: loadEnv returns signedRequestsMode, maxSkew, nonceTtl
 *     C02: defaults signedRequestsMode to optional
 *
 * Run: pnpm test
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { createHmac, createHash, randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';

import { createApp } from '../apps/service/src/app.ts';
import type { ServiceContainer } from '../apps/service/src/container.ts';
import type { PaymentOrchestrationServiceConfig } from '../apps/service/src/config/env.ts';
import { loadEnv } from '../apps/service/src/config/env.ts';
import { generateCredential } from '../apps/service/src/middleware/auth.ts';
import { encrypt, decrypt } from '../apps/service/src/security/signingSecretProtector.ts';
import { StandaloneFakeGatewayProvider } from '../apps/service/src/infrastructure/providers/StandaloneFakeGatewayProvider.ts';
import { FakeGatewayWebhookHandler } from '../apps/service/src/infrastructure/providers/FakeGatewayWebhookHandler.ts';

import { CreateMerchant } from '../apps/service/src/application/use-cases/CreateMerchant.ts';
import { CreateProviderAccount } from '../apps/service/src/application/use-cases/CreateProviderAccount.ts';
import { CreatePaymentIntent } from '../apps/service/src/application/use-cases/CreatePaymentIntent.ts';
import { CreateGatewayPayment } from '../apps/service/src/application/use-cases/CreateGatewayPayment.ts';
import { ConfirmFakeGatewayPayment } from '../apps/service/src/application/use-cases/ConfirmFakeGatewayPayment.ts';
import { GetPaymentIntentStatus } from '../apps/service/src/application/use-cases/GetPaymentIntentStatus.ts';
import { GetRefundability } from '../apps/service/src/application/use-cases/GetRefundability.ts';
import { HandleProviderWebhook } from '../apps/service/src/application/use-cases/HandleProviderWebhook.ts';
import { ReconcilePaymentIntentTotals } from '../apps/service/src/application/use-cases/ReconcilePaymentIntentTotals.ts';
import { RefreshProviderStatus } from '../apps/service/src/application/use-cases/RefreshProviderStatus.ts';
import { RefundPaymentTransaction } from '../apps/service/src/application/use-cases/RefundPaymentTransaction.ts';
import { VoidPaymentTransaction } from '../apps/service/src/application/use-cases/VoidPaymentTransaction.ts';
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
  ClientSigningKeyRepository,
  CreateClientSigningKeyInput,
  ConsumeNonceInput,
  RequestNonceRepository,
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

import type { ClientSigningKeyDTO, ClientSigningKeyStatus } from '@northflow/payment-orchestration-core';

// ════════════════════════════════════════════════════════════════════
// SIGNING HELPER (mirrors SDK logic)
// ════════════════════════════════════════════════════════════════════

const CANONICAL_ALGORITHM = 'NF-HMAC-SHA256-V1';
const SIGNATURE_VERSION = 'v1';

function hashBodyStr(body: string | null): string {
  const h = createHash('sha256');
  if (body) h.update(body, 'utf8');
  return h.digest('hex');
}

function buildCanonicalQuery(queryStr: string): string {
  const raw = queryStr.startsWith('?') ? queryStr.slice(1) : queryStr;
  if (!raw) return '';
  const pairs = raw.split('&').map((part): [string, string] => {
    const eq = part.indexOf('=');
    if (eq === -1) return [decodeURIComponent(part), ''];
    return [decodeURIComponent(part.slice(0, eq)), decodeURIComponent(part.slice(eq + 1))];
  });
  pairs.sort((a, b) => {
    const k = a[0].localeCompare(b[0]);
    return k !== 0 ? k : a[1].localeCompare(b[1]);
  });
  return pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
}

function signRequest(opts: {
  clientId: string;
  keyId: string;
  secret: string;
  method: string;
  path: string;
  query?: string;
  body?: string | null;
  timestampMs?: number;
  nonce?: string;
}): Record<string, string> {
  const ts = opts.timestampMs ?? Date.now();
  const n = opts.nonce ?? randomBytes(16).toString('base64url');
  const bodyHash = hashBodyStr(opts.body ?? null);
  const cq = buildCanonicalQuery(opts.query ?? '');
  const canonicalStr = [CANONICAL_ALGORITHM, String(ts), n, opts.method.toUpperCase(), opts.path, cq, bodyHash].join('\n');
  const signature = createHmac('sha256', opts.secret).update(canonicalStr).digest('hex');
  return {
    'x-nf-client-id': opts.clientId,
    'x-nf-key-id': opts.keyId,
    'x-nf-timestamp': String(ts),
    'x-nf-nonce': n,
    'x-nf-signature': signature,
    'x-nf-signature-version': SIGNATURE_VERSION,
  };
}

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
    const m: PaymentMerchant = { id: input.id ?? randomUUID(), displayName: input.name, legalName: input.legalName ?? null, externalRef: input.externalRef ?? null, sourceApp: input.sourceApp ?? null, status: input.status ?? 'active', metadata: input.metadata ?? {}, createdAt: new Date(), updatedAt: new Date() };
    this.store.push(m);
    return m;
  }
  async updateStatus(id: string, status: any) { const m = this.store.find(m => m.id === id); if (m) m.status = status; return m!; }
}

class InMemoryIntentRepo implements PaymentIntentRepository {
  private store: StandalonePaymentIntentDTO[] = [];
  async findById(id: string) { return this.store.find(i => i.id === id) ?? null; }
  async findByExternalPayable(input: any) { return this.store.find(i => i.externalPayableType === input.externalPayableType && i.externalPayableId === input.externalPayableId) ?? null; }
  async create(input: any): Promise<StandalonePaymentIntentDTO> { const i: any = { ...input, id: input.id ?? randomUUID(), amountPaid: 0, amountRefunded: 0, amountRemaining: input.amountDue, status: 'pending', createdAt: new Date(), updatedAt: new Date() }; this.store.push(i); return i; }
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
  async list(_input: ListAuditLogsInput): Promise<AuditLog[]> { return [...this.entries]; }
}

// ── Signing key repo: stores secretCiphertext internally, exposes safe DTO ───

type SigningKeyRow = ClientSigningKeyDTO & { secretCiphertext: string; secretKeyVersion: string | null };

class InMemorySigningKeyRepo implements ClientSigningKeyRepository {
  readonly store: SigningKeyRow[] = [];

  async create(input: CreateClientSigningKeyInput): Promise<ClientSigningKeyDTO> {
    const now = new Date();
    const row: SigningKeyRow = {
      id: input.id,
      clientId: input.clientId,
      keyPrefix: input.keyPrefix,
      status: 'active' as ClientSigningKeyStatus,
      expiresAt: input.expiresAt ?? null,
      lastUsedAt: null,
      createdAt: now,
      revokedAt: null,
      metadata: input.metadata ?? {},
      secretCiphertext: input.secretCiphertext,
      secretKeyVersion: input.secretKeyVersion ?? null,
    };
    this.store.push(row);
    return this.#safe(row);
  }

  async findById(id: string): Promise<ClientSigningKeyDTO | null> {
    const row = this.store.find(r => r.id === id);
    return row ? this.#safe(row) : null;
  }

  async findByPrefix(prefix: string): Promise<ClientSigningKeyDTO[]> {
    return this.store.filter(r => r.keyPrefix === prefix).map(r => this.#safe(r));
  }

  async findByPrefixWithCiphertext(prefix: string): Promise<Array<ClientSigningKeyDTO & { secretCiphertext: string; secretKeyVersion: string | null }>> {
    return this.store
      .filter(r => r.keyPrefix === prefix)
      .map(r => ({ ...this.#safe(r), secretCiphertext: r.secretCiphertext, secretKeyVersion: r.secretKeyVersion }));
  }

  async listByClientId(clientId: string): Promise<ClientSigningKeyDTO[]> {
    return this.store.filter(r => r.clientId === clientId).map(r => this.#safe(r));
  }

  async revoke(id: string, at: Date): Promise<void> {
    const row = this.store.find(r => r.id === id);
    if (row) { row.status = 'revoked'; row.revokedAt = at; }
  }

  async touchLastUsed(id: string, at: Date): Promise<void> {
    const row = this.store.find(r => r.id === id);
    if (row) row.lastUsedAt = at;
  }

  #safe(row: SigningKeyRow): ClientSigningKeyDTO {
    const { secretCiphertext: _c, secretKeyVersion: _v, ...safe } = row;
    return safe;
  }
}

// ── Nonce repo: track consumed nonces in-memory ──────────────────────────────

class InMemoryNonceRepo implements RequestNonceRepository {
  private consumed = new Set<string>();

  async consume(input: ConsumeNonceInput): Promise<{ consumed: boolean }> {
    const key = `${input.signingKeyId}:${input.nonce}`;
    if (this.consumed.has(key)) return { consumed: false };
    this.consumed.add(key);
    return { consumed: true };
  }

  async cleanupExpired(_now: Date): Promise<number> { return 0; }
}

// ════════════════════════════════════════════════════════════════════
// CONTAINER BUILDER & SERVER HELPERS
// ════════════════════════════════════════════════════════════════════

const SIGNING_SCOPES = [
  'api_client:signing_key:create',
  'api_client:signing_key:read',
  'api_client:signing_key:rotate',
  'api_client:signing_key:revoke',
];

function buildSigningKeyContainer(opts: {
  signedRequestsMode?: 'disabled' | 'optional' | 'required';
  clientId?: string;
  extraScopes?: string[];
} = {}) {
  const clientId = opts.clientId ?? 'client-s9-4-test';
  const environment = 'test';

  const apiClientRepo = new InMemoryApiClientRepo();
  const credentialRepo = new InMemoryCredentialRepo();
  const accessRepo = new InMemoryAccessRepo();
  const auditRepo = new InMemoryAuditRepo();
  const signingKeyRepo = new InMemorySigningKeyRepo();
  const nonceRepo = new InMemoryNonceRepo();

  apiClientRepo.store.push({
    id: clientId,
    name: 'S9.4 Test Client',
    sourceApp: 'test-app',
    environment,
    status: 'active',
    scopes: [...SIGNING_SCOPES, ...(opts.extraScopes ?? [])],
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
    rateLimitEnabled: false,
    rateLimitClientGlobalPerMinute: 600,
    rateLimitClientRoutePerMinute: 120,
    rateLimitAuthFailurePerMinute: 30,
    signedRequestsMode: opts.signedRequestsMode ?? 'optional',
    signedRequestMaxSkewSeconds: 300,
    signedRequestNonceTtlSeconds: 600,
  } as any;

  const merchantRepo = new InMemoryMerchantRepo();
  const providerAccountRepo = new InMemoryProviderAccountRepo();
  const intentRepo = new InMemoryIntentRepo();
  const transactionRepo = new InMemoryTransactionRepo();
  const idempotencyRepo = new InMemoryIdempotencyRepo();
  const providerEventRepo = new InMemoryProviderEventRepo();

  const fakeGatewayProvider = new StandaloneFakeGatewayProvider({ webhookSecret: null, nodeEnv: 'test' });
  const providerRegistry = {
    getProvider: () => fakeGatewayProvider,
    listProviders: () => [{ name: 'fake_gateway', displayName: 'Fake Gateway', environments: ['test'] }],
    has: () => false,
  } as any;
  const fakeGatewayWebhookHandler = new FakeGatewayWebhookHandler({ webhookSecret: null, nodeEnv: 'test' });

  const container: ServiceContainer = {
    config,
    db: null as any,
    repos: { merchantRepo, providerAccountRepo, intentRepo, transactionRepo, providerEventRepo, idempotencyRepo },
    authRepos: { apiClientRepo, clientCredentialRepo: credentialRepo, clientMerchantAccessRepo: accessRepo },
    providerRegistry,
    signingKeyRepo: signingKeyRepo as any,
    nonceRepo: nonceRepo as any,
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
  };

  return { container, clientId, rawCredential: raw, signingKeyRepo, nonceRepo, credentialRepo, auditRepo };
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

async function req(
  baseUrl: string,
  method: string,
  path: string,
  opts: { body?: unknown; headers?: Record<string, string>; bearer?: string } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...opts.headers };
  if (opts.bearer) headers['authorization'] = `Bearer ${opts.bearer}`;
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  return { status: response.status, body };
}

function errorCode(body: Record<string, unknown>): string {
  const err = body['error'];
  if (typeof err === 'object' && err !== null) return (err as any)['code'] ?? '';
  return String(err ?? '');
}

// ════════════════════════════════════════════════════════════════════
// TESTS: Signing Key Lifecycle
// ════════════════════════════════════════════════════════════════════

describe('S9.4 — Signing Key Lifecycle', () => {
  const ENC_SECRET = 'test-encryption-secret-32-bytes!!';

  test('L01: POST /signing-keys → 201 with rawSigningSecret (encryption configured)', async () => {
    const built = buildSigningKeyContainer();
    const { server, baseUrl } = await startServer(built.container);
    const originalSecret = process.env['PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_SECRET'];
    process.env['PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_SECRET'] = ENC_SECRET;
    try {
      const r = await req(baseUrl, 'POST', `/v1/api-clients/${built.clientId}/signing-keys`, {
        bearer: built.rawCredential,
        body: {},
      });
      assert.equal(r.status, 201, `Expected 201, got ${r.status}: ${JSON.stringify(r.body)}`);
      const data = r.body['data'] as Record<string, unknown>;
      assert.ok(data['id'], 'Expected id');
      assert.ok(data['keyPrefix'], 'Expected keyPrefix');
      assert.ok(data['rawSigningSecret'], 'Expected rawSigningSecret');
      assert.equal(data['status'], 'active');
      assert.ok(!(data as any)['secretCiphertext'], 'secretCiphertext must never be in response');
    } finally {
      if (originalSecret === undefined) delete process.env['PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_SECRET'];
      else process.env['PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_SECRET'] = originalSecret;
      await closeServer(server);
    }
  });

  test('L01b: POST /signing-keys → 503 when encryption secret not configured', async () => {
    const built = buildSigningKeyContainer();
    const { server, baseUrl } = await startServer(built.container);
    const originalSecret = process.env['PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_SECRET'];
    delete process.env['PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_SECRET'];
    try {
      const r = await req(baseUrl, 'POST', `/v1/api-clients/${built.clientId}/signing-keys`, {
        bearer: built.rawCredential,
        body: {},
      });
      assert.equal(r.status, 503, `Expected 503, got ${r.status}: ${JSON.stringify(r.body)}`);
      assert.equal(errorCode(r.body), 'SERVICE_MISCONFIGURED');
    } finally {
      if (originalSecret !== undefined) process.env['PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_SECRET'] = originalSecret;
      await closeServer(server);
    }
  });

  test('L02: GET /signing-keys → 200, secretCiphertext never in response', async () => {
    const built = buildSigningKeyContainer();
    const { server, baseUrl } = await startServer(built.container);
    const originalSecret = process.env['PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_SECRET'];
    process.env['PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_SECRET'] = ENC_SECRET;
    try {
      await req(baseUrl, 'POST', `/v1/api-clients/${built.clientId}/signing-keys`, {
        bearer: built.rawCredential,
        body: {},
      });

      const r = await req(baseUrl, 'GET', `/v1/api-clients/${built.clientId}/signing-keys`, {
        bearer: built.rawCredential,
      });
      assert.equal(r.status, 200, `Expected 200, got ${r.status}: ${JSON.stringify(r.body)}`);
      const keys = r.body['data'] as Array<Record<string, unknown>>;
      assert.ok(Array.isArray(keys), 'Expected array');
      assert.ok(keys.length >= 1, 'Expected at least one key');
      for (const k of keys) {
        assert.ok(!k['secretCiphertext'], 'secretCiphertext must not appear in list response');
        assert.ok(!k['rawSigningSecret'], 'rawSigningSecret must not appear in list response');
      }
    } finally {
      if (originalSecret === undefined) delete process.env['PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_SECRET'];
      else process.env['PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_SECRET'] = originalSecret;
      await closeServer(server);
    }
  });

  test('L03: POST /signing-keys/rotate → 201 with newSigningKey.rawSigningSecret', async () => {
    const built = buildSigningKeyContainer();
    const { server, baseUrl } = await startServer(built.container);
    const originalSecret = process.env['PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_SECRET'];
    process.env['PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_SECRET'] = ENC_SECRET;
    try {
      const r = await req(baseUrl, 'POST', `/v1/api-clients/${built.clientId}/signing-keys/rotate`, {
        bearer: built.rawCredential,
        body: {},
      });
      assert.equal(r.status, 201, `Expected 201, got ${r.status}: ${JSON.stringify(r.body)}`);
      const data = r.body['data'] as Record<string, unknown>;
      const newKey = data['newSigningKey'] as Record<string, unknown>;
      assert.ok(newKey['rawSigningSecret'], 'Expected rawSigningSecret in rotate response');
      assert.ok(!(newKey as any)['secretCiphertext'], 'secretCiphertext must never be in response');
      assert.equal(data['revokedSigningKey'], null, 'No revokeOldKeyId provided → revokedSigningKey is null');
    } finally {
      if (originalSecret === undefined) delete process.env['PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_SECRET'];
      else process.env['PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_SECRET'] = originalSecret;
      await closeServer(server);
    }
  });

  test('L04: POST /signing-keys/rotate with revokeOldKeyId → old key revoked', async () => {
    const built = buildSigningKeyContainer();
    const { server, baseUrl } = await startServer(built.container);
    const originalSecret = process.env['PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_SECRET'];
    process.env['PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_SECRET'] = ENC_SECRET;
    try {
      const createR = await req(baseUrl, 'POST', `/v1/api-clients/${built.clientId}/signing-keys`, {
        bearer: built.rawCredential,
        body: {},
      });
      assert.equal(createR.status, 201);
      const oldKeyId = (createR.body['data'] as any)['id'];

      const rotateR = await req(baseUrl, 'POST', `/v1/api-clients/${built.clientId}/signing-keys/rotate`, {
        bearer: built.rawCredential,
        body: { revokeOldKeyId: oldKeyId },
      });
      assert.equal(rotateR.status, 201, `Expected 201, got ${rotateR.status}: ${JSON.stringify(rotateR.body)}`);
      const data = rotateR.body['data'] as Record<string, unknown>;
      const revokedKey = data['revokedSigningKey'] as Record<string, unknown>;
      assert.ok(revokedKey, 'Expected revokedSigningKey to be present');
      assert.equal(revokedKey['id'], oldKeyId);
      assert.equal(revokedKey['status'], 'revoked');
    } finally {
      if (originalSecret === undefined) delete process.env['PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_SECRET'];
      else process.env['PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_SECRET'] = originalSecret;
      await closeServer(server);
    }
  });

  test('L05: POST /signing-keys/:id/revoke → 200, key status becomes revoked', async () => {
    const built = buildSigningKeyContainer();
    const { server, baseUrl } = await startServer(built.container);
    const originalSecret = process.env['PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_SECRET'];
    process.env['PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_SECRET'] = ENC_SECRET;
    try {
      const createR = await req(baseUrl, 'POST', `/v1/api-clients/${built.clientId}/signing-keys`, {
        bearer: built.rawCredential,
        body: {},
      });
      assert.equal(createR.status, 201);
      const keyId = (createR.body['data'] as any)['id'];

      const revokeR = await req(baseUrl, 'POST', `/v1/api-clients/${built.clientId}/signing-keys/${keyId}/revoke`, {
        bearer: built.rawCredential,
      });
      assert.equal(revokeR.status, 200, `Expected 200, got ${revokeR.status}: ${JSON.stringify(revokeR.body)}`);
      const data = revokeR.body['data'] as Record<string, unknown>;
      assert.equal(data['status'], 'revoked');
      assert.ok(data['revokedAt'], 'Expected revokedAt to be set');
    } finally {
      if (originalSecret === undefined) delete process.env['PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_SECRET'];
      else process.env['PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_SECRET'] = originalSecret;
      await closeServer(server);
    }
  });

  test('L06: another client cannot list signing keys of first client', async () => {
    const built = buildSigningKeyContainer({ clientId: 'client-owner' });
    const { server, baseUrl } = await startServer(built.container);

    // Seed a second client
    built.container.authRepos!.apiClientRepo.store.push({
      id: 'client-other',
      name: 'Other Client',
      sourceApp: 'test-app',
      environment: 'test',
      status: 'active',
      scopes: SIGNING_SCOPES,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const othCredId = randomUUID().replace(/-/g, '');
    const othCred = generateCredential('test', othCredId);
    built.container.authRepos!.clientCredentialRepo.store.push({
      id: othCredId,
      clientId: 'client-other',
      credentialPrefix: othCred.prefix,
      credentialHash: othCred.hash,
      status: 'active',
      expiresAt: null,
      lastUsedAt: null,
      createdAt: new Date(),
      revokedAt: null,
    });

    try {
      const r = await req(baseUrl, 'GET', `/v1/api-clients/client-owner/signing-keys`, {
        bearer: othCred.raw,
      });
      assert.equal(r.status, 403, `Expected 403, got ${r.status}: ${JSON.stringify(r.body)}`);
    } finally {
      await closeServer(server);
    }
  });
});

// ════════════════════════════════════════════════════════════════════
// TESTS: Signed Request Auth Flow
// ════════════════════════════════════════════════════════════════════

describe('S9.4 — Signed Request Auth Flow', () => {
  const ENC_SECRET = 'test-encryption-secret-32-bytes!!';

  async function buildSignedAuthSetup() {
    const originalSecret = process.env['PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_SECRET'];
    process.env['PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_SECRET'] = ENC_SECRET;
    const built = buildSigningKeyContainer({ signedRequestsMode: 'optional' });

    const rawSigningSecret = randomBytes(32).toString('base64url');
    const ciphertext = encrypt(rawSigningSecret);
    const keyPrefix = `nfsk.${randomBytes(8).toString('base64url').replace(/[^a-zA-Z0-9]/g, '').slice(0, 12)}`;
    const keyId = randomUUID();

    await built.signingKeyRepo.create({
      id: keyId,
      clientId: built.clientId,
      keyPrefix,
      secretCiphertext: ciphertext,
      secretKeyVersion: 'v1',
    });

    if (originalSecret === undefined) delete process.env['PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_SECRET'];
    else process.env['PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_SECRET'] = originalSecret;

    return { built, rawSigningSecret, keyPrefix, keyId };
  }

  test('A01: valid signed request is accepted', async () => {
    const originalSecret = process.env['PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_SECRET'];
    process.env['PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_SECRET'] = ENC_SECRET;
    const { built, rawSigningSecret, keyPrefix, keyId } = await buildSignedAuthSetup();
    const { server, baseUrl } = await startServer(built.container);
    try {
      const headers = signRequest({
        clientId: built.clientId,
        keyId: keyPrefix,
        secret: rawSigningSecret,
        method: 'GET',
        path: `/v1/api-clients/${built.clientId}/signing-keys`,
      });
      const r = await req(baseUrl, 'GET', `/v1/api-clients/${built.clientId}/signing-keys`, { headers });
      assert.equal(r.status, 200, `Expected 200, got ${r.status}: ${JSON.stringify(r.body)}`);
      assert.ok(Array.isArray(r.body['data']), 'Expected data array');
    } finally {
      if (originalSecret === undefined) delete process.env['PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_SECRET'];
      else process.env['PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_SECRET'] = originalSecret;
      await closeServer(server);
    }
  });

  test('A02: expired timestamp → 401 SIGNED_REQUEST_TIMESTAMP_EXPIRED', async () => {
    const { built } = await buildSignedAuthSetup();
    const { server, baseUrl } = await startServer(built.container);
    try {
      const r = await req(baseUrl, 'GET', `/v1/api-clients/${built.clientId}/signing-keys`, {
        headers: {
          'x-nf-client-id': built.clientId,
          'x-nf-key-id': 'nfsk.somekey',
          'x-nf-timestamp': String(Date.now() - 700_000),
          'x-nf-nonce': randomBytes(8).toString('hex'),
          'x-nf-signature': 'a'.repeat(64),
          'x-nf-signature-version': 'v1',
        },
      });
      assert.equal(r.status, 401);
      assert.equal(errorCode(r.body), 'SIGNED_REQUEST_TIMESTAMP_EXPIRED');
    } finally {
      await closeServer(server);
    }
  });

  test('A03: future timestamp beyond skew → 401 SIGNED_REQUEST_TIMESTAMP_EXPIRED', async () => {
    const { built } = await buildSignedAuthSetup();
    const { server, baseUrl } = await startServer(built.container);
    try {
      const r = await req(baseUrl, 'GET', `/v1/api-clients/${built.clientId}/signing-keys`, {
        headers: {
          'x-nf-client-id': built.clientId,
          'x-nf-key-id': 'nfsk.somekey',
          'x-nf-timestamp': String(Date.now() + 700_000),
          'x-nf-nonce': randomBytes(8).toString('hex'),
          'x-nf-signature': 'a'.repeat(64),
          'x-nf-signature-version': 'v1',
        },
      });
      assert.equal(r.status, 401);
      assert.equal(errorCode(r.body), 'SIGNED_REQUEST_TIMESTAMP_EXPIRED');
    } finally {
      await closeServer(server);
    }
  });

  test('A04: non-numeric timestamp → 401 SIGNED_REQUEST_TIMESTAMP_INVALID', async () => {
    const { built } = await buildSignedAuthSetup();
    const { server, baseUrl } = await startServer(built.container);
    try {
      const r = await req(baseUrl, 'GET', `/v1/api-clients/${built.clientId}/signing-keys`, {
        headers: {
          'x-nf-client-id': built.clientId,
          'x-nf-key-id': 'nfsk.somekey',
          'x-nf-timestamp': 'not-a-number',
          'x-nf-nonce': randomBytes(8).toString('hex'),
          'x-nf-signature': 'a'.repeat(64),
          'x-nf-signature-version': 'v1',
        },
      });
      assert.equal(r.status, 401);
      assert.equal(errorCode(r.body), 'SIGNED_REQUEST_TIMESTAMP_INVALID');
    } finally {
      await closeServer(server);
    }
  });

  test('A05: bad signature for known key → 401 SIGNED_REQUEST_SIGNATURE_INVALID', async () => {
    const originalSecret = process.env['PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_SECRET'];
    process.env['PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_SECRET'] = ENC_SECRET;
    const { built, keyPrefix } = await buildSignedAuthSetup();
    const { server, baseUrl } = await startServer(built.container);
    try {
      const r = await req(baseUrl, 'GET', `/v1/api-clients/${built.clientId}/signing-keys`, {
        headers: {
          'x-nf-client-id': built.clientId,
          'x-nf-key-id': keyPrefix,
          'x-nf-timestamp': String(Date.now()),
          'x-nf-nonce': randomBytes(8).toString('hex'),
          'x-nf-signature': 'b'.repeat(64),
          'x-nf-signature-version': 'v1',
        },
      });
      assert.equal(r.status, 401);
      assert.equal(errorCode(r.body), 'SIGNED_REQUEST_SIGNATURE_INVALID');
    } finally {
      if (originalSecret === undefined) delete process.env['PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_SECRET'];
      else process.env['PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_SECRET'] = originalSecret;
      await closeServer(server);
    }
  });

  test('A06: unknown key prefix → 401 SIGNED_REQUEST_KEY_NOT_FOUND', async () => {
    const { built } = await buildSignedAuthSetup();
    const { server, baseUrl } = await startServer(built.container);
    try {
      const r = await req(baseUrl, 'GET', `/v1/api-clients/${built.clientId}/signing-keys`, {
        headers: {
          'x-nf-client-id': built.clientId,
          'x-nf-key-id': 'nfsk.doesnotexist',
          'x-nf-timestamp': String(Date.now()),
          'x-nf-nonce': randomBytes(8).toString('hex'),
          'x-nf-signature': 'a'.repeat(64),
          'x-nf-signature-version': 'v1',
        },
      });
      assert.equal(r.status, 401);
      assert.equal(errorCode(r.body), 'SIGNED_REQUEST_KEY_NOT_FOUND');
    } finally {
      await closeServer(server);
    }
  });

  test('A07: nonce replay → 401 SIGNED_REQUEST_NONCE_REPLAYED', async () => {
    const originalSecret = process.env['PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_SECRET'];
    process.env['PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_SECRET'] = ENC_SECRET;
    const { built, rawSigningSecret, keyPrefix } = await buildSignedAuthSetup();
    const { server, baseUrl } = await startServer(built.container);
    const fixedNonce = 'fixed-nonce-replay-test';
    try {
      const headers = signRequest({
        clientId: built.clientId,
        keyId: keyPrefix,
        secret: rawSigningSecret,
        method: 'GET',
        path: `/v1/api-clients/${built.clientId}/signing-keys`,
        nonce: fixedNonce,
      });

      const r1 = await req(baseUrl, 'GET', `/v1/api-clients/${built.clientId}/signing-keys`, { headers });
      assert.equal(r1.status, 200, `First request failed: ${JSON.stringify(r1.body)}`);

      const r2 = await req(baseUrl, 'GET', `/v1/api-clients/${built.clientId}/signing-keys`, { headers });
      assert.equal(r2.status, 401, `Second request (replay) should fail: ${JSON.stringify(r2.body)}`);
      assert.equal(errorCode(r2.body), 'SIGNED_REQUEST_NONCE_REPLAYED');
    } finally {
      if (originalSecret === undefined) delete process.env['PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_SECRET'];
      else process.env['PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_SECRET'] = originalSecret;
      await closeServer(server);
    }
  });

  test('A08: bearer auth works in optional mode when no signed headers present', async () => {
    const { built } = await buildSignedAuthSetup();
    const { server, baseUrl } = await startServer(built.container);
    try {
      const r = await req(baseUrl, 'GET', `/v1/api-clients/${built.clientId}/signing-keys`, {
        bearer: built.rawCredential,
      });
      assert.equal(r.status, 200, `Expected 200 with bearer token in optional mode, got ${r.status}: ${JSON.stringify(r.body)}`);
    } finally {
      await closeServer(server);
    }
  });

  test('A09: required mode rejects bearer-only requests with SIGNED_REQUEST_REQUIRED', async () => {
    const built = buildSigningKeyContainer({ signedRequestsMode: 'required' });
    const { server, baseUrl } = await startServer(built.container);
    try {
      const r = await req(baseUrl, 'GET', `/v1/api-clients/${built.clientId}/signing-keys`, {
        bearer: built.rawCredential,
      });
      assert.equal(r.status, 401, `Expected 401 in required mode, got ${r.status}: ${JSON.stringify(r.body)}`);
      assert.equal(errorCode(r.body), 'SIGNED_REQUEST_REQUIRED');
    } finally {
      await closeServer(server);
    }
  });
});

// ════════════════════════════════════════════════════════════════════
// TESTS: signingSecretProtector unit tests
// ════════════════════════════════════════════════════════════════════

describe('S9.4 — signingSecretProtector encrypt/decrypt', () => {
  const ENC_SECRET = 'test-encryption-secret-32-bytes!!';

  test('E01: encrypt + decrypt round-trips correctly', () => {
    const originalSecret = process.env['PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_SECRET'];
    process.env['PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_SECRET'] = ENC_SECRET;
    try {
      const rawSecret = 'my-very-secret-signing-key-abc123';
      const ciphertext = encrypt(rawSecret);
      assert.ok(ciphertext.startsWith('v1:'), `Expected v1: prefix, got: ${ciphertext.slice(0, 10)}`);
      assert.equal(ciphertext.split(':').length, 3, 'Expected <ver>:<iv>:<ct> format');
      const decrypted = decrypt(ciphertext);
      assert.equal(decrypted, rawSecret);
    } finally {
      if (originalSecret === undefined) delete process.env['PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_SECRET'];
      else process.env['PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_SECRET'] = originalSecret;
    }
  });

  test('E02: different encryptions of same secret produce different ciphertexts (random IV)', () => {
    const originalSecret = process.env['PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_SECRET'];
    process.env['PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_SECRET'] = ENC_SECRET;
    try {
      const c1 = encrypt('same-secret');
      const c2 = encrypt('same-secret');
      assert.notEqual(c1, c2, 'Two encryptions of same value must differ (random IV)');
    } finally {
      if (originalSecret === undefined) delete process.env['PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_SECRET'];
      else process.env['PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_SECRET'] = originalSecret;
    }
  });

  test('E03: encrypt throws when encryption secret is not configured', () => {
    const originalSecret = process.env['PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_SECRET'];
    delete process.env['PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_SECRET'];
    try {
      assert.throws(() => encrypt('test'), /PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_SECRET/);
    } finally {
      if (originalSecret !== undefined) process.env['PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_SECRET'] = originalSecret;
    }
  });

  test('E04: decrypt throws on tampered ciphertext', () => {
    const originalSecret = process.env['PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_SECRET'];
    process.env['PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_SECRET'] = ENC_SECRET;
    try {
      const ct = encrypt('real-secret');
      const parts = ct.split(':');
      parts[2] = 'A'.repeat(72);
      assert.throws(() => decrypt(parts.join(':')));
    } finally {
      if (originalSecret === undefined) delete process.env['PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_SECRET'];
      else process.env['PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_SECRET'] = originalSecret;
    }
  });
});

// ════════════════════════════════════════════════════════════════════
// TESTS: Config env fields
// ════════════════════════════════════════════════════════════════════

describe('S9.4 — Config env fields', () => {
  test('C01: loadEnv returns signedRequestsMode, maxSkew, nonceTtl', () => {
    const originalMode = process.env['PAYMENT_ORCHESTRATION_SIGNED_REQUESTS_MODE'];
    process.env['PAYMENT_ORCHESTRATION_SIGNED_REQUESTS_MODE'] = 'disabled';
    try {
      const config = loadEnv();
      assert.equal(config.signedRequestsMode, 'disabled');
      assert.ok(typeof config.signedRequestMaxSkewSeconds === 'number');
      assert.ok(typeof config.signedRequestNonceTtlSeconds === 'number');
      assert.ok(
        config.signedRequestNonceTtlSeconds >= config.signedRequestMaxSkewSeconds,
        'nonceTtl must be >= maxSkew',
      );
    } finally {
      if (originalMode === undefined) delete process.env['PAYMENT_ORCHESTRATION_SIGNED_REQUESTS_MODE'];
      else process.env['PAYMENT_ORCHESTRATION_SIGNED_REQUESTS_MODE'] = originalMode;
    }
  });

  test('C02: defaults signedRequestsMode to optional', () => {
    const original = process.env['PAYMENT_ORCHESTRATION_SIGNED_REQUESTS_MODE'];
    delete process.env['PAYMENT_ORCHESTRATION_SIGNED_REQUESTS_MODE'];
    try {
      const config = loadEnv();
      assert.equal(config.signedRequestsMode, 'optional');
    } finally {
      if (original !== undefined) process.env['PAYMENT_ORCHESTRATION_SIGNED_REQUESTS_MODE'] = original;
    }
  });
});
