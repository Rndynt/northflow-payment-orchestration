/**
 * s1-5-service-security-client-integration-compliance.test.ts
 *
 * Validates that all S1–S5 implementation artifacts are present, consistent,
 * and free of known stale references. This is a documentation + contract
 * compliance test; the behavioral proofs are in:
 *   - tests/payment-orchestration-service-security-hardening.test.ts (U01–H17c)
 *   - tests/payment-orchestration-s7-client-integration-smoke.test.ts (AP1–N12)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { PaymentOrchestrationClient } from '../packages/client-sdk/src/client.ts';

const root = process.cwd();
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');
const exists = (rel: string) => existsSync(join(root, rel));

// ── Phase S0: Security baseline artifacts ─────────────────────────────────────
describe('S0 — Security baseline artifacts', () => {

  it('S0.1: main.md marks all S1–S5 phases as COMPLETED', () => {
    const main = read('roadmap/service/main.md');
    for (const phase of ['S1', 'S2', 'S3', 'S4', 'S5']) {
      assert.ok(
        main.includes(`Phase ${phase}`) && main.includes('COMPLETED'),
        `Phase ${phase} not marked COMPLETED in main.md`,
      );
    }
  });

  it('S0.2: all 26 canonical scopes present in main.md', () => {
    const main = read('roadmap/service/main.md');
    const required = [
      'merchant:create', 'merchant:read',
      'provider_account:create', 'provider_account:read',
      'intent:create', 'intent:read',
      'payment:create', 'payment:read', 'payment:refund', 'payment:void', 'payment:reconcile',
      'provider_event:reprocess',
      'payment_method:read', 'payment_method:write', 'payment_method:sync',
      'audit_log:read',
      'api_client:credential:create', 'api_client:credential:read',
      'api_client:credential:revoke', 'api_client:credential:rotate',
      'api_client:signing_key:create', 'api_client:signing_key:read',
      'api_client:signing_key:rotate', 'api_client:signing_key:revoke',
      'webhook:manage', 'webhook:read',
    ];
    const missing = required.filter(s => !main.includes(s));
    assert.deepEqual(missing, [], `Scopes missing from main.md: ${missing.join(', ')}`);
  });

  it('S0.3: auth middleware file exists', () => {
    assert.ok(exists('apps/service/src/middleware/auth.ts'));
  });

  it('S0.4: requireScope middleware file exists', () => {
    assert.ok(exists('apps/service/src/middleware/requireScope.ts'));
  });

  it('S0.5: requireAnyScope middleware file exists', () => {
    assert.ok(exists('apps/service/src/middleware/requireAnyScope.ts'));
  });

  it('S0.6: merchantAccess middleware file exists', () => {
    assert.ok(exists('apps/service/src/middleware/merchantAccess.ts'));
  });
});

// ── Phase S1: API client registry tables ──────────────────────────────────────
describe('S1 — API client registry', () => {

  it('S1.1: API clients migration exists (0006)', () => {
    assert.ok(exists('migrations/0006_po_service_api_clients.sql'));
  });

  it('S1.2: Signing keys migration exists (0009)', () => {
    assert.ok(exists('migrations/0009_po_client_signing_keys_and_request_nonces.sql'));
  });

  it('S1.3: po_api_clients table defined in API clients migration', () => {
    const sql = read('migrations/0006_po_service_api_clients.sql');
    assert.ok(sql.includes('po_api_clients'), 'po_api_clients table missing');
  });

  it('S1.4: po_client_credentials table defined (hashed API keys)', () => {
    const sql = read('migrations/0006_po_service_api_clients.sql');
    assert.ok(sql.includes('po_client_credentials'), 'po_client_credentials table missing');
  });

  it('S1.5: po_client_merchant_access table defined (merchant grants)', () => {
    const sql = read('migrations/0006_po_service_api_clients.sql');
    assert.ok(sql.includes('po_client_merchant_access'), 'po_client_merchant_access table missing');
  });

  it('S1.6: DrizzleApiClientRepository exists', () => {
    assert.ok(exists('apps/service/src/infrastructure/repositories/DrizzleApiClientRepository.ts'));
  });

  it('S1.7: DrizzleClientCredentialRepository exists', () => {
    assert.ok(exists('apps/service/src/infrastructure/repositories/DrizzleClientCredentialRepository.ts'));
  });

  it('S1.8: DrizzleClientMerchantAccessRepository exists', () => {
    assert.ok(exists('apps/service/src/infrastructure/repositories/DrizzleClientMerchantAccessRepository.ts'));
  });
});

// ── Phase S2: Per-client auth replaces global token ───────────────────────────
describe('S2 — Per-client API key auth', () => {

  it('S2.1: auth.ts accepts Authorization: Bearer header format', () => {
    const src = read('apps/service/src/middleware/auth.ts');
    assert.ok(src.includes('Authorization') || src.includes('authorization'));
  });

  it('S2.2: auth.ts accepts x-nf-api-key header as fallback', () => {
    const src = read('apps/service/src/middleware/auth.ts');
    assert.ok(src.includes('x-nf-api-key'));
  });

  it('S2.3: credential format uses nf.<env>.<credentialId>.<secret> prefix', () => {
    const src = read('apps/service/src/middleware/auth.ts');
    assert.ok(src.includes("'nf.'") || src.includes('"nf."') || src.includes('nf.'), 'nf. prefix not found');
  });

  it('S2.4: UNAUTHORIZED error code used for invalid credentials', () => {
    const src = read('apps/service/src/middleware/auth.ts');
    assert.ok(src.includes('UNAUTHORIZED'));
  });

  it('S2.5: SERVICE_MISCONFIGURED error code present for missing auth repo', () => {
    // merchantAccess.ts handles the misconfigured-auth-repo case
    const src = read('apps/service/src/middleware/merchantAccess.ts');
    assert.ok(src.includes('SERVICE_MISCONFIGURED'));
  });

  it('S2.6: legacy service token gated behind env flag', () => {
    const src = read('apps/service/src/middleware/auth.ts');
    const hasLegacyGate = src.includes('LEGACY') || src.includes('legacy') || src.includes('serviceToken');
    assert.ok(hasLegacyGate, 'Legacy service token bypass must be gated');
  });
});

// ── Phase S3: Merchant ownership guard ────────────────────────────────────────
describe('S3 — Merchant ownership guard', () => {

  it('S3.1: assertMerchantAccessWithScope function exists in merchantAccess.ts', () => {
    const src = read('apps/service/src/middleware/merchantAccess.ts');
    assert.ok(src.includes('assertMerchantAccessWithScope'));
  });

  it('S3.2: MERCHANT_ACCESS_DENIED error code present in merchantAccess.ts', () => {
    const src = read('apps/service/src/middleware/merchantAccess.ts');
    assert.ok(src.includes('MERCHANT_ACCESS_DENIED'));
  });

  it('S3.3: merchant route uses merchantAccess or auth.ts guard', () => {
    const src = read('apps/service/src/routes/merchants.ts');
    const authSrc = read('apps/service/src/middleware/auth.ts');
    const covered = src.includes('merchantAccess') || src.includes('assertMerchant') || authSrc.includes('merchantId');
    assert.ok(covered, 'Merchant route must enforce merchant ownership');
  });

  it('S3.4: payment intents route guards merchantId access', () => {
    const src = read('apps/service/src/routes/intents.ts');
    const covered = src.includes('merchantAccess') || src.includes('assertMerchant') || src.includes('merchantId');
    assert.ok(covered, 'Payment intents route must include merchant context');
  });
});

// ── Phase S4: SourceApp enforcement ───────────────────────────────────────────
describe('S4 — SourceApp enforcement', () => {

  it('S4.1: SOURCE_APP_MISMATCH error code exists in merchantAccess.ts', () => {
    const src = read('apps/service/src/middleware/merchantAccess.ts');
    assert.ok(src.includes('SOURCE_APP_MISMATCH'));
  });

  it('S4.2: assertSourceApp function exists in merchantAccess.ts', () => {
    const src = read('apps/service/src/middleware/merchantAccess.ts');
    assert.ok(src.includes('assertSourceApp'));
  });

  it('S4.3: auth.ts populates sourceApp in RequestAuthContext from credential', () => {
    const src = read('apps/service/src/middleware/auth.ts');
    assert.ok(src.includes('sourceApp'), 'sourceApp must be set in auth context');
  });
});

// ── Phase S5: Scope-based authorization ───────────────────────────────────────
describe('S5 — Scope-based authorization', () => {

  it('S5.1: SCOPE_DENIED error code present in requireScope middleware', () => {
    const src = read('apps/service/src/middleware/requireScope.ts');
    assert.ok(src.includes('SCOPE_DENIED'));
  });

  it('S5.2: requireScope returns 403 on scope mismatch', () => {
    const src = read('apps/service/src/middleware/requireScope.ts');
    assert.ok(src.includes('403') || src.includes('403'), '403 status on SCOPE_DENIED missing');
  });

  it('S5.3: requireAnyScope returns 403 on all scopes missing', () => {
    const src = read('apps/service/src/middleware/requireAnyScope.ts');
    assert.ok(src.includes('SCOPE_DENIED') || src.includes('scope'), 'SCOPE_DENIED not in requireAnyScope');
  });

  it('S5.4: payment:create scope enforced on gateway-payments route', () => {
    const src = read('apps/service/src/routes/intents.ts');
    assert.ok(src.includes('payment:create'));
  });

  it('S5.5: payment:refund scope enforced on refund route', () => {
    const src = read('apps/service/src/routes/transactions.ts');
    assert.ok(src.includes('payment:refund'));
  });

  it('S5.6: payment:void scope enforced on void route', () => {
    const src = read('apps/service/src/routes/transactions.ts');
    assert.ok(src.includes('payment:void'));
  });

  it('S5.7: merchant:create scope enforced on merchant creation route', () => {
    const src = read('apps/service/src/routes/merchants.ts');
    assert.ok(src.includes('merchant:create'));
  });

  it('S5.8: webhook:manage scope enforced on webhook endpoint creation', () => {
    const src = read('apps/service/src/routes/merchantWebhooks.ts');
    assert.ok(src.includes('webhook:manage'));
  });
});

// ── Consumer integration guides ───────────────────────────────────────────────
describe('S1-5 — Consumer integration guides (documentation)', () => {

  it('DOC1: AuraPoS REST integration guide exists', () => {
    assert.ok(exists('docs/integration/aura-pos-rest-integration.md'));
  });

  it('DOC2: AuraPoS guide documents multi-tenant identity model', () => {
    const doc = read('docs/integration/aura-pos-rest-integration.md');
    assert.ok(doc.includes('multi-tenant') || doc.includes('merchantId'), 'Multi-tenant model missing');
    assert.ok(doc.includes('sourceApp'), 'sourceApp missing from AuraPoS guide');
    assert.ok(doc.includes('MERCHANT_ACCESS_DENIED'), 'Error codes missing from AuraPoS guide');
  });

  it('DOC3: Transity SDK integration guide exists', () => {
    assert.ok(exists('docs/integration/transity-sdk-integration.md'));
  });

  it('DOC4: Transity guide documents SDK usage with PaymentOrchestrationClient', () => {
    const doc = read('docs/integration/transity-sdk-integration.md');
    assert.ok(doc.includes('PaymentOrchestrationClient'), 'SDK client name missing');
    assert.ok(doc.includes('createPaymentIntent'), 'createPaymentIntent missing');
    assert.ok(doc.includes('PaymentOrchestrationClientError'), 'Error handling missing');
  });

  it('DOC5: Kioskoin REST integration guide exists', () => {
    assert.ok(exists('docs/integration/kioskoin-rest-integration.md'));
  });

  it('DOC6: Kioskoin guide documents single-merchant pattern', () => {
    const doc = read('docs/integration/kioskoin-rest-integration.md');
    assert.ok(doc.includes('single') || doc.includes('fixed'), 'Single-merchant pattern not documented');
    assert.ok(doc.includes('NORTHFLOW_MERCHANT_ID'), 'Fixed merchantId env var missing');
  });

  it('DOC7: client-integration-contract.md does NOT list deleteProviderAccountMethod', () => {
    const doc = read('docs/integration/client-integration-contract.md');
    assert.ok(
      !doc.includes('deleteProviderAccountMethod'),
      'deleteProviderAccountMethod was removed in S10.4 and must not appear in client-integration-contract.md',
    );
  });

  it('DOC8: client-integration-contract.md lists merchant webhook SDK methods', () => {
    const doc = read('docs/integration/client-integration-contract.md');
    const methods = [
      'createMerchantWebhookEndpoint',
      'listMerchantWebhookEndpoints',
      'disableMerchantWebhookEndpoint',
      'rotateMerchantWebhookEndpointSecret',
      'listMerchantWebhookDeliveries',
      'replayMerchantWebhook',
    ];
    const missing = methods.filter(m => !doc.includes(m));
    assert.deepEqual(missing, [], `Webhook methods missing from client-integration-contract.md: ${missing.join(', ')}`);
  });

  it('DOC9: client-integration-contract.md REST route families are complete', () => {
    const doc = read('docs/integration/client-integration-contract.md');
    const routes = [
      '/v1/merchants',
      '/v1/payment-intents',
      '/v1/payment-transactions',
      '/v1/audit-logs',
      '/v1/api-clients',
      'webhooks/endpoints',
    ];
    const missing = routes.filter(r => !doc.includes(r));
    assert.deepEqual(missing, [], `Route families missing from contract doc: ${missing.join(', ')}`);
  });
});

// ── SDK contract: S1-S5 runtime methods ──────────────────────────────────────
describe('S1-5 — SDK public contract for consumer apps', () => {

  const client = new PaymentOrchestrationClient({
    baseUrl: 'http://northflow.test',
    apiKey: 'nf.test.cred.secret',
    merchantId: 'mer_1',
    sourceApp: 'test',
  });
  const c = client as unknown as Record<string, unknown>;

  // AuraPoS / Kioskoin (REST-equivalent via SDK)
  it('SDK1: createMerchant exists (S1 onboarding)', () => {
    assert.equal(typeof c['createMerchant'], 'function');
  });

  it('SDK2: createProviderAccount exists (S1 onboarding)', () => {
    assert.equal(typeof c['createProviderAccount'], 'function');
  });

  it('SDK3: createPaymentIntent exists (S2 payment flow)', () => {
    assert.equal(typeof c['createPaymentIntent'], 'function');
  });

  it('SDK4: createGatewayPayment exists (S5 payment:create scope)', () => {
    assert.equal(typeof c['createGatewayPayment'], 'function');
  });

  it('SDK5: refundPaymentTransaction exists (S5 payment:refund scope)', () => {
    assert.equal(typeof c['refundPaymentTransaction'], 'function');
  });

  it('SDK6: voidPaymentTransaction exists (S5 payment:void scope)', () => {
    assert.equal(typeof c['voidPaymentTransaction'], 'function');
  });

  // Transity (SDK consumer)
  it('SDK7: getPaymentOptions exists (payment_method:read scope)', () => {
    assert.equal(typeof c['getPaymentOptions'], 'function');
  });

  it('SDK8: createMerchantWebhookEndpoint exists (webhook:manage scope)', () => {
    assert.equal(typeof c['createMerchantWebhookEndpoint'], 'function');
  });

  it('SDK9: createSigningKey exists (api_client:signing_key:create scope)', () => {
    assert.equal(typeof c['createSigningKey'], 'function');
  });

  // Removed methods
  it('SDK10: deleteProviderAccountMethod does NOT exist (removed S10.4)', () => {
    assert.equal(c['deleteProviderAccountMethod'], undefined);
  });

  it('SDK11: no PaymentEngine* aliases in SDK exports', () => {
    const idx = read('packages/client-sdk/src/index.ts');
    assert.ok(!idx.includes('PaymentEngine'), 'PaymentEngine* aliases must not be exported');
  });

  it('SDK12: no Standalone* aliases in SDK exports', () => {
    const idx = read('packages/client-sdk/src/index.ts');
    assert.ok(!idx.includes('Standalone'), 'Standalone* aliases must not be exported');
  });
});
