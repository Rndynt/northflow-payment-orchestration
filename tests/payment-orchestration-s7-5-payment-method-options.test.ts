/**
 * payment-orchestration-s7-5-payment-method-options.test.ts
 *
 * Phase S7.5 — Payment Method Options Tests
 *
 * Two sections:
 *
 * A) Unit tests with in-memory repos (fast, no DB required)
 *    Tests SyncProviderAccountMethods, ListProviderAccountMethods,
 *    UpsertProviderAccountMethod, GetPaymentMethodOptions, and
 *    CreateGatewayPayment method validation.
 *
 * B) DB integration tests (real DB)
 *    Tests DrizzleProviderAccountMethodRepository with proper DB seeding.
 *
 * Tests:
 *   PM01  Sync FakeGateway capabilities → 6 methods created
 *   PM02  Sync is idempotent — running twice returns same methods
 *   PM03  listByProviderAccount returns correct shape after sync
 *   PM04  Upsert creates new entry, created=true
 *   PM05  Upsert updates existing entry, created=false
 *   PM06  Manually disabled method preserved through re-sync
 *   PM07  listByMerchant returns only active methods
 *   PM08  getPaymentOptions filters by currency
 *   PM09  Amount below minimum excluded from options
 *   PM10  Amount above maximum excluded from options
 *   PM11  CreateGatewayPayment succeeds when method registered+active
 *   PM12  PAYMENT_METHOD_NOT_AVAILABLE — method not in DB
 *   PM13  PAYMENT_METHOD_DISABLED — method status disabled
 *   PM14  PAYMENT_METHOD_AMOUNT_OUT_OF_RANGE — amount < minAmount
 *   PM15  PAYMENT_METHOD_CURRENCY_UNSUPPORTED — currency mismatch
 *   PM16  Sync Manual provider → 3 methods
 *   PM17  Sync with no capabilities → graceful no-op
 *   PM18  listByProviderAccount returns [] before any sync
 *   PM-DB01 DrizzleProviderAccountMethodRepository upsert + findById
 *   PM-DB02 DrizzleProviderAccountMethodRepository listByProviderAccount
 *   PM-DB03 DrizzleProviderAccountMethodRepository updateStatus
 *   PM-DB04 DrizzleProviderAccountMethodRepository ON CONFLICT idempotency
 *
 * Run:
 *   npx tsx --tsconfig tests/tsconfig.json --test \
 *     tests/payment-orchestration-s7-5-payment-method-options.test.ts
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import type {
  ProviderAccountPaymentMethodRepository,
  UpsertProviderAccountMethodInput,
  ProviderAccountPaymentMethod,
  ProviderAccountPaymentMethodStatus,
} from '@northflow/payment-orchestration-core';

import { SyncProviderAccountMethods } from '../apps/service/src/application/use-cases/SyncProviderAccountMethods.ts';
import { ListProviderAccountMethods } from '../apps/service/src/application/use-cases/ListProviderAccountMethods.ts';
import { UpsertProviderAccountMethod } from '../apps/service/src/application/use-cases/UpsertProviderAccountMethod.ts';
import { GetPaymentMethodOptions } from '../apps/service/src/application/use-cases/GetPaymentMethodOptions.ts';
import { CreateGatewayPayment } from '../apps/service/src/application/use-cases/CreateGatewayPayment.ts';
import { createProviderRegistry } from '../apps/service/src/infrastructure/providers/providerRegistry.ts';

// ════════════════════════════════════════════════════════════════════
// IN-MEMORY ProviderAccountPaymentMethodRepository
// ════════════════════════════════════════════════════════════════════

class InMemoryMethodRepo implements ProviderAccountPaymentMethodRepository {
  private store = new Map<string, ProviderAccountPaymentMethod>();

  async findById(id: string) { return this.store.get(id) ?? null; }

  async listByMerchant(merchantId: string) {
    return [...this.store.values()]
      .filter((m) => m.merchantId === merchantId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  async listByProviderAccount(providerAccountId: string) {
    return [...this.store.values()]
      .filter((m) => m.providerAccountId === providerAccountId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  async findByProviderAccountAndMethod(providerAccountId: string, method: string) {
    return (
      [...this.store.values()].find(
        (m) => m.providerAccountId === providerAccountId && m.method === method,
      ) ?? null
    );
  }

  async upsert(input: UpsertProviderAccountMethodInput): Promise<ProviderAccountPaymentMethod> {
    const existing = await this.findByProviderAccountAndMethod(
      input.providerAccountId,
      input.method,
    );
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

  async updateStatus(
    id: string,
    status: ProviderAccountPaymentMethodStatus,
  ): Promise<ProviderAccountPaymentMethod> {
    const record = this.store.get(id);
    if (!record) throw new Error(`Method not found: ${id}`);
    const updated: ProviderAccountPaymentMethod = { ...record, status, updatedAt: new Date() };
    this.store.set(id, updated);
    return updated;
  }

  clear() { this.store.clear(); }
}

// ════════════════════════════════════════════════════════════════════
// IN-MEMORY STUBS FOR OTHER REPOS
// ════════════════════════════════════════════════════════════════════

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
    listByMerchant: async (merchantId: string) =>
      [...store.values()].filter((p) => p.merchantId === merchantId),
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

// ════════════════════════════════════════════════════════════════════
// FIXTURE FACTORIES
// ════════════════════════════════════════════════════════════════════

function makeMid() { return `mer_s75_${randomUUID().slice(0, 8)}`; }
function makePaId() { return `pa_s75_${randomUUID().slice(0, 8)}`; }

function makeProviderAccount(opts: {
  merchantId: string; paId?: string; provider?: string;
}) {
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
  return {
    id: merchantId, name: 'Test Merchant', status: 'active',
    metadata: {}, createdAt: new Date(), updatedAt: new Date(),
  };
}

// ════════════════════════════════════════════════════════════════════
// A. UNIT TESTS (in-memory, no DB)
// ════════════════════════════════════════════════════════════════════

describe('S7.5: Payment Method Options', () => {
  // PM01 ───────────────────────────────────────────────────────────────────────
  test('PM01: syncs FakeGateway capabilities → 6 methods created', async () => {
    const merchantId = makeMid();
    const pa = makeProviderAccount({ merchantId, provider: 'fake_gateway' });
    const paRepo = makeProviderAccountRepo([pa]);
    const methodRepo = new InMemoryMethodRepo();
    const registry = createProviderRegistry('test', { xenditSandboxEnabled: false, xenditBaseUrl: undefined });

    const uc = new SyncProviderAccountMethods(paRepo as any, methodRepo, registry as any);
    const result = await uc.execute({ merchantId, providerAccountId: pa.id });

    assert.equal(result.syncedCount, 6);
    assert.equal(result.methods.length, 6);
    const names = result.methods.map((m) => m.method);
    assert.ok(names.includes('qris'), 'should include qris');
    assert.ok(names.includes('va_bca'), 'should include va_bca');
    assert.ok(names.includes('va_mandiri'), 'should include va_mandiri');
    assert.ok(names.includes('va_bni'), 'should include va_bni');
    assert.ok(names.includes('gopay'), 'should include gopay');
    assert.ok(names.includes('redirect'), 'should include redirect');
    assert.ok(result.methods.every((m) => m.status === 'active'), 'all should be active');
  });

  // PM02 ───────────────────────────────────────────────────────────────────────
  test('PM02: sync is idempotent — twice produces same methods', async () => {
    const merchantId = makeMid();
    const pa = makeProviderAccount({ merchantId, provider: 'fake_gateway' });
    const paRepo = makeProviderAccountRepo([pa]);
    const methodRepo = new InMemoryMethodRepo();
    const registry = createProviderRegistry('test', { xenditSandboxEnabled: false, xenditBaseUrl: undefined });

    const uc = new SyncProviderAccountMethods(paRepo as any, methodRepo, registry as any);
    const first = await uc.execute({ merchantId, providerAccountId: pa.id });
    const second = await uc.execute({ merchantId, providerAccountId: pa.id });

    assert.equal(second.syncedCount, 6);
    assert.equal(second.methods.length, first.methods.length);
    assert.ok(second.methods.every((m) => m.status === 'active'));
  });

  // PM03 ───────────────────────────────────────────────────────────────────────
  test('PM03: listByProviderAccount returns correct shape after sync', async () => {
    const merchantId = makeMid();
    const pa = makeProviderAccount({ merchantId, provider: 'fake_gateway' });
    const paRepo = makeProviderAccountRepo([pa]);
    const methodRepo = new InMemoryMethodRepo();
    const registry = createProviderRegistry('test', { xenditSandboxEnabled: false, xenditBaseUrl: undefined });

    const syncUC = new SyncProviderAccountMethods(paRepo as any, methodRepo, registry as any);
    await syncUC.execute({ merchantId, providerAccountId: pa.id });

    const listUC = new ListProviderAccountMethods(paRepo as any, methodRepo);
    const methods = await listUC.listByProviderAccount({ merchantId, providerAccountId: pa.id });

    assert.equal(methods.length, 6);
    for (const m of methods) {
      assert.equal(m.merchantId, merchantId);
      assert.equal(m.providerAccountId, pa.id);
      assert.equal(m.provider, 'fake_gateway');
      assert.equal(m.currency, 'IDR');
      assert.equal(typeof m.displayName, 'string');
    }
  });

  // PM04 ───────────────────────────────────────────────────────────────────────
  test('PM04: upsert creates new entry with created=true', async () => {
    const merchantId = makeMid();
    const pa = makeProviderAccount({ merchantId });
    const paRepo = makeProviderAccountRepo([pa]);
    const methodRepo = new InMemoryMethodRepo();

    const uc = new UpsertProviderAccountMethod(paRepo as any, methodRepo);
    const result = await uc.execute({
      merchantId, providerAccountId: pa.id, method: 'custom_method',
      methodType: 'other', displayName: 'Custom', status: 'active', currency: 'IDR',
    });

    assert.equal(result.created, true);
    assert.equal(result.method.method, 'custom_method');
    assert.equal(result.method.displayName, 'Custom');
    assert.equal(result.method.merchantId, merchantId);
  });

  // PM05 ───────────────────────────────────────────────────────────────────────
  test('PM05: upsert updates existing entry with created=false', async () => {
    const merchantId = makeMid();
    const pa = makeProviderAccount({ merchantId });
    const paRepo = makeProviderAccountRepo([pa]);
    const methodRepo = new InMemoryMethodRepo();

    const uc = new UpsertProviderAccountMethod(paRepo as any, methodRepo);
    const first = await uc.execute({
      merchantId, providerAccountId: pa.id, method: 'my_method',
      displayName: 'First Name', currency: 'IDR',
    });
    assert.equal(first.created, true);

    const second = await uc.execute({
      merchantId, providerAccountId: pa.id, method: 'my_method',
      displayName: 'Updated Name', currency: 'IDR',
    });
    assert.equal(second.created, false);
    assert.equal(second.method.displayName, 'Updated Name');
    assert.equal(second.method.id, first.method.id);
  });

  // PM06 ───────────────────────────────────────────────────────────────────────
  test('PM06: manually-disabled method preserved through re-sync', async () => {
    const merchantId = makeMid();
    const pa = makeProviderAccount({ merchantId, provider: 'fake_gateway' });
    const paRepo = makeProviderAccountRepo([pa]);
    const methodRepo = new InMemoryMethodRepo();
    const registry = createProviderRegistry('test', { xenditSandboxEnabled: false, xenditBaseUrl: undefined });

    const syncUC = new SyncProviderAccountMethods(paRepo as any, methodRepo, registry as any);
    const first = await syncUC.execute({ merchantId, providerAccountId: pa.id });

    const qris = first.methods.find((m) => m.method === 'qris');
    assert.ok(qris, 'qris method should exist');
    await methodRepo.updateStatus(qris!.id, 'disabled');

    const second = await syncUC.execute({ merchantId, providerAccountId: pa.id });
    const qrisAfterSync = second.methods.find((m) => m.method === 'qris');
    assert.equal(qrisAfterSync?.status, 'disabled', 'qris should remain disabled after re-sync');

    const vaBca = second.methods.find((m) => m.method === 'va_bca');
    assert.equal(vaBca?.status, 'active', 'other methods should remain active');
  });

  // PM07 ───────────────────────────────────────────────────────────────────────
  test('PM07: listByMerchant returns only active methods', async () => {
    const merchantId = makeMid();
    const pa = makeProviderAccount({ merchantId, provider: 'fake_gateway' });
    const paRepo = makeProviderAccountRepo([pa]);
    const methodRepo = new InMemoryMethodRepo();
    const registry = createProviderRegistry('test', { xenditSandboxEnabled: false, xenditBaseUrl: undefined });

    const syncUC = new SyncProviderAccountMethods(paRepo as any, methodRepo, registry as any);
    const synced = await syncUC.execute({ merchantId, providerAccountId: pa.id });

    const qris = synced.methods.find((m) => m.method === 'qris');
    assert.ok(qris);
    await methodRepo.updateStatus(qris!.id, 'disabled');

    const listUC = new ListProviderAccountMethods(paRepo as any, methodRepo);
    const active = await listUC.listByMerchant({ merchantId });

    assert.ok(active.every((m) => m.status === 'active'), 'all listed methods should be active');
    assert.equal(active.find((m) => m.method === 'qris'), undefined, 'disabled qris should not appear');
    assert.equal(active.length, 5);
  });

  // PM08 ───────────────────────────────────────────────────────────────────────
  test('PM08: getPaymentOptions filters by currency and returns matching options', async () => {
    const merchantId = makeMid();
    const pa = makeProviderAccount({ merchantId, provider: 'fake_gateway' });
    const paRepo = makeProviderAccountRepo([pa]);
    const methodRepo = new InMemoryMethodRepo();
    const registry = createProviderRegistry('test', { xenditSandboxEnabled: false, xenditBaseUrl: undefined });

    const syncUC = new SyncProviderAccountMethods(paRepo as any, methodRepo, registry as any);
    await syncUC.execute({ merchantId, providerAccountId: pa.id });

    const intent = makeIntent({ merchantId, currency: 'IDR', amountDue: 100_000 });
    const intentRepo = makeIntentRepo([intent]);

    const uc = new GetPaymentMethodOptions(intentRepo as any, methodRepo);
    const result = await uc.execute({ intentId: intent.id, merchantId });

    assert.equal(result.intentId, intent.id);
    assert.equal(result.currency, 'IDR');
    assert.ok(result.options.length > 0, 'should have options');
    assert.ok(result.options.every((o) => o.currency === 'IDR'), 'all options should be IDR');
  });

  // PM09 ───────────────────────────────────────────────────────────────────────
  test('PM09: methods with minAmount > intentAmount are excluded from options', async () => {
    const merchantId = makeMid();
    const pa = makeProviderAccount({ merchantId });
    const paRepo = makeProviderAccountRepo([pa]);
    const methodRepo = new InMemoryMethodRepo();

    const upsertUC = new UpsertProviderAccountMethod(paRepo as any, methodRepo);
    await upsertUC.execute({
      merchantId, providerAccountId: pa.id, method: 'high_min',
      displayName: 'High Min', status: 'active', currency: 'IDR',
      minAmount: 500_000, maxAmount: null,
    });

    const intent = makeIntent({ merchantId, currency: 'IDR', amountDue: 1_000 });
    const intentRepo = makeIntentRepo([intent]);
    const optUC = new GetPaymentMethodOptions(intentRepo as any, methodRepo);
    const result = await optUC.execute({ intentId: intent.id, merchantId });

    assert.equal(
      result.options.find((o) => o.method === 'high_min'),
      undefined,
      'high_min should be excluded because amount < minAmount',
    );
  });

  // PM10 ───────────────────────────────────────────────────────────────────────
  test('PM10: methods with maxAmount < intentAmount are excluded from options', async () => {
    const merchantId = makeMid();
    const pa = makeProviderAccount({ merchantId });
    const paRepo = makeProviderAccountRepo([pa]);
    const methodRepo = new InMemoryMethodRepo();

    const upsertUC = new UpsertProviderAccountMethod(paRepo as any, methodRepo);
    await upsertUC.execute({
      merchantId, providerAccountId: pa.id, method: 'low_max',
      displayName: 'Low Max', status: 'active', currency: 'IDR',
      minAmount: null, maxAmount: 50_000,
    });

    const intent = makeIntent({ merchantId, currency: 'IDR', amountDue: 200_000 });
    const intentRepo = makeIntentRepo([intent]);
    const optUC = new GetPaymentMethodOptions(intentRepo as any, methodRepo);
    const result = await optUC.execute({ intentId: intent.id, merchantId });

    assert.equal(
      result.options.find((o) => o.method === 'low_max'),
      undefined,
      'low_max should be excluded because amount > maxAmount',
    );
  });

  // ── PM11-PM15: CreateGatewayPayment method validation ─────────────────────

  describe('CreateGatewayPayment — method validation (S7.5)', () => {
    // PM11 ─────────────────────────────────────────────────────────────────────
    test('PM11: createGatewayPayment succeeds when method is registered and active', async () => {
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
      const txRepo = makeTxRepo();
      const idempotencyRepo = makeIdempotencyRepo();

      const uc = new CreateGatewayPayment(
        merchantRepo as any, intentRepo as any, txRepo as any,
        registry as any, paRepo as any, idempotencyRepo as any, 'test', methodRepo,
      );
      const result = await uc.execute({
        merchantId, intentId: intent.id, provider: 'fake_gateway',
        method: 'qris', amount: 100_000, providerAccountId: pa.id,
      });

      assert.ok(result.transaction, 'transaction should be defined');
      assert.equal(result.transaction.method, 'qris');
    });

    // PM12 ─────────────────────────────────────────────────────────────────────
    test('PM12: PAYMENT_METHOD_NOT_AVAILABLE when method not in DB', async () => {
      const merchantId = makeMid();
      const merchant = makeMerchant(merchantId);
      const pa = makeProviderAccount({ merchantId, provider: 'fake_gateway' });
      const paRepo = makeProviderAccountRepo([pa]);
      const methodRepo = new InMemoryMethodRepo();
      const registry = createProviderRegistry('test', { xenditSandboxEnabled: false, xenditBaseUrl: undefined });

      // Seed a different method so the PA has methods (triggers validation)
      const upsertUC = new UpsertProviderAccountMethod(paRepo as any, methodRepo);
      await upsertUC.execute({
        merchantId, providerAccountId: pa.id, method: 'cash',
        displayName: 'Cash', status: 'active', currency: 'IDR',
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
          method: 'nonexistent_method', amount: 100_000, providerAccountId: pa.id,
        }),
        (err: any) => {
          assert.equal(err.code, 'PAYMENT_METHOD_NOT_AVAILABLE');
          return true;
        },
      );
    });

    // PM13 ─────────────────────────────────────────────────────────────────────
    test('PM13: PAYMENT_METHOD_DISABLED when method status is disabled', async () => {
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

    // PM14 ─────────────────────────────────────────────────────────────────────
    test('PM14: PAYMENT_METHOD_AMOUNT_OUT_OF_RANGE when amount < minAmount', async () => {
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
        minAmount: 50_000, maxAmount: null,
      });

      const intent = makeIntent({ merchantId, currency: 'IDR', amountDue: 1_000 });
      const intentRepo = makeIntentRepo([intent]);
      const merchantRepo = makeMerchantRepo([merchant]);

      const uc = new CreateGatewayPayment(
        merchantRepo as any, intentRepo as any, makeTxRepo() as any,
        registry as any, paRepo as any, makeIdempotencyRepo() as any, 'test', methodRepo,
      );

      await assert.rejects(
        () => uc.execute({
          merchantId, intentId: intent.id, provider: 'fake_gateway',
          method: 'va_bca', amount: 1_000, providerAccountId: pa.id,
        }),
        (err: any) => {
          assert.equal(err.code, 'PAYMENT_METHOD_AMOUNT_OUT_OF_RANGE');
          return true;
        },
      );
    });

    // PM15 ─────────────────────────────────────────────────────────────────────
    test('PM15: PAYMENT_METHOD_CURRENCY_UNSUPPORTED when currency mismatch', async () => {
      const merchantId = makeMid();
      const merchant = makeMerchant(merchantId);
      const pa = makeProviderAccount({ merchantId, provider: 'fake_gateway' });
      const paRepo = makeProviderAccountRepo([pa]);
      const methodRepo = new InMemoryMethodRepo();
      const registry = createProviderRegistry('test', { xenditSandboxEnabled: false, xenditBaseUrl: undefined });

      const upsertUC = new UpsertProviderAccountMethod(paRepo as any, methodRepo);
      await upsertUC.execute({
        merchantId, providerAccountId: pa.id, method: 'qris',
        displayName: 'QRIS IDR only', status: 'active', currency: 'IDR',
      });

      const intent = makeIntent({ merchantId, currency: 'USD', amountDue: 100_000 });
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
          assert.equal(err.code, 'PAYMENT_METHOD_CURRENCY_UNSUPPORTED');
          return true;
        },
      );
    });
  });

  // PM16 ───────────────────────────────────────────────────────────────────────
  test('PM16: syncs Manual provider capabilities → 3 methods', async () => {
    const merchantId = makeMid();
    const pa = makeProviderAccount({ merchantId, provider: 'manual' });
    const paRepo = makeProviderAccountRepo([pa]);
    const methodRepo = new InMemoryMethodRepo();
    const registry = createProviderRegistry('test', { xenditSandboxEnabled: false, xenditBaseUrl: undefined });

    const uc = new SyncProviderAccountMethods(paRepo as any, methodRepo, registry as any);
    const result = await uc.execute({ merchantId, providerAccountId: pa.id });

    assert.equal(result.syncedCount, 3);
    const names = result.methods.map((m) => m.method);
    assert.ok(names.includes('cash'), 'should include cash');
    assert.ok(names.includes('bank_transfer'), 'should include bank_transfer');
    assert.ok(names.includes('manual'), 'should include manual');
  });

  // PM17 ───────────────────────────────────────────────────────────────────────
  test('PM17: sync with provider having no supportedMethods → graceful no-op', async () => {
    const merchantId = makeMid();
    const pa = makeProviderAccount({ merchantId, provider: 'nocap_provider' });
    const paRepo = makeProviderAccountRepo([pa]);
    const methodRepo = new InMemoryMethodRepo();

    const noCapProvider = {
      providerCode: 'nocap_provider',
      capabilities: {
        supportsRefund: false, supportsCancel: false, supportsPolling: false,
        supportsWebhook: false, supportedMethods: [], supportsRedirect: false, supportsQr: false,
      },
      createPayment: async () => ({
        status: 'failed', providerReference: null,
        rawProviderResponse: {}, failureReason: 'not implemented',
      }),
    };
    const stubRegistry = {
      get: (code: string) => code === 'nocap_provider' ? noCapProvider : null,
      list: () => [noCapProvider],
    };

    const uc = new SyncProviderAccountMethods(paRepo as any, methodRepo, stubRegistry as any);
    const result = await uc.execute({ merchantId, providerAccountId: pa.id });

    assert.equal(result.syncedCount, 0);
    assert.equal(result.methods.length, 0);
    assert.ok(result.message?.includes('No capabilities') ?? result.syncedCount === 0);
  });

  // PM18 ───────────────────────────────────────────────────────────────────────
  test('PM18: listByProviderAccount returns [] before any sync', async () => {
    const merchantId = makeMid();
    const pa = makeProviderAccount({ merchantId });
    const paRepo = makeProviderAccountRepo([pa]);
    const methodRepo = new InMemoryMethodRepo();

    const listUC = new ListProviderAccountMethods(paRepo as any, methodRepo);
    const methods = await listUC.listByProviderAccount({ merchantId, providerAccountId: pa.id });
    assert.equal(methods.length, 0);
  });
});

// ════════════════════════════════════════════════════════════════════
// B. DB INTEGRATION TESTS (real DB)
// ════════════════════════════════════════════════════════════════════

const dbUrl = process.env['PAYMENT_ORCHESTRATION_DATABASE_URL'] ?? process.env['DATABASE_URL'];

if (dbUrl) {
  describe('S7.5: DrizzleProviderAccountMethodRepository (real DB)', () => {
    async function seedMerchantAndPa(db: any, merchantId: string, paId: string) {
      const { DrizzlePaymentMerchantRepository } = await import(
        '../apps/service/src/infrastructure/repositories/DrizzlePaymentMerchantRepository.ts'
      );
      const { DrizzlePaymentProviderAccountRepository } = await import(
        '../apps/service/src/infrastructure/repositories/DrizzlePaymentProviderAccountRepository.ts'
      );
      const merchantRepo = new DrizzlePaymentMerchantRepository(db);
      const paRepo = new DrizzlePaymentProviderAccountRepository(db);

      await merchantRepo.create({
        id: merchantId,
        name: `S7.5 DB Test Merchant ${merchantId}`,
        status: 'active',
        metadata: {},
      });
      await paRepo.create({
        id: paId,
        merchantId,
        provider: 'fake_gateway',
        environment: 'test',
        providerAccountRef: 'ref_s75_db_test',
        credentialsRef: null,
        status: 'active',
        publicConfig: {},
        metadata: {},
      });
    }

    // PM-DB01 ────────────────────────────────────────────────────────────────
    test('PM-DB01: upsert creates a method and findById retrieves it', async () => {
      const { createPoDb } = await import('../apps/service/src/infrastructure/db.ts');
      const { DrizzleProviderAccountMethodRepository } = await import(
        '../apps/service/src/infrastructure/repositories/DrizzleProviderAccountMethodRepository.ts'
      );
      const db = createPoDb(dbUrl!);
      const repo = new DrizzleProviderAccountMethodRepository(db);
      const merchantId = makeMid();
      const paId = makePaId();
      await seedMerchantAndPa(db, merchantId, paId);

      const id = `pam_${randomUUID()}`;
      const methodName = `qris_db_${randomUUID().slice(0, 6)}`;
      const method = await repo.upsert({
        id, merchantId, providerAccountId: paId,
        provider: 'fake_gateway', method: methodName,
        methodType: 'qris', displayName: 'QRIS DB Test',
        status: 'active', currency: 'IDR',
        minAmount: 1000, maxAmount: 5_000_000, sortOrder: 0,
        publicConfig: {}, providerMetadata: {}, metadata: {},
      });

      assert.equal(method.id, id);
      assert.equal(method.status, 'active');
      assert.equal(method.merchantId, merchantId);

      const found = await repo.findById(id);
      assert.ok(found !== null, 'findById should return the created method');
      assert.equal(found!.id, id);
      assert.equal(found!.minAmount, 1000);
    });

    // PM-DB02 ────────────────────────────────────────────────────────────────
    test('PM-DB02: listByProviderAccount returns all methods for a PA', async () => {
      const { createPoDb } = await import('../apps/service/src/infrastructure/db.ts');
      const { DrizzleProviderAccountMethodRepository } = await import(
        '../apps/service/src/infrastructure/repositories/DrizzleProviderAccountMethodRepository.ts'
      );
      const db = createPoDb(dbUrl!);
      const repo = new DrizzleProviderAccountMethodRepository(db);
      const merchantId = makeMid();
      const paId = makePaId();
      await seedMerchantAndPa(db, merchantId, paId);

      const methodNames = [
        `va_bca_db_${randomUUID().slice(0, 4)}`,
        `va_mandiri_db_${randomUUID().slice(0, 4)}`,
        `gopay_db_${randomUUID().slice(0, 4)}`,
      ];
      for (const m of methodNames) {
        await repo.upsert({
          id: `pam_${randomUUID()}`, merchantId, providerAccountId: paId,
          provider: 'fake_gateway', method: m,
          methodType: 'virtual_account', displayName: m,
          status: 'active', currency: 'IDR',
          minAmount: null, maxAmount: null, sortOrder: 0,
          publicConfig: {}, providerMetadata: {}, metadata: {},
        });
      }

      const found = await repo.listByProviderAccount(paId);
      const foundNames = found.map((m: any) => m.method);
      for (const m of methodNames) {
        assert.ok(foundNames.includes(m), `should include ${m}`);
      }
    });

    // PM-DB03 ────────────────────────────────────────────────────────────────
    test('PM-DB03: updateStatus changes status in DB', async () => {
      const { createPoDb } = await import('../apps/service/src/infrastructure/db.ts');
      const { DrizzleProviderAccountMethodRepository } = await import(
        '../apps/service/src/infrastructure/repositories/DrizzleProviderAccountMethodRepository.ts'
      );
      const db = createPoDb(dbUrl!);
      const repo = new DrizzleProviderAccountMethodRepository(db);
      const merchantId = makeMid();
      const paId = makePaId();
      await seedMerchantAndPa(db, merchantId, paId);

      const id = `pam_${randomUUID()}`;
      await repo.upsert({
        id, merchantId, providerAccountId: paId,
        provider: 'fake_gateway', method: `status_test_${randomUUID().slice(0, 6)}`,
        methodType: 'qris', displayName: 'Status Test',
        status: 'active', currency: 'IDR',
        minAmount: null, maxAmount: null, sortOrder: 0,
        publicConfig: {}, providerMetadata: {}, metadata: {},
      });

      await repo.updateStatus(id, 'disabled');
      const found = await repo.findById(id);
      assert.equal(found!.status, 'disabled');
    });

    // PM-DB04 ────────────────────────────────────────────────────────────────
    test('PM-DB04: upsert ON CONFLICT is idempotent — same method upserted twice returns one row', async () => {
      const { createPoDb } = await import('../apps/service/src/infrastructure/db.ts');
      const { DrizzleProviderAccountMethodRepository } = await import(
        '../apps/service/src/infrastructure/repositories/DrizzleProviderAccountMethodRepository.ts'
      );
      const db = createPoDb(dbUrl!);
      const repo = new DrizzleProviderAccountMethodRepository(db);
      const merchantId = makeMid();
      const paId = makePaId();
      await seedMerchantAndPa(db, merchantId, paId);

      const method = `idempotent_${randomUUID().slice(0, 6)}`;
      const firstId = `pam_${randomUUID()}`;

      const first = await repo.upsert({
        id: firstId, merchantId, providerAccountId: paId,
        provider: 'fake_gateway', method,
        methodType: 'qris', displayName: 'First',
        status: 'active', currency: 'IDR',
        minAmount: 1000, maxAmount: 5_000_000, sortOrder: 0,
        publicConfig: {}, providerMetadata: {}, metadata: {},
      });

      const second = await repo.upsert({
        id: `pam_${randomUUID()}`, // different id — ON CONFLICT on (providerAccountId, method)
        merchantId, providerAccountId: paId,
        provider: 'fake_gateway', method,
        methodType: 'qris', displayName: 'Second (updated)',
        status: 'active', currency: 'IDR',
        minAmount: 2000, maxAmount: 8_000_000, sortOrder: 1,
        publicConfig: {}, providerMetadata: {}, metadata: {},
      });

      assert.equal(second.id, first.id, 'ON CONFLICT should return same row id');
      assert.equal(second.displayName, 'Second (updated)');
      assert.equal(second.minAmount, 2000);

      const all = await repo.listByProviderAccount(paId);
      const matching = all.filter((m: any) => m.method === method);
      assert.equal(matching.length, 1, 'only one row should exist for this (PA, method) pair');
    });
  });
}
