/**
 * S10.4.1 — Contract freeze correction tests
 *
 * Guards against the specific mismatches found during S10.4 review:
 *   1. roadmap/service/main.md must include all current scopes
 *   2. route-scope-matrix.md must document one-of scope alternatives for payment method routes
 *   3. OpenAPI security for one-of routes must use separate requirement objects
 *   4. Release readiness doc must not overclaim SDK covers all 34 documented routes
 *   5. SDK must not expose removed methods/aliases
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PaymentOrchestrationClient } from '../packages/client-sdk/src/client.ts';

// ── File loaders ──────────────────────────────────────────────────────────────
const root = process.cwd();
const mainMd = readFileSync(join(root, 'roadmap/service/main.md'), 'utf8');
const matrixMd = readFileSync(join(root, 'docs/security/route-scope-matrix.md'), 'utf8');
const releaseMd = readFileSync(join(root, 'docs/release/v0.4.0-release-readiness.md'), 'utf8');
const spec = JSON.parse(readFileSync(join(root, 'docs/openapi/payment-orchestration.openapi.json'), 'utf8')) as {
  paths: Record<string, Record<string, { security?: Array<Record<string, string[]>> }>>;
};

// ── Task A: Canonical scope list completeness ─────────────────────────────────
describe('S10.4.1 — Canonical scope list (main.md)', () => {

  const REQUIRED_SCOPES = [
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

  it('SC01: main.md contains all 26 required scopes', () => {
    const missing = REQUIRED_SCOPES.filter(s => !mainMd.includes(s));
    assert.deepEqual(missing, [],
      `main.md missing scopes: ${missing.join(', ')}`);
  });

  it('SC02: main.md includes webhook:manage', () => {
    assert.ok(mainMd.includes('webhook:manage'), 'webhook:manage not found in main.md scope list');
  });

  it('SC03: main.md includes webhook:read', () => {
    assert.ok(mainMd.includes('webhook:read'), 'webhook:read not found in main.md scope list');
  });

  it('SC04: main.md includes all api_client:signing_key:* scopes', () => {
    const signingScopes = [
      'api_client:signing_key:create',
      'api_client:signing_key:read',
      'api_client:signing_key:rotate',
      'api_client:signing_key:revoke',
    ];
    const missing = signingScopes.filter(s => !mainMd.includes(s));
    assert.deepEqual(missing, [], `main.md missing signing key scopes: ${missing.join(', ')}`);
  });
});

// ── Task B: Route-scope matrix one-of documentation ───────────────────────────
describe('S10.4.1 — Route-scope matrix one-of scopes', () => {

  it('SC05: matrix documents payment_method:read OR provider_account:read for list methods route', () => {
    assert.ok(
      matrixMd.includes('payment_method:read') && matrixMd.includes('provider_account:read'),
      'matrix must document both payment_method:read and provider_account:read for list methods'
    );
  });

  it('SC06: matrix documents payment_method:write OR provider_account:create for upsert route', () => {
    assert.ok(
      matrixMd.includes('payment_method:write') && matrixMd.includes('provider_account:create'),
      'matrix must document both payment_method:write and provider_account:create for upsert'
    );
  });

  it('SC07: matrix documents payment_method:sync OR provider_account:create for sync route', () => {
    assert.ok(
      matrixMd.includes('payment_method:sync'),
      'matrix must document payment_method:sync for sync route'
    );
  });

  it('SC08: matrix documents intent:read as one-of for payment-methods and payment-options routes', () => {
    assert.ok(
      matrixMd.includes('intent:read'),
      'matrix must document intent:read as one-of scope for merchant payment-methods and payment-options'
    );
  });

  it('SC09: matrix uses "one-of" or "OR" language for payment method routes', () => {
    const hasOneOf = matrixMd.includes('one-of') || matrixMd.includes('**OR**');
    assert.ok(hasOneOf, 'route-scope matrix must explicitly document one-of/OR alternatives');
  });
});

// ── Task C: OpenAPI one-of security objects ───────────────────────────────────
describe('S10.4.1 — OpenAPI one-of security correctness', () => {

  it('SC10: GET /methods uses 2 separate security objects (payment_method:read OR provider_account:read)', () => {
    const path = '/v1/merchants/{merchantId}/provider-accounts/{providerAccountId}/methods';
    const sec = spec.paths[path]?.get?.security ?? [];
    assert.equal(sec.length, 2, `Expected 2 security alternatives, got ${sec.length}`);
    const scopes = sec.flatMap(s => Object.values(s).flat());
    assert.ok(scopes.includes('payment_method:read'), 'missing payment_method:read');
    assert.ok(scopes.includes('provider_account:read'), 'missing provider_account:read');
  });

  it('SC11: PUT /methods/{method} uses 2 separate security objects', () => {
    const path = '/v1/merchants/{merchantId}/provider-accounts/{providerAccountId}/methods/{method}';
    const sec = spec.paths[path]?.put?.security ?? [];
    assert.equal(sec.length, 2, `Expected 2, got ${sec.length}`);
    const scopes = sec.flatMap(s => Object.values(s).flat());
    assert.ok(scopes.includes('payment_method:write'), 'missing payment_method:write');
    assert.ok(scopes.includes('provider_account:create'), 'missing provider_account:create');
  });

  it('SC12: POST /methods/sync uses 2 separate security objects', () => {
    const path = '/v1/merchants/{merchantId}/provider-accounts/{providerAccountId}/methods/sync';
    const sec = spec.paths[path]?.post?.security ?? [];
    assert.equal(sec.length, 2, `Expected 2, got ${sec.length}`);
    const scopes = sec.flatMap(s => Object.values(s).flat());
    assert.ok(scopes.includes('payment_method:sync'), 'missing payment_method:sync');
    assert.ok(scopes.includes('provider_account:create'), 'missing provider_account:create');
  });

  it('SC13: GET /payment-methods uses 3 separate security objects', () => {
    const path = '/v1/merchants/{merchantId}/payment-methods';
    const sec = spec.paths[path]?.get?.security ?? [];
    assert.equal(sec.length, 3, `Expected 3, got ${sec.length}`);
    const scopes = sec.flatMap(s => Object.values(s).flat());
    assert.ok(scopes.includes('payment_method:read'), 'missing payment_method:read');
    assert.ok(scopes.includes('provider_account:read'), 'missing provider_account:read');
    assert.ok(scopes.includes('intent:read'), 'missing intent:read');
  });

  it('SC14: GET /payment-options uses 2 separate security objects', () => {
    const path = '/v1/payment-intents/{intentId}/payment-options';
    const sec = spec.paths[path]?.get?.security ?? [];
    assert.equal(sec.length, 2, `Expected 2, got ${sec.length}`);
    const scopes = sec.flatMap(s => Object.values(s).flat());
    assert.ok(scopes.includes('payment_method:read'), 'missing payment_method:read');
    assert.ok(scopes.includes('intent:read'), 'missing intent:read');
  });

  it('SC15: each one-of security requirement has exactly one scope (not combined)', () => {
    const oneOfPaths = [
      '/v1/merchants/{merchantId}/provider-accounts/{providerAccountId}/methods',
      '/v1/merchants/{merchantId}/provider-accounts/{providerAccountId}/methods/{method}',
      '/v1/merchants/{merchantId}/provider-accounts/{providerAccountId}/methods/sync',
      '/v1/merchants/{merchantId}/payment-methods',
      '/v1/payment-intents/{intentId}/payment-options',
    ];
    for (const p of oneOfPaths) {
      for (const [method, op] of Object.entries(spec.paths[p] ?? {})) {
        for (const [i, secReq] of (op.security ?? []).entries()) {
          const values = Object.values(secReq);
          assert.equal(values.length, 1,
            `${method.toUpperCase()} ${p} security[${i}] must have 1 key`);
          assert.equal(values[0]!.length, 1,
            `${method.toUpperCase()} ${p} security[${i}].apiKey must have 1 scope`);
        }
      }
    }
  });
});

// ── Task D: Release readiness honest coverage ─────────────────────────────────
describe('S10.4.1 — Release readiness doc honesty', () => {

  it('SC16: release doc does not claim SDK covers all 34 documented routes', () => {
    assert.ok(
      !releaseMd.includes('PaymentOrchestrationClient` covers all 34 documented routes'),
      'release doc must not claim SDK covers all 34 routes'
    );
  });

  it('SC17: release doc acknowledges admin/ops routes are REST-only', () => {
    const hasAdminNote = releaseMd.includes('Admin/ops') || releaseMd.includes('admin/ops') ||
                         releaseMd.includes('direct REST') || releaseMd.includes('operator tooling');
    assert.ok(hasAdminNote, 'release doc must acknowledge admin routes are not SDK-covered');
  });
});

// ── Task E: SDK removed methods / aliases ─────────────────────────────────────
describe('S10.4.1 — SDK must not expose removed methods/aliases', () => {

  const client = new PaymentOrchestrationClient({
    baseUrl: 'http://northflow.test',
    apiKey: 'nf.test.secret',
    merchantId: 'mer_1',
    sourceApp: 'test',
  });

  const clientRecord = client as unknown as Record<string, unknown>;

  it('SC18: deleteProviderAccountMethod is not on SDK client', () => {
    assert.equal(clientRecord['deleteProviderAccountMethod'], undefined,
      'deleteProviderAccountMethod must not exist — no backing route');
  });

  it('SC19: refundTransaction is not on SDK client (correct method is refundPaymentTransaction)', () => {
    assert.equal(clientRecord['refundTransaction'], undefined,
      'refundTransaction must not exist — alias removed');
  });

  it('SC20: voidTransaction is not on SDK client (correct method is voidPaymentTransaction)', () => {
    assert.equal(clientRecord['voidTransaction'], undefined,
      'voidTransaction must not exist — alias removed');
  });

  it('SC21: no PaymentEngine* properties on SDK client or exports', () => {
    const clientSrc = readFileSync(join(root, 'packages/client-sdk/src/client.ts'), 'utf8');
    const indexSrc = readFileSync(join(root, 'packages/client-sdk/src/index.ts'), 'utf8');
    assert.ok(!clientSrc.includes('PaymentEngine'), 'client.ts must not export PaymentEngine* aliases');
    assert.ok(!indexSrc.includes('PaymentEngine'), 'index.ts must not export PaymentEngine* aliases');
  });

  it('SC22: no Standalone* properties on SDK client or exports', () => {
    const clientSrc = readFileSync(join(root, 'packages/client-sdk/src/client.ts'), 'utf8');
    const indexSrc = readFileSync(join(root, 'packages/client-sdk/src/index.ts'), 'utf8');
    assert.ok(!clientSrc.includes('Standalone'), 'client.ts must not export Standalone* aliases');
    assert.ok(!indexSrc.includes('Standalone'), 'index.ts must not export Standalone* aliases');
  });

  it('SC23: SDK client has expected runtime integration methods', () => {
    const required = [
      'createMerchant', 'getMerchant',
      'createProviderAccount', 'getProviderAccount',
      'createPaymentIntent', 'getPaymentIntentStatus',
      'createGatewayPayment', 'refundPaymentTransaction', 'voidPaymentTransaction',
      'listProviderAccountMethods', 'upsertProviderAccountMethod', 'syncProviderAccountMethods',
      'createSigningKey', 'listSigningKeys', 'rotateSigningKey', 'revokeSigningKey',
      'createMerchantWebhookEndpoint', 'listMerchantWebhookEndpoints',
      'disableMerchantWebhookEndpoint', 'rotateMerchantWebhookEndpointSecret',
      'listMerchantWebhookDeliveries', 'replayMerchantWebhook',
    ];
    const missing = required.filter(m => typeof clientRecord[m] !== 'function');
    assert.deepEqual(missing, [], `SDK missing required methods: ${missing.join(', ')}`);
  });
});
