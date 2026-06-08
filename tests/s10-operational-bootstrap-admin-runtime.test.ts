/**
 * s10-operational-bootstrap-admin-runtime.test.ts
 *
 * S10 — Operational Bootstrap & Admin Runtime tests.
 *
 * Unit tests for CLI command handlers using in-memory repositories.
 * No database or HTTP server required.
 *
 * Test cases:
 *   U01: parseArgs — flags and positionals parsed correctly
 *   U02: parseArgs --dry-run flag
 *   U03: parseArgs --json flag
 *   U04: parseArgs --yes flag
 *   U05: requireFlag throws ADMIN_INVALID_ARGUMENT when missing
 *   U06: parseScopes splits comma-separated scopes
 *   U07: validateScopes rejects unknown scopes
 *   U08: validateScopes accepts all official scopes
 *   U09: succeed() / fail() output shapes conform to contract
 *   U10: createClient — creates API client, returns safe view
 *   U11: createClient — rejects unknown scopes
 *   U12: createClient — dry-run returns preview without writing
 *   U13: createClient — fails with ADMIN_ALREADY_EXISTS if client exists
 *   U14: createCredential — returns rawCredential once
 *   U15: createCredential — rawCredential not stored in repo
 *   U16: createCredential — dry-run returns preview
 *   U17: createCredential — ADMIN_NOT_FOUND for unknown client
 *   U18: revokeCredential — requires --yes without --dry-run
 *   U19: revokeCredential — revokes and returns safe view
 *   U20: revokeCredential — dry-run returns preview
 *   U21: createMerchant — creates merchant, returns safe view
 *   U22: createMerchant — idempotent via sourceApp+externalRef
 *   U23: grantMerchant — creates access grant
 *   U24: grantMerchant — rejects ADMIN_ALREADY_EXISTS for active grant
 *   U25: revokeMerchant — requires --yes
 *   U26: revokeMerchant — revokes active grant
 *   U27: createProviderAccount — creates PA for merchant
 *   U28: createProviderAccount — ADMIN_NOT_FOUND for unknown merchant
 *   U29: listPaymentMethods — returns methods list
 *   U30: enablePaymentMethod — upserts method as active
 *   U31: disablePaymentMethod — requires --yes
 *   U32: disablePaymentMethod — sets method status to disabled
 *   U33: bootstrapBundle — creates client + credential + merchant + grant
 *   U34: bootstrapBundle — dry-run returns preview
 *   U35: bootstrapBundle — fails ADMIN_ALREADY_EXISTS if client exists
 *   U36: createSigningKey — ADMIN_CONFIG_MISSING without encryption secret
 *   U37: revokeSigningKey — revokes key and returns safe view
 *   U38: audit — admin actions written via writeAdminAuditLog
 *   U39: listClients — returns all clients safe view
 *   U40: getClient — returns client with credentials and signing keys
 *
 * Run:
 *   pnpm test
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { parseArgs, getFlag, requireFlag, parseScopes, parseJsonFlag } from '../apps/service/src/cli/parseArgs.ts';
import { succeed, fail } from '../apps/service/src/cli/output.ts';
import { validateScopes, OFFICIAL_SCOPES } from '../apps/service/src/cli/adminContext.ts';
import { writeAdminAuditLog } from '../apps/service/src/cli/adminAudit.ts';

import { runCreateClient } from '../apps/service/src/cli/commands/createClient.ts';
import { runListClients } from '../apps/service/src/cli/commands/listClients.ts';
import { runGetClient } from '../apps/service/src/cli/commands/getClient.ts';
import { runCreateCredential } from '../apps/service/src/cli/commands/createCredential.ts';
import { runRevokeCredential } from '../apps/service/src/cli/commands/revokeCredential.ts';
import { runCreateSigningKey } from '../apps/service/src/cli/commands/createSigningKey.ts';
import { runRevokeSigningKey } from '../apps/service/src/cli/commands/revokeSigningKey.ts';
import { runCreateMerchant } from '../apps/service/src/cli/commands/createMerchant.ts';
import { runGrantMerchant } from '../apps/service/src/cli/commands/grantMerchant.ts';
import { runRevokeMerchant } from '../apps/service/src/cli/commands/revokeMerchant.ts';
import { runCreateProviderAccount } from '../apps/service/src/cli/commands/createProviderAccount.ts';
import { runListPaymentMethods } from '../apps/service/src/cli/commands/listPaymentMethods.ts';
import { runEnablePaymentMethod } from '../apps/service/src/cli/commands/enablePaymentMethod.ts';
import { runDisablePaymentMethod } from '../apps/service/src/cli/commands/disablePaymentMethod.ts';
import { runBootstrapBundle } from '../apps/service/src/cli/commands/bootstrapBundle.ts';

import type {
  ApiClientRepository,
  ClientCredentialRepository,
  ClientMerchantAccessRepository,
  PaymentMerchantRepository,
  PaymentProviderAccountRepository,
  ProviderAccountPaymentMethodRepository,
  AuditLogRepository,
  ApiClientDTO,
  ClientCredentialDTO,
  ClientMerchantAccessDTO,
  PaymentMerchant,
  PaymentProviderAccount,
  ProviderAccountPaymentMethod,
  AuditLog,
  CreateApiClientInput,
  CreateClientCredentialInput,
  CreateClientMerchantAccessInput,
  CreateAuditLogInput,
  ListAuditLogsInput,
  ApiClientStatus,
  ClientMerchantAccessStatus,
  UpsertProviderAccountMethodInput,
} from '@northflow/payment-orchestration-core';

import type { AdminContext } from '../apps/service/src/cli/adminContext.ts';
import { poApiClients } from '../apps/service/src/infrastructure/schema.ts';
import type { ClientSigningKeyRepository, ClientSigningKeyDTO } from '@northflow/payment-orchestration-core';

// ── In-memory repositories ───────────────────────────────────────────────────

class InMemoryApiClientRepository implements ApiClientRepository {
  private store = new Map<string, ApiClientDTO>();

  async findById(id: string): Promise<ApiClientDTO | null> {
    return this.store.get(id) ?? null;
  }

  async create(input: CreateApiClientInput): Promise<ApiClientDTO> {
    const now = new Date();
    const dto: ApiClientDTO = {
      id: input.id,
      name: input.name,
      sourceApp: input.sourceApp,
      environment: input.environment,
      status: (input.status ?? 'active') as ApiClientStatus,
      scopes: input.scopes ?? [],
      metadata: input.metadata ?? {},
      createdAt: now,
      updatedAt: now,
    };
    this.store.set(dto.id, dto);
    return dto;
  }

  async updateStatus(id: string, status: ApiClientStatus): Promise<ApiClientDTO> {
    const dto = this.store.get(id);
    if (!dto) throw new Error(`Not found: ${id}`);
    const updated = { ...dto, status, updatedAt: new Date() };
    this.store.set(id, updated);
    return updated;
  }

  listAll(): ApiClientDTO[] {
    return Array.from(this.store.values());
  }
}

class InMemoryCredentialRepository implements ClientCredentialRepository {
  private store = new Map<string, ClientCredentialDTO>();
  private seq = 0;

  async findByPrefix(prefix: string): Promise<ClientCredentialDTO | null> {
    for (const c of this.store.values()) {
      if (c.credentialPrefix === prefix) return c;
    }
    return null;
  }

  async findById(id: string): Promise<ClientCredentialDTO | null> {
    return this.store.get(id) ?? null;
  }

  async listByClientId(clientId: string): Promise<ClientCredentialDTO[]> {
    return Array.from(this.store.values())
      .filter((c) => c.clientId === clientId)
      .sort((a, b) => (++this.seq, a.createdAt.getTime() - b.createdAt.getTime()));
  }

  async create(input: CreateClientCredentialInput): Promise<ClientCredentialDTO> {
    const now = new Date();
    const dto: ClientCredentialDTO = {
      id: input.id,
      clientId: input.clientId,
      credentialPrefix: input.credentialPrefix,
      credentialHash: input.credentialHash,
      status: 'active',
      expiresAt: input.expiresAt ?? null,
      lastUsedAt: null,
      createdAt: now,
      revokedAt: null,
    };
    this.store.set(dto.id, dto);
    return dto;
  }

  async revoke(id: string): Promise<void> {
    const dto = this.store.get(id);
    if (dto) this.store.set(id, { ...dto, status: 'revoked', revokedAt: new Date() });
  }

  async updateLastUsed(id: string): Promise<void> {
    const dto = this.store.get(id);
    if (dto) this.store.set(id, { ...dto, lastUsedAt: new Date() });
  }
}

class InMemorySigningKeyRepository implements ClientSigningKeyRepository {
  private store = new Map<string, ClientSigningKeyDTO>();

  async findById(id: string): Promise<ClientSigningKeyDTO | null> {
    return this.store.get(id) ?? null;
  }

  async findByPrefix(prefix: string): Promise<ClientSigningKeyDTO | null> {
    for (const k of this.store.values()) {
      if (k.keyPrefix === prefix) return k;
    }
    return null;
  }

  async listByClientId(clientId: string): Promise<ClientSigningKeyDTO[]> {
    return Array.from(this.store.values()).filter((k) => k.clientId === clientId);
  }

  async create(input: {
    id: string;
    clientId: string;
    keyPrefix: string;
    secretCiphertext: string;
    secretKeyVersion: string;
    expiresAt?: Date | null;
  }): Promise<ClientSigningKeyDTO> {
    const now = new Date();
    const dto: ClientSigningKeyDTO = {
      id: input.id,
      clientId: input.clientId,
      keyPrefix: input.keyPrefix,
      secretCiphertext: input.secretCiphertext,
      secretKeyVersion: input.secretKeyVersion,
      status: 'active',
      expiresAt: input.expiresAt ?? null,
      lastUsedAt: null,
      createdAt: now,
      revokedAt: null,
    };
    this.store.set(dto.id, dto);
    return dto;
  }

  async revoke(id: string, _revokedAt?: Date): Promise<void> {
    const dto = this.store.get(id);
    if (dto) this.store.set(id, { ...dto, status: 'revoked', revokedAt: _revokedAt ?? new Date() });
  }

  async updateLastUsed(id: string): Promise<void> {
    const dto = this.store.get(id);
    if (dto) this.store.set(id, { ...dto, lastUsedAt: new Date() });
  }
}

class InMemoryMerchantRepository implements PaymentMerchantRepository {
  private store = new Map<string, PaymentMerchant>();

  async findById(id: string): Promise<PaymentMerchant | null> {
    return this.store.get(id) ?? null;
  }

  async findByExternalRef(input: { sourceApp: string; externalRef: string }): Promise<PaymentMerchant | null> {
    for (const m of this.store.values()) {
      if (m.sourceApp === input.sourceApp && m.externalRef === input.externalRef) return m;
    }
    return null;
  }

  async create(input: any): Promise<PaymentMerchant> {
    const now = new Date();
    const m: PaymentMerchant = {
      id: input.id,
      displayName: input.name,        // CreatePaymentMerchantInput.name maps to PaymentMerchant.displayName
      legalName: input.legalName ?? null,
      sourceApp: input.sourceApp ?? null,
      externalRef: input.externalRef ?? null,
      status: input.status ?? 'active',
      metadata: input.metadata ?? {},
      createdAt: now,
      updatedAt: now,
    };
    this.store.set(m.id, m);
    return m;
  }

  async updateStatus(id: string, status: string): Promise<PaymentMerchant> {
    const m = this.store.get(id);
    if (!m) throw new Error(`Not found: ${id}`);
    const updated = { ...m, status: status as any, updatedAt: new Date() };
    this.store.set(id, updated);
    return updated;
  }
}

class InMemoryProviderAccountRepository implements PaymentProviderAccountRepository {
  private store = new Map<string, PaymentProviderAccount>();

  async findById(id: string, merchantId?: string): Promise<PaymentProviderAccount | null> {
    const pa = this.store.get(id);
    if (!pa) return null;
    if (merchantId && pa.merchantId !== merchantId) return null;
    return pa;
  }

  async listByMerchant(merchantId: string): Promise<PaymentProviderAccount[]> {
    return Array.from(this.store.values()).filter((p) => p.merchantId === merchantId);
  }

  async create(input: any): Promise<PaymentProviderAccount> {
    const now = new Date();
    const pa: PaymentProviderAccount = {
      id: input.id,
      merchantId: input.merchantId,
      provider: input.provider,
      environment: input.environment,
      providerAccountRef: input.providerAccountRef ?? null,
      credentialsRef: input.credentialsRef ?? null,
      publicConfig: input.publicConfig ?? {},
      status: input.status ?? 'active',
      metadata: input.metadata ?? {},
      createdAt: now,
      updatedAt: now,
    };
    this.store.set(pa.id, pa);
    return pa;
  }

  async updateStatus(id: string, status: string): Promise<PaymentProviderAccount> {
    const pa = this.store.get(id);
    if (!pa) throw new Error(`Not found: ${id}`);
    const updated = { ...pa, status: status as any, updatedAt: new Date() };
    this.store.set(id, updated);
    return updated;
  }
}

class InMemoryMethodRepository implements ProviderAccountPaymentMethodRepository {
  private store = new Map<string, ProviderAccountPaymentMethod>();

  async findByProviderAccountAndMethod(providerAccountId: string, method: string): Promise<ProviderAccountPaymentMethod | null> {
    for (const m of this.store.values()) {
      if (m.providerAccountId === providerAccountId && m.method === method) return m;
    }
    return null;
  }

  async listByProviderAccount(providerAccountId: string): Promise<ProviderAccountPaymentMethod[]> {
    return Array.from(this.store.values()).filter((m) => m.providerAccountId === providerAccountId);
  }

  async listByMerchant(merchantId: string): Promise<ProviderAccountPaymentMethod[]> {
    return Array.from(this.store.values()).filter((m) => m.merchantId === merchantId);
  }

  async upsert(input: UpsertProviderAccountMethodInput): Promise<ProviderAccountPaymentMethod> {
    const now = new Date();
    const m: ProviderAccountPaymentMethod = {
      id: input.id,
      merchantId: input.merchantId,
      providerAccountId: input.providerAccountId,
      provider: input.provider,
      method: input.method,
      methodType: input.methodType ?? 'other',
      providerMethodCode: input.providerMethodCode ?? null,
      displayName: input.displayName ?? input.method,
      status: input.status ?? 'active',
      currency: input.currency ?? 'IDR',
      minAmount: input.minAmount ?? null,
      maxAmount: input.maxAmount ?? null,
      sortOrder: input.sortOrder ?? 0,
      publicConfig: input.publicConfig ?? {},
      providerMetadata: input.providerMetadata ?? {},
      metadata: input.metadata ?? {},
      createdAt: this.store.get(input.id)?.createdAt ?? now,
      updatedAt: now,
    };
    this.store.set(m.id, m);
    return m;
  }

  async deleteByProviderAccount(providerAccountId: string): Promise<void> {
    for (const [id, m] of this.store.entries()) {
      if (m.providerAccountId === providerAccountId) this.store.delete(id);
    }
  }
}

class InMemoryAccessRepository implements ClientMerchantAccessRepository {
  private store = new Map<string, ClientMerchantAccessDTO>();

  async findByClientAndMerchant(clientId: string, merchantId: string): Promise<ClientMerchantAccessDTO | null> {
    for (const g of this.store.values()) {
      if (g.clientId === clientId && g.merchantId === merchantId) return g;
    }
    return null;
  }

  async findByClient(clientId: string): Promise<ClientMerchantAccessDTO[]> {
    return Array.from(this.store.values()).filter((g) => g.clientId === clientId);
  }

  async create(input: CreateClientMerchantAccessInput): Promise<ClientMerchantAccessDTO> {
    const now = new Date();
    const dto: ClientMerchantAccessDTO = {
      id: input.id,
      clientId: input.clientId,
      merchantId: input.merchantId,
      scopes: input.scopes ?? [],
      status: 'active' as ClientMerchantAccessStatus,
      createdAt: now,
      revokedAt: null,
    };
    this.store.set(dto.id, dto);
    return dto;
  }

  async revoke(id: string): Promise<void> {
    const dto = this.store.get(id);
    if (dto) this.store.set(id, { ...dto, status: 'revoked' as ClientMerchantAccessStatus, revokedAt: new Date() });
  }
}

class InMemoryAuditLogRepository implements AuditLogRepository {
  public logs: AuditLog[] = [];
  private seq = 0;

  async create(input: CreateAuditLogInput): Promise<AuditLog> {
    const log: AuditLog = {
      id: input.id,
      seq: ++this.seq,
      requestId: input.requestId,
      clientId: input.clientId ?? null,
      sourceApp: input.sourceApp ?? null,
      merchantId: input.merchantId ?? null,
      actorType: input.actorType,
      action: input.action,
      resourceType: input.resourceType ?? null,
      resourceId: input.resourceId ?? null,
      status: input.status,
      httpMethod: input.httpMethod ?? null,
      path: input.path ?? null,
      statusCode: input.statusCode ?? null,
      errorCode: input.errorCode ?? null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      metadata: input.metadata ?? {},
      createdAt: new Date(),
    };
    this.logs.push(log);
    return log;
  }

  async list(input: ListAuditLogsInput): Promise<AuditLog[]> {
    let results = this.logs;
    if (input.clientId) results = results.filter((l) => l.clientId === input.clientId);
    if (input.merchantId) results = results.filter((l) => l.merchantId === input.merchantId);
    if (input.action) results = results.filter((l) => l.action === input.action);
    return results.slice(0, input.limit ?? 50);
  }
}

// ── Context builder ───────────────────────────────────────────────────────────

function makeCtx(overrides: Partial<{
  apiClientRepo: InMemoryApiClientRepository;
  credentialRepo: InMemoryCredentialRepository;
  signingKeyRepo: InMemorySigningKeyRepository;
  merchantRepo: InMemoryMerchantRepository;
  providerAccountRepo: InMemoryProviderAccountRepository;
  methodRepo: InMemoryMethodRepository;
  accessRepo: InMemoryAccessRepository;
  auditRepo: InMemoryAuditLogRepository;
}> = {}): AdminContext {
  const apiClientRepo = overrides.apiClientRepo ?? new InMemoryApiClientRepository();
  const credentialRepo = overrides.credentialRepo ?? new InMemoryCredentialRepository();
  const signingKeyRepo = overrides.signingKeyRepo ?? new InMemorySigningKeyRepository();
  const merchantRepo = overrides.merchantRepo ?? new InMemoryMerchantRepository();
  const providerAccountRepo = overrides.providerAccountRepo ?? new InMemoryProviderAccountRepository();
  const methodRepo = overrides.methodRepo ?? new InMemoryMethodRepository();
  const accessRepo = overrides.accessRepo ?? new InMemoryAccessRepository();
  const auditRepo = overrides.auditRepo ?? new InMemoryAuditLogRepository();

  // db shape with select needed for list-clients
  const mockDb = {
    select: () => ({
      from: () => Promise.resolve(apiClientRepo.listAll().map((c) => ({
        id: c.id,
        name: c.name,
        sourceApp: c.sourceApp,
        environment: c.environment,
        status: c.status,
        scopes: c.scopes,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      }))),
    }),
  };

  return {
    db: mockDb as any,
    apiClientRepo: apiClientRepo as any,
    credentialRepo: credentialRepo as any,
    accessRepo: accessRepo as any,
    signingKeyRepo: signingKeyRepo as any,
    merchantRepo: merchantRepo as any,
    providerAccountRepo: providerAccountRepo as any,
    methodRepo: methodRepo as any,
    auditRepo: auditRepo as any,
    providerRegistry: new Map(),
    nodeEnv: 'test',
  };
}

function makeArgs(overrides: Partial<{
  command: string;
  flags: Record<string, string | boolean>;
  json: boolean;
  dryRun: boolean;
  yes: boolean;
  help: boolean;
}> = {}, positionals?: string[]): ReturnType<typeof parseArgs> {
  return {
    command: overrides.command ?? null,
    flags: overrides.flags ?? {},
    positionals: positionals ?? (overrides.command ? [overrides.command] : []),
    json: overrides.json ?? false,
    dryRun: overrides.dryRun ?? false,
    yes: overrides.yes ?? false,
    help: overrides.help ?? false,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('S10 — parseArgs', () => {
  test('U01: parses flags and positionals', () => {
    const args = parseArgs(['create-client', '--name', 'Test', '--environment', 'sandbox', '--json']);
    assert.equal(args.command, 'create-client');
    assert.equal(args.flags['name'], 'Test');
    assert.equal(args.flags['environment'], 'sandbox');
    assert.equal(args.json, true);
  });

  test('U02: --dry-run flag', () => {
    const args = parseArgs(['create-client', '--dry-run']);
    assert.equal(args.dryRun, true);
  });

  test('U03: --json flag', () => {
    const args = parseArgs(['list-clients', '--json']);
    assert.equal(args.json, true);
  });

  test('U04: --yes flag', () => {
    const args = parseArgs(['revoke-credential', '--yes']);
    assert.equal(args.yes, true);
  });

  test('U05: requireFlag throws ADMIN_INVALID_ARGUMENT when missing', () => {
    const args = makeArgs({ flags: {} });
    assert.throws(
      () => requireFlag(args, 'name'),
      (err: any) => err.code === 'ADMIN_INVALID_ARGUMENT' && err.message.includes('--name'),
    );
  });

  test('U06: parseScopes splits comma-separated scopes', () => {
    const scopes = parseScopes('merchant:read,merchant:create,intent:read');
    assert.deepEqual(scopes, ['merchant:read', 'merchant:create', 'intent:read']);
  });
});

describe('S10 — validateScopes', () => {
  test('U07: rejects unknown scopes', () => {
    const { valid, unknown } = validateScopes(['merchant:read', 'bad:scope']);
    assert.equal(valid, false);
    assert.ok(unknown.includes('bad:scope'));
  });

  test('U08: accepts all official scopes', () => {
    const allScopes = Array.from(OFFICIAL_SCOPES).filter((s) => s !== '*');
    const { valid, unknown } = validateScopes(allScopes);
    assert.equal(valid, true);
    assert.equal(unknown.length, 0);
  });
});

describe('S10 — output contract', () => {
  test('U09: succeed and fail shapes', () => {
    const s = succeed('test-op', { id: '123' });
    assert.equal(s.ok, true);
    assert.equal(s.operation, 'test-op');
    assert.equal((s.result as any).id, '123');

    const f = fail('test-op', 'ADMIN_NOT_FOUND', 'not found', { hint: 'check id' });
    assert.equal(f.ok, false);
    assert.equal(f.error.code, 'ADMIN_NOT_FOUND');
    assert.equal(f.error.message, 'not found');
    assert.deepEqual(f.error.details, { hint: 'check id' });
  });
});

describe('S10 — create-client', () => {
  test('U10: creates API client, returns safe view', async () => {
    const ctx = makeCtx();
    const args = makeArgs({
      command: 'create-client',
      flags: {
        'client-id': 'client_test',
        name: 'Test Client',
        'source-app': 'test-app',
        environment: 'sandbox',
        scopes: 'merchant:read,intent:create',
      },
    });
    const output = await runCreateClient(args, ctx);
    assert.equal(output.ok, true);
    if (!output.ok) throw new Error('expected ok');
    assert.equal(output.result['clientId'], 'client_test');
    assert.equal(output.result['name'], 'Test Client');
    assert.equal(output.result['environment'], 'sandbox');
  });

  test('U11: rejects unknown scopes', async () => {
    const ctx = makeCtx();
    const args = makeArgs({
      command: 'create-client',
      flags: { name: 'T', 'source-app': 'x', environment: 'sandbox', scopes: 'badscope:x' },
    });
    const output = await runCreateClient(args, ctx);
    assert.equal(output.ok, false);
    if (output.ok) throw new Error('expected error');
    assert.equal(output.error.code, 'ADMIN_SCOPE_INVALID');
  });

  test('U12: dry-run returns preview without writing', async () => {
    const ctx = makeCtx();
    const args = makeArgs({
      command: 'create-client',
      flags: { 'client-id': 'dryrun-client', name: 'T', 'source-app': 'x', environment: 'sandbox' },
      dryRun: true,
    });
    const output = await runCreateClient(args, ctx);
    assert.equal(output.ok, true);
    if (!output.ok) throw new Error('expected ok');
    assert.equal(output.result['dryRun'], true);
    const found = await ctx.apiClientRepo.findById('dryrun-client');
    assert.equal(found, null, 'dry-run must not write to DB');
  });

  test('U13: ADMIN_ALREADY_EXISTS if client exists', async () => {
    const clientRepo = new InMemoryApiClientRepository();
    await clientRepo.create({ id: 'existing', name: 'E', sourceApp: 'x', environment: 'sandbox', scopes: [], status: 'active', metadata: {} });
    const ctx = makeCtx({ apiClientRepo: clientRepo });
    const args = makeArgs({
      command: 'create-client',
      flags: { 'client-id': 'existing', name: 'T', 'source-app': 'x', environment: 'sandbox' },
    });
    const output = await runCreateClient(args, ctx);
    assert.equal(output.ok, false);
    if (output.ok) throw new Error('expected error');
    assert.equal(output.error.code, 'ADMIN_ALREADY_EXISTS');
  });
});

describe('S10 — create-credential', () => {
  test('U14: returns rawCredential once', async () => {
    const clientRepo = new InMemoryApiClientRepository();
    await clientRepo.create({ id: 'cli_01', name: 'C', sourceApp: 'x', environment: 'sandbox', scopes: [], status: 'active', metadata: {} });
    const ctx = makeCtx({ apiClientRepo: clientRepo });
    const args = makeArgs({ command: 'create-credential', flags: { 'client-id': 'cli_01' } });
    const output = await runCreateCredential(args, ctx);
    assert.equal(output.ok, true);
    if (!output.ok) throw new Error('expected ok');
    const raw = output.result['rawCredential'] as string;
    assert.ok(raw.startsWith('nf.'), `rawCredential should start with nf. but got: ${raw}`);
  });

  test('U15: rawCredential is not the stored hash', async () => {
    const clientRepo = new InMemoryApiClientRepository();
    await clientRepo.create({ id: 'cli_02', name: 'C', sourceApp: 'x', environment: 'sandbox', scopes: [], status: 'active', metadata: {} });
    const credentialRepo = new InMemoryCredentialRepository();
    const ctx = makeCtx({ apiClientRepo: clientRepo, credentialRepo });
    const args = makeArgs({ command: 'create-credential', flags: { 'client-id': 'cli_02' } });
    const output = await runCreateCredential(args, ctx);
    assert.ok(output.ok);
    if (!output.ok) throw new Error('expected ok');
    const rawCredential = output.result['rawCredential'] as string;
    const credId = output.result['credentialId'] as string;
    const stored = await credentialRepo.findById(credId);
    assert.ok(stored);
    assert.notEqual(stored!.credentialHash, rawCredential, 'hash must not equal raw credential');
    assert.equal(stored!.credentialHash.length, 64, 'SHA-256 hex = 64 chars');
  });

  test('U16: dry-run returns preview', async () => {
    const clientRepo = new InMemoryApiClientRepository();
    await clientRepo.create({ id: 'cli_03', name: 'C', sourceApp: 'x', environment: 'sandbox', scopes: [], status: 'active', metadata: {} });
    const ctx = makeCtx({ apiClientRepo: clientRepo });
    const args = makeArgs({ command: 'create-credential', flags: { 'client-id': 'cli_03' }, dryRun: true });
    const output = await runCreateCredential(args, ctx);
    assert.equal(output.ok, true);
    if (!output.ok) throw new Error('expected ok');
    assert.equal(output.result['dryRun'], true);
  });

  test('U17: ADMIN_NOT_FOUND for unknown client', async () => {
    const ctx = makeCtx();
    const args = makeArgs({ command: 'create-credential', flags: { 'client-id': 'ghost' } });
    const output = await runCreateCredential(args, ctx);
    assert.equal(output.ok, false);
    if (output.ok) throw new Error('expected error');
    assert.equal(output.error.code, 'ADMIN_NOT_FOUND');
  });
});

describe('S10 — revoke-credential', () => {
  test('U18: requires --yes without --dry-run', async () => {
    const ctx = makeCtx();
    const args = makeArgs({ command: 'revoke-credential', flags: { 'client-id': 'x', 'credential-id': 'y' } });
    const output = await runRevokeCredential(args, ctx);
    assert.equal(output.ok, false);
    if (output.ok) throw new Error('expected error');
    assert.equal(output.error.code, 'ADMIN_CONFIRMATION_REQUIRED');
  });

  test('U19: revokes and returns safe view', async () => {
    const clientRepo = new InMemoryApiClientRepository();
    await clientRepo.create({ id: 'cli_r', name: 'C', sourceApp: 'x', environment: 'sandbox', scopes: [], status: 'active', metadata: {} });
    const credentialRepo = new InMemoryCredentialRepository();
    const ctx = makeCtx({ apiClientRepo: clientRepo, credentialRepo });
    const createArgs = makeArgs({ command: 'create-credential', flags: { 'client-id': 'cli_r' } });
    const created = await runCreateCredential(createArgs, ctx);
    assert.ok(created.ok);
    if (!created.ok) throw new Error('expected ok');
    const credId = created.result['credentialId'] as string;

    const revokeArgs = makeArgs({
      command: 'revoke-credential',
      flags: { 'client-id': 'cli_r', 'credential-id': credId },
      yes: true,
    });
    const output = await runRevokeCredential(revokeArgs, ctx);
    assert.equal(output.ok, true);
    if (!output.ok) throw new Error('expected ok');
    assert.equal(output.result['status'], 'revoked');
  });

  test('U20: dry-run returns preview', async () => {
    const ctx = makeCtx();
    const args = makeArgs({
      command: 'revoke-credential',
      flags: { 'client-id': 'x', 'credential-id': 'y' },
      dryRun: true,
    });
    const output = await runRevokeCredential(args, ctx);
    assert.equal(output.ok, true);
    if (!output.ok) throw new Error('expected ok');
    assert.equal(output.result['dryRun'], true);
  });
});

describe('S10 — create-merchant', () => {
  test('U21: creates merchant, returns safe view', async () => {
    const ctx = makeCtx();
    const args = makeArgs({ command: 'create-merchant', flags: { name: 'Acme Inc' } });
    const output = await runCreateMerchant(args, ctx);
    assert.equal(output.ok, true);
    if (!output.ok) throw new Error('expected ok');
    assert.equal(output.result['name'], 'Acme Inc');
    assert.ok(output.result['merchantId']);
    assert.equal(output.result['created'], true);
  });

  test('U22: idempotent via sourceApp+externalRef', async () => {
    const ctx = makeCtx();
    const args1 = makeArgs({
      command: 'create-merchant',
      flags: { name: 'Acme', 'source-app': 'app1', 'external-ref': 'ref1' },
    });
    const r1 = await runCreateMerchant(args1, ctx);
    assert.ok(r1.ok);
    if (!r1.ok) throw new Error('expected ok');

    const args2 = makeArgs({
      command: 'create-merchant',
      flags: { name: 'Acme', 'source-app': 'app1', 'external-ref': 'ref1' },
    });
    const r2 = await runCreateMerchant(args2, ctx);
    assert.ok(r2.ok);
    if (!r2.ok) throw new Error('expected ok');
    assert.equal(r2.result['merchantId'], r1.result['merchantId'], 'same merchant returned');
    assert.equal(r2.result['created'], false);
  });
});

describe('S10 — grant-merchant', () => {
  test('U23: creates access grant', async () => {
    const clientRepo = new InMemoryApiClientRepository();
    await clientRepo.create({ id: 'cli_g', name: 'C', sourceApp: 'x', environment: 'sandbox', scopes: [], status: 'active', metadata: {} });
    const merchantRepo = new InMemoryMerchantRepository();
    const merchant = await merchantRepo.create({ id: 'merch_g', name: 'M', sourceApp: null, externalRef: null, legalName: null, status: 'active', metadata: {} });
    const ctx = makeCtx({ apiClientRepo: clientRepo, merchantRepo });

    const args = makeArgs({
      command: 'grant-merchant',
      flags: { 'client-id': 'cli_g', 'merchant-id': merchant.id, scopes: 'merchant:read,intent:create' },
    });
    const output = await runGrantMerchant(args, ctx);
    assert.equal(output.ok, true);
    if (!output.ok) throw new Error('expected ok');
    assert.ok(output.result['grantId']);
    const scopes = output.result['scopes'] as string[];
    assert.ok(scopes.includes('merchant:read'));
  });

  test('U24: ADMIN_ALREADY_EXISTS for active grant', async () => {
    const clientRepo = new InMemoryApiClientRepository();
    await clientRepo.create({ id: 'cli_g2', name: 'C', sourceApp: 'x', environment: 'sandbox', scopes: [], status: 'active', metadata: {} });
    const merchantRepo = new InMemoryMerchantRepository();
    const merchant = await merchantRepo.create({ id: 'merch_g2', name: 'M', sourceApp: null, externalRef: null, legalName: null, status: 'active', metadata: {} });
    const ctx = makeCtx({ apiClientRepo: clientRepo, merchantRepo });

    const args = makeArgs({
      command: 'grant-merchant',
      flags: { 'client-id': 'cli_g2', 'merchant-id': merchant.id },
    });
    await runGrantMerchant(args, ctx);
    const output = await runGrantMerchant(args, ctx);
    assert.equal(output.ok, false);
    if (output.ok) throw new Error('expected error');
    assert.equal(output.error.code, 'ADMIN_ALREADY_EXISTS');
  });
});

describe('S10 — revoke-merchant', () => {
  test('U25: requires --yes', async () => {
    const ctx = makeCtx();
    const args = makeArgs({ command: 'revoke-merchant', flags: { 'client-id': 'x', 'merchant-id': 'y' } });
    const output = await runRevokeMerchant(args, ctx);
    assert.equal(output.ok, false);
    if (output.ok) throw new Error('expected error');
    assert.equal(output.error.code, 'ADMIN_CONFIRMATION_REQUIRED');
  });

  test('U26: revokes active grant', async () => {
    const clientRepo = new InMemoryApiClientRepository();
    await clientRepo.create({ id: 'cli_rv', name: 'C', sourceApp: 'x', environment: 'sandbox', scopes: [], status: 'active', metadata: {} });
    const merchantRepo = new InMemoryMerchantRepository();
    const merchant = await merchantRepo.create({ id: 'merch_rv', name: 'M', sourceApp: null, externalRef: null, legalName: null, status: 'active', metadata: {} });
    const ctx = makeCtx({ apiClientRepo: clientRepo, merchantRepo });

    const grantArgs = makeArgs({ command: 'grant-merchant', flags: { 'client-id': 'cli_rv', 'merchant-id': merchant.id } });
    await runGrantMerchant(grantArgs, ctx);

    const revokeArgs = makeArgs({
      command: 'revoke-merchant',
      flags: { 'client-id': 'cli_rv', 'merchant-id': merchant.id },
      yes: true,
    });
    const output = await runRevokeMerchant(revokeArgs, ctx);
    assert.equal(output.ok, true);
    if (!output.ok) throw new Error('expected ok');
    assert.equal(output.result['status'], 'revoked');
  });
});

describe('S10 — create-provider-account', () => {
  test('U27: creates PA for merchant', async () => {
    const merchantRepo = new InMemoryMerchantRepository();
    const merchant = await merchantRepo.create({ id: 'merch_pa', name: 'M', sourceApp: null, externalRef: null, legalName: null, status: 'active', metadata: {} });
    const ctx = makeCtx({ merchantRepo });

    const args = makeArgs({
      command: 'create-provider-account',
      flags: { 'merchant-id': merchant.id, provider: 'fake_gateway', environment: 'sandbox' },
    });
    const output = await runCreateProviderAccount(args, ctx);
    assert.equal(output.ok, true);
    if (!output.ok) throw new Error('expected ok');
    assert.equal(output.result['provider'], 'fake_gateway');
    assert.ok(output.result['providerAccountId']);
  });

  test('U28: ADMIN_NOT_FOUND for unknown merchant', async () => {
    const ctx = makeCtx();
    const args = makeArgs({
      command: 'create-provider-account',
      flags: { 'merchant-id': 'ghost_merch', provider: 'fake_gateway', environment: 'sandbox' },
    });
    const output = await runCreateProviderAccount(args, ctx);
    assert.equal(output.ok, false);
    if (output.ok) throw new Error('expected error');
    assert.equal(output.error.code, 'ADMIN_NOT_FOUND');
  });
});

describe('S10 — list-payment-methods', () => {
  test('U29: returns methods list', async () => {
    const merchantRepo = new InMemoryMerchantRepository();
    const merchant = await merchantRepo.create({ id: 'merch_lm', name: 'M', sourceApp: null, externalRef: null, legalName: null, status: 'active', metadata: {} });
    const providerAccountRepo = new InMemoryProviderAccountRepository();
    const pa = await providerAccountRepo.create({ id: 'pa_lm', merchantId: merchant.id, provider: 'fake_gateway', environment: 'sandbox', status: 'active', metadata: {}, publicConfig: {} });
    const methodRepo = new InMemoryMethodRepository();
    const ctx = makeCtx({ merchantRepo, providerAccountRepo, methodRepo });

    const enableArgs = makeArgs({
      command: 'enable-payment-method',
      flags: { 'merchant-id': merchant.id, 'provider-account-id': pa.id, method: 'CARD', 'method-type': 'card' },
    });
    await runEnablePaymentMethod(enableArgs, ctx);

    const listArgs = makeArgs({ command: 'list-payment-methods', flags: { 'merchant-id': merchant.id, 'provider-account-id': pa.id } });
    const output = await runListPaymentMethods(listArgs, ctx);
    assert.equal(output.ok, true);
    if (!output.ok) throw new Error('expected ok');
    const methods = output.result['methods'] as any[];
    assert.equal(methods.length, 1);
    assert.equal(methods[0].method, 'CARD');
  });
});

describe('S10 — enable/disable-payment-method', () => {
  test('U30: upserts method as active', async () => {
    const merchantRepo = new InMemoryMerchantRepository();
    const merchant = await merchantRepo.create({ id: 'merch_em', name: 'M', sourceApp: null, externalRef: null, legalName: null, status: 'active', metadata: {} });
    const providerAccountRepo = new InMemoryProviderAccountRepository();
    const pa = await providerAccountRepo.create({ id: 'pa_em', merchantId: merchant.id, provider: 'fake_gateway', environment: 'sandbox', status: 'active', metadata: {}, publicConfig: {} });
    const ctx = makeCtx({ merchantRepo, providerAccountRepo });

    const args = makeArgs({
      command: 'enable-payment-method',
      flags: { 'merchant-id': merchant.id, 'provider-account-id': pa.id, method: 'EWALLET', 'method-type': 'ewallet', currency: 'IDR' },
    });
    const output = await runEnablePaymentMethod(args, ctx);
    assert.equal(output.ok, true);
    if (!output.ok) throw new Error('expected ok');
    assert.equal(output.result['status'], 'active');
    assert.equal(output.result['method'], 'EWALLET');
  });

  test('U31: disable requires --yes', async () => {
    const ctx = makeCtx();
    const args = makeArgs({ command: 'disable-payment-method', flags: { 'merchant-id': 'x', 'provider-account-id': 'y', method: 'z' } });
    const output = await runDisablePaymentMethod(args, ctx);
    assert.equal(output.ok, false);
    if (output.ok) throw new Error('expected error');
    assert.equal(output.error.code, 'ADMIN_CONFIRMATION_REQUIRED');
  });

  test('U32: disable sets method status to disabled', async () => {
    const merchantRepo = new InMemoryMerchantRepository();
    const merchant = await merchantRepo.create({ id: 'merch_dm', name: 'M', sourceApp: null, externalRef: null, legalName: null, status: 'active', metadata: {} });
    const providerAccountRepo = new InMemoryProviderAccountRepository();
    const pa = await providerAccountRepo.create({ id: 'pa_dm', merchantId: merchant.id, provider: 'fake_gateway', environment: 'sandbox', status: 'active', metadata: {}, publicConfig: {} });
    const ctx = makeCtx({ merchantRepo, providerAccountRepo });

    const enableArgs = makeArgs({
      command: 'enable-payment-method',
      flags: { 'merchant-id': merchant.id, 'provider-account-id': pa.id, method: 'BANK_TRANSFER', 'method-type': 'bank_transfer' },
    });
    await runEnablePaymentMethod(enableArgs, ctx);

    const disableArgs = makeArgs({
      command: 'disable-payment-method',
      flags: { 'merchant-id': merchant.id, 'provider-account-id': pa.id, method: 'BANK_TRANSFER' },
      yes: true,
    });
    const output = await runDisablePaymentMethod(disableArgs, ctx);
    assert.equal(output.ok, true);
    if (!output.ok) throw new Error('expected ok');
    assert.equal(output.result['status'], 'disabled');
  });
});

describe('S10 — bootstrap-bundle', () => {
  test('U33: creates client + credential + merchant + grant', async () => {
    const ctx = makeCtx();
    const args = makeArgs({
      command: 'bootstrap-bundle',
      flags: {
        'client-id': 'bundle_cli',
        name: 'Bundle Service',
        'source-app': 'bundle',
        environment: 'sandbox',
        'merchant-name': 'Bundle Merchant',
        'grant-scopes': 'merchant:read,intent:create',
      },
    });
    const output = await runBootstrapBundle(args, ctx);
    assert.equal(output.ok, true);
    if (!output.ok) throw new Error(`expected ok, got: ${output.error?.message}`);
    assert.ok(output.result['client']);
    assert.ok(output.result['credential']);
    assert.ok(output.result['merchant']);
    assert.ok(output.result['grant']);
    const cred = output.result['credential'] as any;
    assert.ok(cred.rawCredential.startsWith('nf.'), 'rawCredential should start with nf.');
  });

  test('U34: dry-run returns preview', async () => {
    const ctx = makeCtx();
    const args = makeArgs({
      command: 'bootstrap-bundle',
      flags: {
        name: 'Bundle Service',
        'source-app': 'bundle',
        environment: 'sandbox',
        'merchant-name': 'Bundle Merchant',
      },
      dryRun: true,
    });
    const output = await runBootstrapBundle(args, ctx);
    assert.equal(output.ok, true);
    if (!output.ok) throw new Error('expected ok');
    assert.equal(output.result['dryRun'], true);
  });

  test('U35: ADMIN_ALREADY_EXISTS if client exists', async () => {
    const clientRepo = new InMemoryApiClientRepository();
    await clientRepo.create({ id: 'bundle_exists', name: 'E', sourceApp: 'x', environment: 'sandbox', scopes: [], status: 'active', metadata: {} });
    const ctx = makeCtx({ apiClientRepo: clientRepo });
    const args = makeArgs({
      command: 'bootstrap-bundle',
      flags: {
        'client-id': 'bundle_exists',
        name: 'Bundle Service',
        'source-app': 'x',
        environment: 'sandbox',
        'merchant-name': 'M',
      },
    });
    const output = await runBootstrapBundle(args, ctx);
    assert.equal(output.ok, false);
    if (output.ok) throw new Error('expected error');
    assert.equal(output.error.code, 'ADMIN_ALREADY_EXISTS');
  });
});

describe('S10 — create-signing-key', () => {
  test('U36: ADMIN_CONFIG_MISSING without encryption secret', async () => {
    const orig = process.env['PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_SECRET'];
    delete process.env['PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_SECRET'];
    try {
      const clientRepo = new InMemoryApiClientRepository();
      await clientRepo.create({ id: 'cli_sk', name: 'C', sourceApp: 'x', environment: 'sandbox', scopes: [], status: 'active', metadata: {} });
      const ctx = makeCtx({ apiClientRepo: clientRepo });
      const args = makeArgs({ command: 'create-signing-key', flags: { 'client-id': 'cli_sk' } });
      const output = await runCreateSigningKey(args, ctx);
      assert.equal(output.ok, false);
      if (output.ok) throw new Error('expected error');
      assert.equal(output.error.code, 'ADMIN_CONFIG_MISSING');
    } finally {
      if (orig !== undefined) process.env['PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_SECRET'] = orig;
    }
  });
});

describe('S10 — revoke-signing-key', () => {
  test('U37: revokes key and returns safe view', async () => {
    const clientRepo = new InMemoryApiClientRepository();
    await clientRepo.create({ id: 'cli_rsk', name: 'C', sourceApp: 'x', environment: 'sandbox', scopes: [], status: 'active', metadata: {} });
    const signingKeyRepo = new InMemorySigningKeyRepository();
    await signingKeyRepo.create({
      id: 'key_001',
      clientId: 'cli_rsk',
      keyPrefix: 'nfsk.testprefix',
      secretCiphertext: 'v1:fakeciphertext',
      secretKeyVersion: 'v1',
    });
    const ctx = makeCtx({ apiClientRepo: clientRepo, signingKeyRepo });
    const args = makeArgs({
      command: 'revoke-signing-key',
      flags: { 'client-id': 'cli_rsk', 'signing-key-id': 'key_001' },
      yes: true,
    });
    const output = await runRevokeSigningKey(args, ctx);
    assert.equal(output.ok, true);
    if (!output.ok) throw new Error('expected ok');
    assert.equal(output.result['status'], 'revoked');
    assert.equal(output.result['signingKeyId'], 'key_001');
  });
});

describe('S10 — audit logging', () => {
  test('U38: admin actions written via writeAdminAuditLog', async () => {
    const auditRepo = new InMemoryAuditLogRepository();
    await writeAdminAuditLog(auditRepo as any, {
      action: 'admin.api_client.create',
      clientId: 'cli_audit',
      resourceType: 'api_client',
      resourceId: 'cli_audit',
      metadata: { name: 'Test' },
    });
    assert.equal(auditRepo.logs.length, 1);
    assert.equal(auditRepo.logs[0]!.action, 'admin.api_client.create');
    assert.equal(auditRepo.logs[0]!.sourceApp, 'admin-cli');
    assert.equal(auditRepo.logs[0]!.userAgent, 'nf-admin-cli');
    assert.equal(auditRepo.logs[0]!.actorType, 'internal');
  });

  test('U38b: writeAdminAuditLog is fire-and-forget (no throw when auditRepo undefined)', async () => {
    await assert.doesNotReject(() =>
      writeAdminAuditLog(undefined, { action: 'admin.test' }),
    );
  });
});

describe('S10 — list-clients', () => {
  test('U39: returns all clients safe view', async () => {
    const clientRepo = new InMemoryApiClientRepository();
    await clientRepo.create({ id: 'c1', name: 'C1', sourceApp: 'x', environment: 'sandbox', scopes: [], status: 'active', metadata: {} });
    await clientRepo.create({ id: 'c2', name: 'C2', sourceApp: 'y', environment: 'production', scopes: [], status: 'active', metadata: {} });
    const ctx = makeCtx({ apiClientRepo: clientRepo });
    const args = makeArgs({ command: 'list-clients' });
    const output = await runListClients(args, ctx);
    assert.equal(output.ok, true);
    if (!output.ok) throw new Error('expected ok');
    assert.equal(output.result['total'], 2);
  });
});

describe('S10 — get-client', () => {
  test('U40: returns client with credentials and signing keys', async () => {
    const clientRepo = new InMemoryApiClientRepository();
    await clientRepo.create({ id: 'cli_get', name: 'GetMe', sourceApp: 'x', environment: 'sandbox', scopes: [], status: 'active', metadata: {} });
    const credRepo = new InMemoryCredentialRepository();
    const skRepo = new InMemorySigningKeyRepository();
    const ctx = makeCtx({ apiClientRepo: clientRepo, credentialRepo: credRepo, signingKeyRepo: skRepo });

    const createCredArgs = makeArgs({ command: 'create-credential', flags: { 'client-id': 'cli_get' } });
    await runCreateCredential(createCredArgs, ctx);

    const args = makeArgs({ command: 'get-client', flags: { 'client-id': 'cli_get' } });
    const output = await runGetClient(args, ctx);
    assert.equal(output.ok, true);
    if (!output.ok) throw new Error('expected ok');
    assert.equal(output.result['name'], 'GetMe');
    const creds = output.result['credentials'] as any[];
    assert.equal(creds.length, 1);
    assert.ok(!('credentialHash' in creds[0]), 'credentials must not contain hash');
  });
});
