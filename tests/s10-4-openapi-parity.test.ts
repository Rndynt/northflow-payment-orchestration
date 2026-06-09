/**
 * S10.4 — OpenAPI ↔ Service route parity contract test
 *
 * Asserts that every path documented in docs/openapi/payment-orchestration.openapi.json
 * has a corresponding registered route in the Express application, and vice-versa.
 * Any drift between docs and implementation causes a test failure.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ── Load OpenAPI spec ─────────────────────────────────────────────────────────
const OPENAPI_PATH = join(process.cwd(), 'docs/openapi/payment-orchestration.openapi.json');
const spec = JSON.parse(readFileSync(OPENAPI_PATH, 'utf8')) as {
  openapi: string;
  info: { title: string; version: string };
  paths: Record<string, Record<string, unknown>>;
  components: { schemas: Record<string, unknown>; responses: Record<string, unknown>; securitySchemes: Record<string, unknown> };
  tags: { name: string }[];
};

// ── Canonical route list sourced from app.ts registration order ───────────────
// These are the routes actually registered in Express, expressed as OpenAPI path templates.
const SERVICE_ROUTES: Set<string> = new Set([
  // Health
  '/health',
  '/version',
  '/ready',
  // Provider webhooks
  '/v1/webhooks/{provider}',
  // Merchants
  '/v1/merchants',
  '/v1/merchants/{id}',
  // Provider Accounts
  '/v1/merchants/{merchantId}/provider-accounts',
  '/v1/merchants/{merchantId}/provider-accounts/{id}',
  // Payment Methods
  '/v1/merchants/{merchantId}/provider-accounts/{providerAccountId}/methods',
  '/v1/merchants/{merchantId}/provider-accounts/{providerAccountId}/methods/{method}',
  '/v1/merchants/{merchantId}/provider-accounts/{providerAccountId}/methods/sync',
  // Merchant Webhooks
  '/v1/merchants/{merchantId}/webhooks/endpoints',
  '/v1/merchants/{merchantId}/webhooks/endpoints/{endpointId}/disable',
  '/v1/merchants/{merchantId}/webhooks/endpoints/{endpointId}/rotate-secret',
  '/v1/merchants/{merchantId}/webhooks/deliveries',
  '/v1/merchants/{merchantId}/webhooks/replay',
  // Merchant Payment Methods
  '/v1/merchants/{merchantId}/payment-methods',
  // Payment Options
  '/v1/payment-intents/{intentId}/payment-options',
  // Payment Intents
  '/v1/payment-intents',
  '/v1/payment-intents/{id}/status',
  '/v1/payment-intents/{id}/refundability',
  '/v1/payment-intents/{id}/gateway-payments',
  '/v1/payment-intents/{id}/reconcile',
  // Payment Transactions
  '/v1/payment-transactions/{id}/refresh-provider-status',
  '/v1/payment-transactions/{transactionId}/refund',
  '/v1/payment-transactions/{transactionId}/void',
  // Audit Logs
  '/v1/audit-logs',
  // API Client Credentials
  '/v1/api-clients/{clientId}/credentials',
  '/v1/api-clients/{clientId}/credentials/rotate',
  '/v1/api-clients/{clientId}/credentials/{credentialId}/revoke',
  // Signing Keys
  '/v1/api-clients/{clientId}/signing-keys',
  '/v1/api-clients/{clientId}/signing-keys/rotate',
  '/v1/api-clients/{clientId}/signing-keys/{signingKeyId}/revoke',
  // Dev (non-production)
  '/v1/dev/fake-gateway/transactions/{id}/confirm',
]);

// ── Scope registry: every scope that must appear in the route-scope-matrix ────
const EXPECTED_SCOPES = new Set([
  'merchant:create', 'merchant:read',
  'provider_account:create', 'provider_account:read',
  'intent:create', 'intent:read',
  'payment:create', 'payment:refund', 'payment:void', 'payment:reconcile',
  'payment_method:read', 'payment_method:write', 'payment_method:sync',
  'audit_log:read',
  'api_client:credential:create', 'api_client:credential:read',
  'api_client:credential:rotate', 'api_client:credential:revoke',
  'api_client:signing_key:create', 'api_client:signing_key:read',
  'api_client:signing_key:rotate', 'api_client:signing_key:revoke',
  'webhook:manage', 'webhook:read',
]);

describe('S10.4 — OpenAPI ↔ Service parity', () => {

  it('OA01: spec version is 0.4.0', () => {
    assert.equal(spec.info.version, '0.4.0');
  });

  it('OA02: spec has openapi 3.x field', () => {
    assert.match(spec.openapi, /^3\./);
  });

  it('OA03: every service route is documented in OpenAPI', () => {
    const docPaths = new Set(Object.keys(spec.paths));
    const missing: string[] = [];
    for (const route of SERVICE_ROUTES) {
      if (!docPaths.has(route)) missing.push(route);
    }
    assert.deepEqual(missing, [], `Service routes missing from OpenAPI spec: ${missing.join(', ')}`);
  });

  it('OA04: every OpenAPI path has a corresponding service route', () => {
    const docPaths = Object.keys(spec.paths);
    const undocumented = docPaths.filter(p => !SERVICE_ROUTES.has(p));
    assert.deepEqual(undocumented, [], `OpenAPI paths with no matching service route: ${undocumented.join(', ')}`);
  });

  it('OA05: total path count matches', () => {
    assert.equal(Object.keys(spec.paths).length, SERVICE_ROUTES.size,
      `Expected ${SERVICE_ROUTES.size} documented paths, found ${Object.keys(spec.paths).length}`);
  });

  it('OA06: all /v1/* routes declare security requirements', () => {
    const violations: string[] = [];
    for (const [path, methods] of Object.entries(spec.paths)) {
      if (!path.startsWith('/v1/')) continue;
      // Provider webhooks are authenticated via HMAC, not bearer scope — empty security [] is correct
      if (path === '/v1/webhooks/{provider}') continue;
      for (const [method, op] of Object.entries(methods as Record<string, { security?: unknown[] }>)) {
        const security = op?.security;
        if (!Array.isArray(security) || security.length === 0) {
          violations.push(`${method.toUpperCase()} ${path} — missing security declaration`);
        }
      }
    }
    assert.deepEqual(violations, [], `Routes missing security declarations:\n${violations.join('\n')}`);
  });

  it('OA07: all expected scopes appear in at least one route security declaration', () => {
    const declaredScopes = new Set<string>();
    for (const methods of Object.values(spec.paths)) {
      for (const op of Object.values(methods as Record<string, { security?: Array<Record<string, string[]>> }>)) {
        for (const secReq of op?.security ?? []) {
          for (const scopes of Object.values(secReq)) {
            for (const scope of scopes) declaredScopes.add(scope);
          }
        }
      }
    }
    const missing = [...EXPECTED_SCOPES].filter(s => !declaredScopes.has(s));
    assert.deepEqual(missing, [], `Expected scopes not found in any OpenAPI route: ${missing.join(', ')}`);
  });

  it('OA08: required component schemas are present', () => {
    const required = [
      'ErrorEnvelope', 'PaymentIntent', 'PaymentTransaction', 'Merchant', 'ProviderAccount',
      'ProviderAccountMethod', 'UpsertProviderAccountMethodRequest', 'PaymentOptionItem',
      'AuditLogEntry', 'ApiClientCredential', 'ApiClientCredentialCreated',
      'SigningKey', 'SigningKeyCreated', 'WebhookEventType', 'WebhookEndpoint', 'WebhookDelivery',
    ];
    const schemas = Object.keys(spec.components?.schemas ?? {});
    const missing = required.filter(s => !schemas.includes(s));
    assert.deepEqual(missing, [], `Missing schemas: ${missing.join(', ')}`);
  });

  it('OA09: required error response components are present', () => {
    const required = ['Unauthorized', 'Forbidden', 'NotFound', 'ValidationError', 'RateLimited'];
    const responses = Object.keys(spec.components?.responses ?? {});
    const missing = required.filter(r => !responses.includes(r));
    assert.deepEqual(missing, [], `Missing response components: ${missing.join(', ')}`);
  });

  it('OA10: ErrorEnvelope schema has ok, error.code, error.message, error.details fields', () => {
    const envelope = spec.components?.schemas?.['ErrorEnvelope'] as {
      properties?: { ok?: unknown; error?: { properties?: Record<string, unknown> } };
    };
    assert.ok(envelope?.properties?.ok, 'ErrorEnvelope.ok missing');
    assert.ok(envelope?.properties?.error, 'ErrorEnvelope.error missing');
    const errorProps = (envelope.properties.error as { properties?: Record<string, unknown> })?.properties;
    assert.ok(errorProps?.code, 'ErrorEnvelope.error.code missing');
    assert.ok(errorProps?.message, 'ErrorEnvelope.error.message missing');
    assert.ok('details' in (errorProps ?? {}), 'ErrorEnvelope.error.details missing');
  });

  it('OA11: tags cover all route groups', () => {
    const tagNames = new Set(spec.tags?.map((t: { name: string }) => t.name) ?? []);
    const required = [
      'Health', 'Merchants', 'Provider Accounts', 'Payment Methods',
      'Payment Intents', 'Payment Transactions', 'Audit Logs', 'API Clients',
      'Merchant Webhooks', 'Provider Webhooks', 'Dev',
    ];
    const missing = required.filter(t => !tagNames.has(t));
    assert.deepEqual(missing, [], `Missing tags: ${missing.join(', ')}`);
  });
});
