/**
 * cors — Explicit CORS policy middleware for payment-orchestration-service.
 *
 * Northflow internal service API is backend-to-backend only.
 * Consumer browser frontends must NOT call it directly.
 *
 * Rules:
 *   - CORS is disabled by default (production-safe).
 *   - If enabled, only explicitly configured origins are allowed (no wildcard).
 *   - Arbitrary Origin reflection is never performed.
 *   - OPTIONS preflight is handled for allowed origins only.
 *
 * Phase S9.3: Network-Level Service Protection.
 */

import type { Request, Response, NextFunction } from 'express';

const ALLOWED_CORS_METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';
const ALLOWED_CORS_HEADERS = 'Content-Type, Authorization, X-Request-Id, X-Idempotency-Key';

export function createCorsMiddleware(
  corsEnabled: boolean,
  allowedOrigins: string[],
): (req: Request, res: Response, next: NextFunction) => void {
  return function corsMiddleware(req: Request, res: Response, next: NextFunction): void {
    // CORS disabled — emit no CORS headers
    if (!corsEnabled || allowedOrigins.length === 0) {
      if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
      }
      next();
      return;
    }

    const origin = req.headers['origin'];

    if (origin && allowedOrigins.includes(origin)) {
      // Allowed origin — set CORS headers
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', ALLOWED_CORS_METHODS);
      res.setHeader('Access-Control-Allow-Headers', ALLOWED_CORS_HEADERS);
      res.setHeader('Access-Control-Max-Age', '600');
      res.setHeader('Vary', 'Origin');
    }
    // Disallowed or absent origin — emit no CORS headers (not an error for non-browser callers)

    if (req.method === 'OPTIONS') {
      if (origin && allowedOrigins.includes(origin)) {
        res.status(204).end();
      } else {
        res.status(403).end();
      }
      return;
    }

    next();
  };
}
