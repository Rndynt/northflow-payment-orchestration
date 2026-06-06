/**
 * app — Express application factory for payment-orchestration-service.
 *
 * Returns a configured Express app instance.
 * Does NOT call app.listen() — that is the responsibility of src/index.ts.
 *
 * Design principles:
 * - No AuraPoS session/tenant middleware
 * - No POS order domain deps
 * - No static file serving
 * - JSON API only
 *
 * Phase 8E changes:
 *   1. Raw body capture: express.json({ verify }) saves Buffer to req.rawBody for HMAC.
 *   2. Webhook route registered BEFORE service-token auth middleware so that
 *      POST /v1/webhooks/:provider does NOT require a service token.
 *      Provider-level signature verification is done inside FakeGatewayWebhookHandler.
 *
 * Phase 8K: 404 handler uses frozen error envelope.
 */

import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { createHealthRouter } from './routes/health.ts';
import { createIntentsRouter } from './routes/intents.ts';
import { createMerchantsRouter } from './routes/merchants.ts';
import { createProviderAccountsRouter } from './routes/providerAccounts.ts';
import { createDevFakeGatewayRouter } from './routes/devFakeGateway.ts';
import { createWebhooksRouter } from './routes/webhooks.ts';
import { createTransactionsRouter } from './routes/transactions.ts';
import { createAuthMiddleware } from './middleware/auth.ts';
import { errorHandler } from './middleware/errors.ts';
import { requestContextMiddleware } from './middleware/requestContext.ts';
import type { ServiceContainer } from './container.ts';

export function createApp(container: ServiceContainer): express.Application {
  const app = express();

  app.use(requestContextMiddleware);

  // ── Body parsing: capture raw bytes for HMAC webhook verification ──────────
  app.use(
    express.json({
      limit: '256kb',
      verify: (req: Request, _res: Response, buf: Buffer) => {
        (req as any).rawBody = buf;
      },
    }),
  );

  // ── Unprotected: health + version + ready ─────────────────────────────────
  app.use(createHealthRouter(container.config, container.providerRegistry));

  // ── Webhooks bypass service-token auth ────────────────────────────────────
  // IMPORTANT: must be registered BEFORE app.use('/v1', auth) so that
  // POST /v1/webhooks/:provider does not require a service token.
  // Provider identity is verified via payload signature inside each handler.
  app.use('/v1/webhooks', createWebhooksRouter(container));

  // ── Service-token auth for all remaining /v1/... routes ───────────────────
  const auth = createAuthMiddleware(container.config.serviceToken, container.config.nodeEnv);
  app.use('/v1', auth);

  // ── API v1 — Merchants ────────────────────────────────────────────────────
  app.use('/v1/merchants', createMerchantsRouter(container));

  // ── API v1 — Provider Accounts (nested under merchants) ───────────────────
  app.use(
    '/v1/merchants/:merchantId/provider-accounts',
    createProviderAccountsRouter(container),
  );

  // ── API v1 — Payment Intents ──────────────────────────────────────────────
  app.use('/v1/payment-intents', createIntentsRouter(container));

  // ── API v1 — Payment Transactions ─────────────────────────────────────────
  app.use('/v1/payment-transactions', createTransactionsRouter(container));

  // ── Dev/test only: FakeGateway confirm ───────────────────────────────────
  if (container.config.nodeEnv !== 'production') {
    app.use('/v1/dev/fake-gateway', createDevFakeGatewayRouter(container));
  }

  // ── Global error handler ──────────────────────────────────────────────────
  app.use(errorHandler);

  // ── 404 catch-all ────────────────────────────────────────────────────────
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

  return app;
}
