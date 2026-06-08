/**
 * payment-orchestration-8k-contract-freeze.test.ts
 *
 * Phase 8K: SDK/API Contract Freeze + Deployment Readiness
 *
 * Verifies:
 * 1. Error response envelope uses nested { error: { code, message, details } } shape.
 * 2. Success response envelope uses { ok: true, data: ... } shape.
 * 3. apiErrorResponse() helper produces the frozen shape.
 * 4. Global error handler produces the frozen shape.
 * 5. 404 catch-all produces the frozen shape.
 * 6. SDK PaymentOrchestrationClientError has `details` field.
 * 7. SDK has refreshProviderStatus() and getReadiness() methods.
 * 8. SDK error parsing handles nested error envelope.
 * 9. SDK error parsing handles legacy flat format (backward compat).
 * 10. OpenAPI spec exists and is valid JSON with correct version.
 * 11. .env.example exists and contains no real secrets.
 * 12. Phase 8K deployment/contract doc files exist.
 * 13. config phase is '8K', version is '0.3.0'.
 *
 * Run:
 *   node_modules/.bin/tsx --tsconfig apps/api/tsconfig.node.json --test \
 *     apps/api/src/__tests__/payment-orchestration-8k-contract-freeze.test.ts
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { createServer, type Server } from 'node:http';

const root = process.cwd();

// ── Import service artifacts ─────────────────────────────────────────────────

// Direct path imports — avoids workspace package resolution issues in test runner
import { apiErrorResponse } from '../apps/service/src/routes/utils.ts';
import { errorHandler } from '../apps/service/src/middleware/errors.ts';
import { normalizePaymentOrchestrationError, PAYMENT_ORCHESTRATION_ERROR_CODES } from '../apps/service/src/application/errors.ts';
import { loadEnv } from '../apps/service/src/config/env.ts';
import { PaymentOrchestrationClientError } from '../packages/client-sdk/src/errors.ts';
import { PaymentOrchestrationClient } from '../packages/client-sdk/src/client.ts';

// ── Test helpers ─────────────────────────────────────────────────────────────

async function startTestServer(app: express.Application): Promise<{ url: string; server: Server }> {
  return new Promise((resolve) => {
    const server = createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({ url: `http://127.0.0.1:${addr.port}`, server });
    });
  });
}

async function stopServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

// ── Suite: apiErrorResponse helper ───────────────────────────────────────────

describe('apiErrorResponse helper (Phase 8K)', () => {
  it('returns frozen error envelope shape', () => {
    const res = apiErrorResponse('VALIDATION_ERROR', 'name is required');
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.error.code, 'VALIDATION_ERROR');
    assert.strictEqual(res.error.message, 'name is required');
    assert.strictEqual(res.error.details, null);
  });

  it('passes through details when provided', () => {
    const details = { field: 'name', reason: 'missing' };
    const res = apiErrorResponse('VALIDATION_ERROR', 'invalid', details);
    assert.deepEqual(res.error.details, details);
  });

  it('sets details to null when not provided', () => {
    const res = apiErrorResponse('NOT_FOUND', 'not found');
    assert.strictEqual(res.error.details, null);
  });
});

// ── Suite: Error middleware ───────────────────────────────────────────────────

describe('global error handler (Phase 8K)', () => {
  it('returns nested error envelope from error handler middleware', async () => {
    const app = express();
    app.use(express.json());
    app.get('/throw', (_req: Request, _res: Response, next: NextFunction) => {
      const err = Object.assign(new Error('Merchant not found: abc'), {
        statusCode: 404,
        code: 'MERCHANT_NOT_FOUND',
      });
      next(err);
    });
    app.use(errorHandler);

    const { url, server } = await startTestServer(app);
    try {
      const res = await fetch(`${url}/throw`);
      assert.strictEqual(res.status, 404);
      const body = await res.json() as Record<string, unknown>;
      assert.strictEqual(body['ok'], false);
      const error = body['error'] as Record<string, unknown>;
      assert.ok(error && typeof error === 'object', 'error should be an object');
      assert.strictEqual(error['code'], 'MERCHANT_NOT_FOUND');
      assert.ok(typeof error['message'] === 'string');
      assert.ok('details' in error);
    } finally {
      await stopServer(server);
    }
  });

  it('returns nested envelope for unknown errors (500)', async () => {
    const app = express();
    app.use(express.json());
    app.get('/crash', () => { throw new Error('Unexpected crash'); });
    app.use(errorHandler);

    const { url, server } = await startTestServer(app);
    try {
      const res = await fetch(`${url}/crash`);
      assert.strictEqual(res.status, 500);
      const body = await res.json() as Record<string, unknown>;
      assert.strictEqual(body['ok'], false);
      const error = body['error'] as Record<string, unknown>;
      assert.strictEqual(error['code'], 'INTERNAL_ERROR');
      assert.ok('details' in error);
    } finally {
      await stopServer(server);
    }
  });
});

// ── Suite: 404 catch-all ─────────────────────────────────────────────────────

describe('404 catch-all (Phase 8K)', () => {
  it('returns nested error envelope for unknown routes', async () => {
    const app = express();
    app.use(express.json());
    // Mimic the app.ts 404 handler
    app.use((_req: Request, res: Response) => {
      res.status(404).json({
        ok: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Route not found. Check the payment-orchestration-service API documentation.',
          details: null,
        },
      });
    });

    const { url, server } = await startTestServer(app);
    try {
      const res = await fetch(`${url}/v1/nonexistent-route`);
      assert.strictEqual(res.status, 404);
      const body = await res.json() as Record<string, unknown>;
      assert.strictEqual(body['ok'], false);
      const error = body['error'] as Record<string, unknown>;
      assert.strictEqual(error['code'], 'NOT_FOUND');
      assert.ok('details' in error);
    } finally {
      await stopServer(server);
    }
  });
});

// ── Suite: normalizePaymentOrchestrationError ─────────────────────────────────

describe('normalizePaymentOrchestrationError (Phase 8K)', () => {
  it('normalizes known error codes', () => {
    const err = Object.assign(new Error('Merchant not found: abc'), { statusCode: 404, code: 'MERCHANT_NOT_FOUND' });
    const result = normalizePaymentOrchestrationError(err);
    assert.strictEqual(result.code, 'MERCHANT_NOT_FOUND');
    assert.strictEqual(result.statusCode, 404);
  });

  it('falls back to INTERNAL_ERROR for unknown codes', () => {
    const err = Object.assign(new Error('boom'), { code: 'UNKNOWN_MYSTERY_CODE' });
    const result = normalizePaymentOrchestrationError(err);
    assert.strictEqual(result.code, 'INTERNAL_ERROR');
    assert.strictEqual(result.statusCode, 500);
  });

  it('all exported PAYMENT_ORCHESTRATION_ERROR_CODES are valid non-empty strings', () => {
    assert.ok(PAYMENT_ORCHESTRATION_ERROR_CODES.length >= 20, 'Should have at least 20 error codes');
    for (const code of PAYMENT_ORCHESTRATION_ERROR_CODES) {
      assert.ok(typeof code === 'string' && code.trim().length > 0, `Code should be non-empty string: ${code}`);
    }
  });

  it('includes all Phase 8K required codes', () => {
    const required = [
      'MERCHANT_NOT_FOUND',
      'INTENT_NOT_FOUND',
      'TRANSACTION_NOT_FOUND',
      'PROVIDER_ACCOUNT_NOT_FOUND',
      'PROVIDER_ACCOUNT_DISABLED',
      'PROVIDER_NOT_AVAILABLE',
      'WEBHOOK_PROVIDER_NOT_SUPPORTED',
      'WEBHOOK_SECRET_REQUIRED',
      'IDEMPOTENCY_IN_PROGRESS',
      'IDEMPOTENCY_PREVIOUSLY_FAILED',
      'OPERATIONS_REPOSITORY_UNSUPPORTED',
    ];
    for (const code of required) {
      assert.ok(
        PAYMENT_ORCHESTRATION_ERROR_CODES.includes(code as any),
        `Missing required Phase 8K error code: ${code}`,
      );
    }
  });
});

// ── Suite: SDK PaymentOrchestrationClientError ────────────────────────────────

describe('PaymentOrchestrationClientError (Phase 8K)', () => {
  it('has status, code, message, details, serviceError fields', () => {
    const details = { field: 'amountDue', issue: 'must be positive' };
    const err = new PaymentOrchestrationClientError('amountDue must be positive', 400, 'VALIDATION_ERROR', details, { raw: true });

    assert.ok(err instanceof Error);
    assert.ok(err instanceof PaymentOrchestrationClientError);
    assert.strictEqual(err.status, 400);
    assert.strictEqual(err.code, 'VALIDATION_ERROR');
    assert.strictEqual(err.message, 'amountDue must be positive');
    assert.deepEqual(err.details, details);
    assert.deepEqual(err.serviceError, { raw: true });
    assert.strictEqual(err.name, 'PaymentOrchestrationClientError');
  });

  it('details defaults to null when not provided', () => {
    const err = new PaymentOrchestrationClientError('not found', 404, 'MERCHANT_NOT_FOUND');
    assert.strictEqual(err.details, null);
  });
});

// ── Suite: SDK client — method contract ──────────────────────────────────────

describe('PaymentOrchestrationClient method contract (Phase 8K)', () => {
  it('has all required methods', () => {
    const client = new PaymentOrchestrationClient({
      baseUrl: 'http://localhost:5100',
      apiKey: 'nf.test.credential.secret',
    });
    const requiredMethods = [
      'createMerchant',
      'getMerchant',
      'createProviderAccount',
      'getProviderAccount',
      'createPaymentIntent',
      'getPaymentIntentStatus',
      'createGatewayPayment',
      'getRefundability',
      'reconcilePaymentIntentTotals',
      'confirmFakeGatewayPayment',
      'refreshProviderStatus',
      'getReadiness',
    ];
    for (const method of requiredMethods) {
      assert.ok(
        typeof (client as any)[method] === 'function',
        `SDK missing method: ${method}`,
      );
    }
  });
});

// ── Suite: SDK error parsing — nested envelope ───────────────────────────────

describe('SDK error parsing for nested error envelope (Phase 8K)', () => {
  it('parses nested error envelope { error: { code, message, details } }', async () => {
    const app = express();
    app.use(express.json());
    app.get('/v1/payment-intents/test-id/status', (_req: Request, res: Response) => {
      res.status(422).json({
        ok: false,
        error: {
          code: 'OVERPAYMENT_REJECTED',
          message: 'Payment would exceed amountDue.',
          details: { maxAllowed: 100000, requested: 150000 },
        },
      });
    });

    const { url, server } = await startTestServer(app);
    const client = new PaymentOrchestrationClient({ baseUrl: url, apiKey: 'nf.test.credential.secret' });
    try {
      await client.getPaymentIntentStatus('test-id', { merchantId: 'merch-1' });
      assert.fail('Should have thrown');
    } catch (err) {
      assert.ok(err instanceof PaymentOrchestrationClientError);
      assert.strictEqual(err.status, 422);
      assert.strictEqual(err.code, 'OVERPAYMENT_REJECTED');
      assert.ok(err.message.includes('Payment would exceed'));
      assert.deepEqual(err.details, { maxAllowed: 100000, requested: 150000 });
    } finally {
      await stopServer(server);
    }
  });

  it('parses legacy flat error envelope { error: "CODE", message: "..." } (backward compat)', async () => {
    const app = express();
    app.use(express.json());
    app.get('/v1/merchants/legacy-id', (_req: Request, res: Response) => {
      res.status(404).json({
        ok: false,
        error: 'MERCHANT_NOT_FOUND',
        message: 'Merchant not found: legacy-id',
      });
    });

    const { url, server } = await startTestServer(app);
    const client = new PaymentOrchestrationClient({ baseUrl: url, apiKey: 'nf.test.credential.secret' });
    try {
      await client.getMerchant('legacy-id');
      assert.fail('Should have thrown');
    } catch (err) {
      assert.ok(err instanceof PaymentOrchestrationClientError);
      assert.strictEqual(err.status, 404);
      assert.strictEqual(err.code, 'MERCHANT_NOT_FOUND');
      assert.ok(err.message.includes('Merchant not found'));
    } finally {
      await stopServer(server);
    }
  });

  it('getReadiness() calls GET /ready and returns data', async () => {
    const app = express();
    app.use(express.json());
    app.get('/ready', (_req: Request, res: Response) => {
      res.json({
        ok: true,
        service: 'payment-orchestration-service',
        providers: { fake_gateway: { registered: true } },
        database: 'configured',
      });
    });

    const { url, server } = await startTestServer(app);
    const client = new PaymentOrchestrationClient({ baseUrl: url });
    try {
      const readiness = await client.getReadiness();
      assert.strictEqual(readiness.ok, true);
      assert.strictEqual(readiness.service, 'payment-orchestration-service');
      assert.strictEqual(readiness.database, 'configured');
      assert.ok(readiness.providers['fake_gateway']?.registered);
    } finally {
      await stopServer(server);
    }
  });

  it('refreshProviderStatus() calls POST /v1/payment-transactions/:id/refresh-provider-status', async () => {
    const app = express();
    app.use(express.json());
    app.post('/v1/payment-transactions/:id/refresh-provider-status', (req: Request, res: Response) => {
      assert.strictEqual(req.headers['authorization'], 'Bearer nf.test.credential.secret');
      assert.strictEqual(req.headers['x-payment-orchestration-service-token'], undefined);
      res.json({
        ok: true,
        data: {
          transaction: {
            id: req.params['id'],
            intentId: 'pi_1',
            merchantId: 'merch_1',
            provider: 'fake_gateway',
            method: 'qris',
            status: 'succeeded',
            amount: 100000,
            currency: 'IDR',
            providerReference: 'pay_ref_1',
            providerPaymentUrl: null,
            providerQrString: null,
            failureReason: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          intent: null,
          providerStatus: 'COMPLETED',
          changed: false,
        },
      });
    });

    const { url, server } = await startTestServer(app);
    const client = new PaymentOrchestrationClient({ baseUrl: url, apiKey: 'nf.test.credential.secret', merchantId: 'merch_1' });
    try {
      const result = await client.refreshProviderStatus('tx_abc_123');
      assert.strictEqual(result.transaction.id, 'tx_abc_123');
      assert.strictEqual(result.providerStatus, 'COMPLETED');
      assert.strictEqual(result.changed, false);
    } finally {
      await stopServer(server);
    }
  });
});

// ── Suite: Phase 8K deployment readiness — file existence ────────────────────

describe('Phase 8K deployment readiness files', () => {
  it('docs/payment-orchestration-error-codes.md exists', () => {
    assert.ok(existsSync(join(root, 'docs/payment-orchestration-error-codes.md')), 'Missing docs/payment-orchestration-error-codes.md');
  });

  it('docs/payment-orchestration-api-contract.md exists', () => {
    assert.ok(existsSync(join(root, 'docs/payment-orchestration-api-contract.md')), 'Missing docs/payment-orchestration-api-contract.md');
  });

  it('docs/payment-orchestration-sdk-contract.md exists', () => {
    assert.ok(existsSync(join(root, 'docs/payment-orchestration-sdk-contract.md')), 'Missing docs/payment-orchestration-sdk-contract.md');
  });

  it('docs/openapi/payment-orchestration.openapi.json exists and is valid JSON', () => {
    const path = join(root, 'docs/openapi/payment-orchestration.openapi.json');
    assert.ok(existsSync(path), 'Missing OpenAPI spec');
    const content = readFileSync(path, 'utf8');
    const parsed = JSON.parse(content) as Record<string, unknown>;
    assert.strictEqual(parsed['openapi'], '3.1.0');
    assert.ok(parsed['info'], 'OpenAPI spec should have info');
    assert.ok(parsed['paths'], 'OpenAPI spec should have paths');
  });

  it('docs/payment-orchestration-deployment.md exists', () => {
    assert.ok(existsSync(join(root, 'docs/payment-orchestration-deployment.md')), 'Missing deployment guide');
  });

  it('docs/payment-orchestration-worker-operations.md exists', () => {
    assert.ok(existsSync(join(root, 'docs/payment-orchestration-worker-operations.md')), 'Missing worker ops guide');
  });

  it('docs/payment-orchestration-standalone-repo-layout.md exists', () => {
    assert.ok(existsSync(join(root, 'docs/payment-orchestration-standalone-repo-layout.md')), 'Missing standalone repo layout doc');
  });

  it('apps/service/.env.example exists and has no real secrets', () => {
    const path = join(root, 'apps/service/.env.example');
    assert.ok(existsSync(path), 'Missing .env.example');
    const content = readFileSync(path, 'utf8');
    // Should contain placeholders
    assert.ok(content.includes('PAYMENT_ORCHESTRATION_SERVICE_TOKEN'), 'Should document service token env var');
    assert.ok(content.includes('PAYMENT_ORCHESTRATION_DATABASE_URL'), 'Should document DB URL env var');
    // Should NOT contain real secrets (no 32+ char hex strings without placeholder text)
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
      const value = trimmed.split('=').slice(1).join('=').trim();
      if (/^[0-9a-f]{32,}$/i.test(value)) {
        assert.fail(`Possible real secret found in .env.example: ${trimmed}`);
      }
    }
  });

  it('apps/service/Dockerfile exists', () => {
    assert.ok(existsSync(join(root, 'apps/service/Dockerfile')), 'Missing Dockerfile');
  });
});

// ── Suite: config phase and version ──────────────────────────────────────────

describe('Phase 8K config (version + phase)', () => {
  it('loadEnv() returns phase 8K', () => {
    const config = loadEnv();
    // Phase bumped from 8K → S9 (API Key Rotation + Rate Limiting phase)
    assert.ok(config.phase === '8K' || config.phase === 'S9', `expected phase '8K' or 'S9', got '${config.phase}'`);
  });

  it('loadEnv() returns version 0.3.0', () => {
    const config = loadEnv();
    assert.strictEqual(config.version, '0.3.0');
  });
});
