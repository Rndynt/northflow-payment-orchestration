/**
 * securityHeaders — HTTP security response header middleware.
 *
 * Applied globally before all routes. No external dependency.
 * Safe for JSON APIs — no CSP that breaks API responses.
 *
 * Phase S9.3: Network-Level Service Protection.
 */

import type { Request, Response, NextFunction } from 'express';

/**
 * Applies a minimal secure set of HTTP response headers appropriate for a
 * backend-to-backend JSON API service.
 *
 * Headers set:
 *   X-Content-Type-Options: nosniff   — prevent MIME sniffing
 *   X-Frame-Options: DENY             — prevent clickjacking if ever browser-accessed
 *   Referrer-Policy: no-referrer      — no referrer leak on redirects
 *   Cache-Control: no-store           — API responses must not be cached
 *   Cross-Origin-Resource-Policy: same-site — defence-in-depth for CORP
 *
 * Note: CSP is intentionally omitted — it is not meaningful for a pure JSON API
 * and can break error responses depending on the proxy/browser combination.
 */
export function securityHeadersMiddleware(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  next();
}
