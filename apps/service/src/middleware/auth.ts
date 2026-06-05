/**
 * auth — service-token authentication middleware for payment-orchestration-service.
 *
 * All /v1/... routes must pass through this middleware.
 * Health and version endpoints are exempt.
 *
 * Token resolution (both headers accepted):
 *   Primary:    x-payment-orchestration-service-token
 *   Compat:     x-payment-engine-service-token
 *
 * Behavior:
 * - If serviceToken is empty AND production → 503 (misconfigured, refuse to start serving).
 * - If serviceToken is empty AND non-production → 401 with hint to configure token.
 * - If serviceToken is set AND header is missing/wrong → 401 Unauthorized.
 * - If serviceToken is set AND header matches → next().
 *
 * No AuraPoS session/tenant checks.
 */

import type { Request, Response, NextFunction } from 'express';

export function createAuthMiddleware(serviceToken: string, nodeEnv: string) {
  if (!serviceToken && nodeEnv === 'production') {
    console.error(
      '[payment-orchestration-service/auth] PAYMENT_ORCHESTRATION_SERVICE_TOKEN is not set. ' +
        'Service will return 503 on all protected routes.',
    );
  }

  return function authMiddleware(req: Request, res: Response, next: NextFunction): void {
    if (!serviceToken) {
      if (nodeEnv === 'production') {
        res.status(503).json({
          ok: false,
          error: 'SERVICE_MISCONFIGURED',
          message:
            'PAYMENT_ORCHESTRATION_SERVICE_TOKEN is not configured. ' +
            'Set this environment variable before starting the service in production.',
        });
        return;
      }
      res.status(401).json({
        ok: false,
        error: 'UNAUTHORIZED',
        message:
          'No service token configured. ' +
          'Set PAYMENT_ORCHESTRATION_SERVICE_TOKEN environment variable.',
      });
      return;
    }

    const header =
      req.headers['x-payment-orchestration-service-token'] ??
      req.headers['x-payment-engine-service-token'];

    if (!header || header !== serviceToken) {
      res.status(401).json({
        ok: false,
        error: 'UNAUTHORIZED',
        message: 'Invalid or missing service token.',
      });
      return;
    }

    next();
  };
}
