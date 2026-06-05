/**
 * payment-orchestration-schema-mappers.test.ts
 *
 * Unit tests for Phase 8C DB row → core DTO mappers.
 *
 * No live DB required. Tests verify:
 * 1. Merchant row maps to PaymentMerchant with id/displayName correctly.
 * 2. Provider account row maps without exposing raw credentials.
 * 3. Intent row maps all external refs (sourceApp, externalTenantId, externalOutletId,
 *    externalLocationId, externalPayableType, externalPayableId).
 * 4. Transaction row maps provider refs/action fields safely.
 * 5. Provider event row supports nullable merchantId before resolution.
 * 6. Idempotency key row maps status/resource snapshot correctly.
 * 7. No mapper output includes AuraPoS tenantId field.
 *
 * Test runner: npx tsx --tsconfig apps/api/tsconfig.node.json --test <this file>
 *
 * Note: Tests run under apps/api tsconfig (not service tsconfig) because the
 * payment-orchestration-service tsconfig uses moduleResolution=NodeNext without
 * workspace path aliases — the API tsconfig has all aliases pre-configured.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  mapMerchantRow,
  mapProviderAccountRow,
  mapIntentRow,
  mapTransactionRow,
  mapProviderEventRow,
  mapIdempotencyKeyRow,
} from '../apps/service/src/infrastructure/repositories/mappers.ts';

import type {
  MerchantRow,
  ProviderAccountRow,
  IntentRow,
  TransactionRow,
  ProviderEventRow,
  IdempotencyKeyRow,
} from '../apps/service/src/infrastructure/repositories/mappers.ts';

// ── Shared test fixtures ───────────────────────────────────────────────────────

const NOW = new Date('2026-06-05T00:00:00Z');

const BASE_MERCHANT_ROW: MerchantRow = {
  id: 'merchant-aurapos-demo',
  externalRef: 'aurapos-tenant-demo',
  sourceApp: 'aurapos',
  name: 'Demo Coffee Shop',
  legalName: 'PT Demo Kopi Indonesia',
  status: 'active',
  metadata: { region: 'id' },
  createdAt: NOW,
  updatedAt: NOW,
};

const BASE_PROVIDER_ACCOUNT_ROW: ProviderAccountRow = {
  id: 'pa-xendit-sandbox-001',
  merchantId: 'merchant-aurapos-demo',
  provider: 'xendit_sandbox',
  providerAccountRef: 'xnd-sub-abc',
  environment: 'sandbox',
  status: 'active',
  credentialsRef: 'replit://secrets/XENDIT_SANDBOX_SECRET_KEY',
  publicConfig: { callbackUrl: 'https://example.com/webhooks/xendit' },
  metadata: {},
  createdAt: NOW,
  updatedAt: NOW,
};

const BASE_INTENT_ROW: IntentRow = {
  id: 'intent-001',
  merchantId: 'merchant-aurapos-demo',
  providerAccountId: 'pa-xendit-sandbox-001',
  sourceApp: 'aurapos',
  externalTenantId: 'tenant-abc',
  externalOutletId: 'outlet-main',
  externalLocationId: 'location-floor1',
  externalPayableType: 'order',
  externalPayableId: 'order-xyz',
  amountDue: 55000,
  amountPaid: 0,
  amountRefunded: 0,
  amountRemaining: 55000,
  currency: 'IDR',
  status: 'requires_payment',
  allowPartial: false,
  expiresAt: null,
  metadata: { tableNumber: '5' },
  createdAt: NOW,
  updatedAt: NOW,
};

const BASE_TRANSACTION_ROW: TransactionRow = {
  id: 'txn-001',
  merchantId: 'merchant-aurapos-demo',
  intentId: 'intent-001',
  providerAccountId: 'pa-xendit-sandbox-001',
  provider: 'xendit_sandbox',
  method: 'qris',
  transactionType: 'payment',
  status: 'requires_action',
  direction: 'incoming',
  amount: 55000,
  currency: 'IDR',
  parentTransactionId: null,
  providerReference: 'xnd-ewc-abc123',
  providerEventId: null,
  providerPaymentUrl: null,
  providerQrString: 'qr://xnd-abc',
  failureReason: null,
  idempotencyKey: 'idem-key-001',
  expiresAt: null,
  metadata: {},
  rawProviderResponse: { id: 'xnd-ewc-abc123', status: 'ACTIVE' },
  createdAt: NOW,
  updatedAt: NOW,
};

const BASE_PROVIDER_EVENT_ROW: ProviderEventRow = {
  id: 'evt-001',
  merchantId: null,
  provider: 'xendit_sandbox',
  providerEventId: 'xnd-evt-001',
  providerReference: 'xnd-ewc-abc123',
  eventType: 'ewc.payment.succeeded',
  processingStatus: 'pending',
  processingAttempts: 0,
  lastError: null,
  rawHeaders: { 'x-callback-token': 'redacted' },
  rawBody: { id: 'xnd-ewc-abc123', status: 'PAID' },
  parsedPayload: null,
  receivedAt: NOW,
  processedAt: null,
  createdAt: NOW,
  updatedAt: NOW,
};

const BASE_IDEMPOTENCY_ROW: IdempotencyKeyRow = {
  id: 'idmp-001',
  merchantId: 'merchant-aurapos-demo',
  scope: 'create_payment',
  idempotencyKey: 'idem-key-001',
  requestHash: 'sha256-abcdef',
  responseSnapshot: { transactionId: 'txn-001', status: 'requires_action' },
  resourceType: 'transaction',
  resourceId: 'txn-001',
  status: 'completed',
  createdAt: NOW,
  updatedAt: NOW,
  expiresAt: new Date('2026-06-06T00:00:00Z'),
};

// ── Test 1: Merchant row → PaymentMerchant ────────────────────────────────────

describe('mapMerchantRow', () => {
  it('maps id and displayName correctly', () => {
    const merchant = mapMerchantRow(BASE_MERCHANT_ROW);
    assert.equal(merchant.id, 'merchant-aurapos-demo');
    assert.equal(merchant.displayName, 'Demo Coffee Shop');
  });

  it('maps legalName correctly', () => {
    const merchant = mapMerchantRow(BASE_MERCHANT_ROW);
    assert.equal(merchant.legalName, 'PT Demo Kopi Indonesia');
  });

  it('maps status correctly', () => {
    const merchant = mapMerchantRow(BASE_MERCHANT_ROW);
    assert.equal(merchant.status, 'active');
  });

  it('maps metadata correctly', () => {
    const merchant = mapMerchantRow(BASE_MERCHANT_ROW);
    assert.deepEqual(merchant.metadata, { region: 'id' });
  });

  it('defaults metadata to {} when row metadata is null', () => {
    const row: MerchantRow = { ...BASE_MERCHANT_ROW, metadata: null };
    const merchant = mapMerchantRow(row);
    assert.deepEqual(merchant.metadata, {});
  });

  it('does NOT include tenantId in output', () => {
    const merchant = mapMerchantRow(BASE_MERCHANT_ROW) as unknown as Record<string, unknown>;
    assert.equal('tenantId' in merchant, false);
  });
});

// ── Test 2: Provider account row — no raw credentials ─────────────────────────

describe('mapProviderAccountRow', () => {
  it('maps id and merchantId correctly', () => {
    const account = mapProviderAccountRow(BASE_PROVIDER_ACCOUNT_ROW);
    assert.equal(account.id, 'pa-xendit-sandbox-001');
    assert.equal(account.merchantId, 'merchant-aurapos-demo');
  });

  it('preserves credentialsRef as opaque string (not null)', () => {
    const account = mapProviderAccountRow(BASE_PROVIDER_ACCOUNT_ROW);
    // credentialsRef is preserved — callers must not expose this externally
    assert.equal(account.credentialsRef, 'replit://secrets/XENDIT_SANDBOX_SECRET_KEY');
  });

  it('does not expose a raw_secret or api_key field', () => {
    const account = mapProviderAccountRow(BASE_PROVIDER_ACCOUNT_ROW) as unknown as Record<string, unknown>;
    assert.equal('rawSecret' in account, false);
    assert.equal('apiKey' in account, false);
    assert.equal('secretKey' in account, false);
  });

  it('maps publicConfig correctly', () => {
    const account = mapProviderAccountRow(BASE_PROVIDER_ACCOUNT_ROW);
    assert.deepEqual(account.publicConfig, {
      callbackUrl: 'https://example.com/webhooks/xendit',
    });
  });

  it('maps environment correctly', () => {
    const account = mapProviderAccountRow(BASE_PROVIDER_ACCOUNT_ROW);
    assert.equal(account.environment, 'sandbox');
  });

  it('does NOT include tenantId in output', () => {
    const account = mapProviderAccountRow(BASE_PROVIDER_ACCOUNT_ROW) as unknown as Record<string, unknown>;
    assert.equal('tenantId' in account, false);
  });
});

// ── Test 3: Intent row — external refs mapping ────────────────────────────────

describe('mapIntentRow', () => {
  it('maps merchantId correctly', () => {
    const intent = mapIntentRow(BASE_INTENT_ROW);
    assert.equal(intent.merchantId, 'merchant-aurapos-demo');
  });

  it('maps sourceApp correctly', () => {
    const intent = mapIntentRow(BASE_INTENT_ROW);
    assert.equal(intent.sourceApp, 'aurapos');
  });

  it('maps externalTenantId correctly', () => {
    const intent = mapIntentRow(BASE_INTENT_ROW);
    assert.equal(intent.externalTenantId, 'tenant-abc');
  });

  it('maps externalOutletId correctly', () => {
    const intent = mapIntentRow(BASE_INTENT_ROW);
    assert.equal(intent.externalOutletId, 'outlet-main');
  });

  it('maps externalLocationId correctly', () => {
    const intent = mapIntentRow(BASE_INTENT_ROW);
    assert.equal(intent.externalLocationId, 'location-floor1');
  });

  it('maps externalPayableType correctly', () => {
    const intent = mapIntentRow(BASE_INTENT_ROW);
    assert.equal(intent.externalPayableType, 'order');
  });

  it('maps externalPayableId correctly', () => {
    const intent = mapIntentRow(BASE_INTENT_ROW);
    assert.equal(intent.externalPayableId, 'order-xyz');
  });

  it('maps amount fields correctly', () => {
    const intent = mapIntentRow(BASE_INTENT_ROW);
    assert.equal(intent.amountDue, 55000);
    assert.equal(intent.amountPaid, 0);
    assert.equal(intent.amountRefunded, 0);
    assert.equal(intent.amountRemaining, 55000);
  });

  it('maps status correctly', () => {
    const intent = mapIntentRow(BASE_INTENT_ROW);
    assert.equal(intent.status, 'requires_payment');
  });

  it('does NOT include tenantId in output', () => {
    const intent = mapIntentRow(BASE_INTENT_ROW) as unknown as Record<string, unknown>;
    assert.equal('tenantId' in intent, false);
  });

  it('maps nullable externalLocationId as null when row field is null', () => {
    const row: IntentRow = { ...BASE_INTENT_ROW, externalLocationId: null };
    const intent = mapIntentRow(row);
    assert.equal(intent.externalLocationId, null);
  });
});

// ── Test 4: Transaction row — provider refs/action fields mapping ──────────────

describe('mapTransactionRow', () => {
  it('maps intentId (not paymentIntentId) correctly', () => {
    const txn = mapTransactionRow(BASE_TRANSACTION_ROW);
    assert.equal(txn.intentId, 'intent-001');
  });

  it('maps direction correctly', () => {
    const txn = mapTransactionRow(BASE_TRANSACTION_ROW);
    assert.equal(txn.direction, 'incoming');
  });

  it('maps transactionType correctly', () => {
    const txn = mapTransactionRow(BASE_TRANSACTION_ROW);
    assert.equal(txn.transactionType, 'payment');
  });

  it('maps providerReference safely', () => {
    const txn = mapTransactionRow(BASE_TRANSACTION_ROW);
    assert.equal(txn.providerReference, 'xnd-ewc-abc123');
  });

  it('maps providerQrString safely', () => {
    const txn = mapTransactionRow(BASE_TRANSACTION_ROW);
    assert.equal(txn.providerQrString, 'qr://xnd-abc');
  });

  it('maps providerPaymentUrl safely as null', () => {
    const txn = mapTransactionRow(BASE_TRANSACTION_ROW);
    assert.equal(txn.providerPaymentUrl, null);
  });

  it('maps rawProviderResponse through (internal use only)', () => {
    const txn = mapTransactionRow(BASE_TRANSACTION_ROW);
    assert.deepEqual(txn.rawProviderResponse, { id: 'xnd-ewc-abc123', status: 'ACTIVE' });
  });

  it('maps null parentTransactionId correctly', () => {
    const txn = mapTransactionRow(BASE_TRANSACTION_ROW);
    assert.equal(txn.parentTransactionId, null);
  });

  it('does NOT include tenantId in output', () => {
    const txn = mapTransactionRow(BASE_TRANSACTION_ROW) as unknown as Record<string, unknown>;
    assert.equal('tenantId' in txn, false);
  });

  it('maps refund transaction with outgoing direction', () => {
    const refundRow: TransactionRow = {
      ...BASE_TRANSACTION_ROW,
      id: 'txn-refund-001',
      transactionType: 'refund',
      direction: 'outgoing',
      parentTransactionId: 'txn-001',
      amount: 10000,
    };
    const txn = mapTransactionRow(refundRow);
    assert.equal(txn.direction, 'outgoing');
    assert.equal(txn.transactionType, 'refund');
    assert.equal(txn.parentTransactionId, 'txn-001');
  });
});

// ── Test 5: Provider event — nullable merchantId before resolution ─────────────

describe('mapProviderEventRow', () => {
  it('supports null merchantId before merchant resolution', () => {
    const event = mapProviderEventRow(BASE_PROVIDER_EVENT_ROW);
    assert.equal(event.merchantId, null);
  });

  it('supports non-null merchantId after resolution', () => {
    const resolvedRow: ProviderEventRow = {
      ...BASE_PROVIDER_EVENT_ROW,
      merchantId: 'merchant-aurapos-demo',
    };
    const event = mapProviderEventRow(resolvedRow);
    assert.equal(event.merchantId, 'merchant-aurapos-demo');
  });

  it('maps providerEventId correctly', () => {
    const event = mapProviderEventRow(BASE_PROVIDER_EVENT_ROW);
    assert.equal(event.providerEventId, 'xnd-evt-001');
  });

  it('maps processingStatus correctly', () => {
    const event = mapProviderEventRow(BASE_PROVIDER_EVENT_ROW);
    assert.equal(event.processingStatus, 'pending');
  });

  it('maps processingAttempts correctly', () => {
    const event = mapProviderEventRow(BASE_PROVIDER_EVENT_ROW);
    assert.equal(event.processingAttempts, 0);
  });

  it('maps rawHeaders correctly', () => {
    const event = mapProviderEventRow(BASE_PROVIDER_EVENT_ROW);
    assert.deepEqual(event.rawHeaders, { 'x-callback-token': 'redacted' });
  });

  it('maps null parsedPayload correctly', () => {
    const event = mapProviderEventRow(BASE_PROVIDER_EVENT_ROW);
    assert.equal(event.parsedPayload, null);
  });

  it('maps null processedAt correctly', () => {
    const event = mapProviderEventRow(BASE_PROVIDER_EVENT_ROW);
    assert.equal(event.processedAt, null);
  });

  it('does NOT include tenantId in output', () => {
    const event = mapProviderEventRow(BASE_PROVIDER_EVENT_ROW) as unknown as Record<string, unknown>;
    assert.equal('tenantId' in event, false);
  });
});

// ── Test 6: Idempotency key — status/resource snapshot mapping ─────────────────

describe('mapIdempotencyKeyRow', () => {
  it('maps merchantId correctly', () => {
    const key = mapIdempotencyKeyRow(BASE_IDEMPOTENCY_ROW);
    assert.equal(key.merchantId, 'merchant-aurapos-demo');
  });

  it('maps scope correctly', () => {
    const key = mapIdempotencyKeyRow(BASE_IDEMPOTENCY_ROW);
    assert.equal(key.scope, 'create_payment');
  });

  it('maps status correctly', () => {
    const key = mapIdempotencyKeyRow(BASE_IDEMPOTENCY_ROW);
    assert.equal(key.status, 'completed');
  });

  it('maps responseSnapshot correctly', () => {
    const key = mapIdempotencyKeyRow(BASE_IDEMPOTENCY_ROW);
    assert.deepEqual(key.responseSnapshot, {
      transactionId: 'txn-001',
      status: 'requires_action',
    });
  });

  it('maps resourceType and resourceId correctly', () => {
    const key = mapIdempotencyKeyRow(BASE_IDEMPOTENCY_ROW);
    assert.equal(key.resourceType, 'transaction');
    assert.equal(key.resourceId, 'txn-001');
  });

  it('maps expiresAt correctly', () => {
    const key = mapIdempotencyKeyRow(BASE_IDEMPOTENCY_ROW);
    assert.ok(key.expiresAt instanceof Date);
  });

  it('maps null responseSnapshot for processing status', () => {
    const row: IdempotencyKeyRow = {
      ...BASE_IDEMPOTENCY_ROW,
      status: 'processing',
      responseSnapshot: null,
      resourceType: null,
      resourceId: null,
    };
    const key = mapIdempotencyKeyRow(row);
    assert.equal(key.status, 'processing');
    assert.equal(key.responseSnapshot, null);
    assert.equal(key.resourceType, null);
    assert.equal(key.resourceId, null);
  });

  it('does NOT include tenantId in output', () => {
    const key = mapIdempotencyKeyRow(BASE_IDEMPOTENCY_ROW) as unknown as Record<string, unknown>;
    assert.equal('tenantId' in key, false);
  });
});

// ── Test 7: No mapper output includes AuraPoS tenantId field ─────────────────

describe('No tenantId in any mapper output', () => {
  it('merchant mapper output has no tenantId', () => {
    const result = mapMerchantRow(BASE_MERCHANT_ROW) as unknown as Record<string, unknown>;
    assert.equal('tenantId' in result, false);
  });

  it('provider account mapper output has no tenantId', () => {
    const result = mapProviderAccountRow(BASE_PROVIDER_ACCOUNT_ROW) as unknown as Record<string, unknown>;
    assert.equal('tenantId' in result, false);
  });

  it('intent mapper output has no tenantId', () => {
    const result = mapIntentRow(BASE_INTENT_ROW) as unknown as Record<string, unknown>;
    assert.equal('tenantId' in result, false);
  });

  it('transaction mapper output has no tenantId', () => {
    const result = mapTransactionRow(BASE_TRANSACTION_ROW) as unknown as Record<string, unknown>;
    assert.equal('tenantId' in result, false);
  });

  it('provider event mapper output has no tenantId', () => {
    const result = mapProviderEventRow(BASE_PROVIDER_EVENT_ROW) as unknown as Record<string, unknown>;
    assert.equal('tenantId' in result, false);
  });

  it('idempotency key mapper output has no tenantId', () => {
    const result = mapIdempotencyKeyRow(BASE_IDEMPOTENCY_ROW) as unknown as Record<string, unknown>;
    assert.equal('tenantId' in result, false);
  });
});
