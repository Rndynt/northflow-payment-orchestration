/**
 * app — Express application factory for payment-orchestration-service.
 *
 * Returns a configured Express app instance.
 * Does NOT call app.listen() — that is the responsibility of src/index.ts.
 *
 * Phase 8E: Raw body capture for HMAC webhook verification.
 *           Webhook routes bypass service-token auth.
 * Phase S2: Auth middleware updated to per-client credential model.
 *           Legacy shared service token controlled by legacyServiceTokenEnabled config.
 * Phase S9.1: /v1/api-clients credential management routes registered.
 * Phase S9.2: Rate limit middleware applied after auth for all /v1 routes.
 *             Auth failure rate limiting wired into auth middleware.
 * Phase S9.3: Network-level service protection.
 *             - x-powered-by disabled
 *             - Security headers middleware (X-Content-Type-Options, X-Frame-Options, etc.)
 *             - Explicit CORS policy (disabled by default)
 *             - Trusted proxy config (disabled by default)
 *             - Configurable JSON body size limit
 *             - Structured 404 for unknown paths
 *             - /ready endpoint token protection (optional, via health router)
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
import {
  createProviderAccountMethodsSubRouter,
  createMerchantPaymentMethodsRouter,
  createPaymentOptionsRouter,
} from './routes/paymentMethods.ts';
import { createAuditLogsRouter } from './routes/auditLogs.ts';
import { createApiClientCredentialsRouter } from './routes/apiClientCredentials.ts';
import { createAuthMiddleware } from './middleware/auth.ts';
import { createRateLimitMiddleware } from './middleware/rateLimit.ts';
import { errorHandler } from './middleware/errors.ts';
import { requestContextMiddleware } from './middleware/requestContext.ts';
import { securityHeadersMiddleware } from './middleware/securityHeaders.ts';
import { createCorsMiddleware } from './middleware/cors.ts';
import type { ServiceContainer } from './container.ts';

export function createApp(container: ServiceContainer): express.Application {
  const app = express();

  // ── B1: Disable x-powered-by ──────────────────────────────────────────────
  app.disable('x-powered-by');

  // ── B4: Trusted proxy (must be set before any req.ip reads) ──────────────
  // Default: false. Enable behind Cloudflare/Nginx only — pair with origin firewall.
  const trustProxy = container.config.trustProxy ?? false;
  app.set('trust proxy', trustProxy);

  // ── B2: Security headers (global — applied to all responses) ──────────────
  app.use(securityHeadersMiddleware);

  // ── B3: Explicit CORS policy ──────────────────────────────────────────────
  // Disabled by default. Backend-to-backend API; browsers must not call it directly.
  app.use(createCorsMiddleware(
    container.config.corsEnabled ?? false,
    container.config.corsAllowedOrigins ?? [],
  ));

  app.use(requestContextMiddleware);

  // ── B5: Body parsing — configurable limit; raw bytes captured for HMAC ────
  const jsonBodyLimit = container.config.jsonBodyLimit ?? '256kb';
  app.use(
    express.json({
      limit: jsonBodyLimit,
      verify: (req: Request, _res: Response, buf: Buffer) => {
        (req as any).rawBody = buf;
      },
    }),
  );

  // ── Unprotected: health + version + ready ─────────────────────────────────
  app.use(createHealthRouter(container.config, container.providerRegistry));

  // ── Webhooks bypass service-token auth ────────────────────────────────────
  app.use('/v1/webhooks', createWebhooksRouter(container));

  // ── S2: Per-client auth for all remaining /v1/... routes ──────────────────
  const auth = createAuthMiddleware({
    serviceToken: container.config.serviceToken,
    nodeEnv: container.config.nodeEnv,
    legacyEnabled: container.config.legacyServiceTokenEnabled,
    credentialRepo: container.authRepos?.clientCredentialRepo,
    clientRepo: container.authRepos?.apiClientRepo,
    // S9.2: Auth failure rate limiting
    rateLimiter: container.rateLimiter,
    authFailureRateLimitEnabled: container.config.rateLimitEnabled,
    authFailurePerMinute: container.config.rateLimitAuthFailurePerMinute,
  });
  app.use('/v1', auth);

  // ── S9.2: Per-client rate limit for all authenticated /v1 routes ───────────
  if (container.rateLimiter) {
    const rateLimitMiddleware = createRateLimitMiddleware(
      container.rateLimiter,
      {
        enabled: container.config.rateLimitEnabled,
        clientGlobalPerMinute: container.config.rateLimitClientGlobalPerMinute,
        clientRoutePerMinute: container.config.rateLimitClientRoutePerMinute,
      },
      container,
    );
    app.use('/v1', rateLimitMiddleware);
  }

  // ── API v1 — Merchants ────────────────────────────────────────────────────
  app.use('/v1/merchants', createMerchantsRouter(container));

  // ── API v1 — Provider Accounts (nested under merchants) ───────────────────
  app.use(
    '/v1/merchants/:merchantId/provider-accounts',
    createProviderAccountsRouter(container),
  );

  // ── S7.5: Payment Methods (nested under provider accounts) ─────────────────
  app.use(
    '/v1/merchants/:merchantId/provider-accounts/:providerAccountId',
    createProviderAccountMethodsSubRouter(container),
  );

  // ── S7.5: Merchant-level payment methods (active methods across all PA) ────
  app.use(
    '/v1/merchants/:merchantId/payment-methods',
    createMerchantPaymentMethodsRouter(container),
  );

  // ── S7.5: Payment intent payment options ───────────────────────────────────
  app.use(
    '/v1/payment-intents/:intentId/payment-options',
    createPaymentOptionsRouter(container),
  );

  // ── API v1 — Payment Intents ──────────────────────────────────────────────
  app.use('/v1/payment-intents', createIntentsRouter(container));

  // ── API v1 — Payment Transactions ─────────────────────────────────────────
  app.use('/v1/payment-transactions', createTransactionsRouter(container));

  // ── S8: Audit Logs (read API) ─────────────────────────────────────────────
  app.use('/v1/audit-logs', createAuditLogsRouter(container));

  // ── S9.1: API Client Credential Management ────────────────────────────────
  app.use(
    '/v1/api-clients/:clientId/credentials',
    createApiClientCredentialsRouter(container),
  );

  // ── Dev/test only: FakeGateway confirm ───────────────────────────────────
  if (container.config.nodeEnv !== 'production') {
    app.use('/v1/dev/fake-gateway', createDevFakeGatewayRouter(container));
  }

  // ── Global error handler ──────────────────────────────────────────────────
  app.use(errorHandler);

  // ── B6: Structured 404 catch-all for unknown paths ───────────────────────
  // Preserves service error envelope. No stack traces.
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
