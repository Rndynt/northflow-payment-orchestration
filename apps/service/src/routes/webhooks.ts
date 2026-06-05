/**
 * webhooks — webhook ingestion routes for payment-orchestration-service.
 *
 * Phase 8E: HandleProviderWebhook use case wired here.
 * Phase 8K: use frozen error envelope.
 *
 * Routes:
 *   POST /v1/webhooks/:provider
 *
 * Auth:
 *   - Webhook routes intentionally bypass service-token auth.
 *   - Provider-level signature verification is handled inside
 *     FakeGatewayWebhookHandler (HMAC SHA-256 or dev-mode unsigned).
 *   - Must be registered BEFORE the app.use('/v1', auth) middleware in app.ts.
 *
 * RawBody:
 *   - app.ts captures req.rawBody via express.json({ verify }) for HMAC.
 *   - Handler receives Buffer (from rawBody) when available for signature verification.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import type { ServiceContainer } from '../container.ts';

export function createWebhooksRouter(container: ServiceContainer): Router {
  const router = Router();

  /**
   * POST /v1/webhooks/:provider
   * Ingest a provider webhook event into the standalone payment orchestration tables.
   */
  router.post('/:provider', async (req: Request, res: Response) => {
    const provider = req.params['provider'];
    try {
      // Prefer raw bytes for HMAC; fall back to parsed body if rawBody not captured.
      const rawBody: Buffer | Record<string, unknown> =
        (req as any).rawBody instanceof Buffer
          ? ((req as any).rawBody as Buffer)
          : (req.body as Record<string, unknown>);

      const result = await container.useCases.handleProviderWebhook.execute({
        provider: provider!,
        headers: req.headers as Record<string, string | string[] | undefined>,
        rawBody,
      });

      const status = result.processingStatus === 'failed' ? 422 : 200;

      res.status(status).json({
        ok: result.processingStatus !== 'failed',
        eventId: result.eventId,
        provider: result.provider,
        providerReference: result.providerReference,
        processingStatus: result.processingStatus,
        idempotentReplay: result.idempotentReplay,
        transaction: result.transaction
          ? {
              id: result.transaction.id,
              status: result.transaction.status,
              amount: result.transaction.amount,
            }
          : null,
        intent: result.intent
          ? {
              id: result.intent.id,
              status: result.intent.status,
              amountPaid: result.intent.amountPaid,
              amountRemaining: result.intent.amountRemaining,
            }
          : null,
      });
    } catch (err: any) {
      const statusCode = err?.statusCode ?? 500;
      const code = err?.code ?? 'INTERNAL_ERROR';
      const message = err?.message ?? 'An unexpected error occurred.';

      if (statusCode === 500 || !err?.code) {
        console.error(`[webhooks] Error processing webhook for provider '${provider}':`, err);
      }

      res.status(statusCode).json({
        ok: false,
        error: {
          code,
          message,
          details: null,
        },
        provider,
      });
    }
  });

  return router;
}
