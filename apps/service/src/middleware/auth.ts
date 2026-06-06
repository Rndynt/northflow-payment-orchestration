/**
 * auth — service-token authentication middleware for payment-orchestration-service.
 */

import { timingSafeEqual } from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { apiErrorResponse } from '../routes/utils.ts';

function tokenMatches(header: string | string[] | undefined, expected: string): boolean {
  if (!header || Array.isArray(header)) return false;
  const provided = Buffer.from(header);
  const configured = Buffer.from(expected);
  return provided.length === configured.length && timingSafeEqual(provided, configured);
}

export function createAuthMiddleware(serviceToken: string, nodeEnv: string) {
  if (!serviceToken && nodeEnv === 'production') {
    console.error('[payment-orchestration-service/auth] PAYMENT_ORCHESTRATION_SERVICE_TOKEN is not set.');
  }

  return function authMiddleware(req: Request, res: Response, next: NextFunction): void {
    if (!serviceToken) {
      if (nodeEnv === 'production') {
        res.status(503).json(apiErrorResponse(
          'SERVICE_MISCONFIGURED',
          'PAYMENT_ORCHESTRATION_SERVICE_TOKEN is not configured. Set this environment variable before starting the service in production.',
        ));
        return;
      }
      res.status(401).json(apiErrorResponse(
        'UNAUTHORIZED',
        'No service token configured. Set PAYMENT_ORCHESTRATION_SERVICE_TOKEN environment variable.',
      ));
      return;
    }

    const header =
      req.headers['x-payment-orchestration-service-token'] ??
      req.headers['x-payment-engine-service-token'];

    if (!tokenMatches(header, serviceToken)) {
      res.status(401).json(apiErrorResponse('UNAUTHORIZED', 'Invalid or missing service token.'));
      return;
    }

    next();
  };
}
