/**
 * requireAnyScope — Express middleware that accepts any ONE of the provided scopes.
 *
 * Strategy (S7.5):
 * - If req.auth?.scope is '*' (wildcard, internal/legacy), always passes.
 * - If req.auth?.scope matches any of the provided scopeList, passes.
 * - Otherwise returns 403 FORBIDDEN.
 *
 * This allows routes to accept both new S7.5 scopes (e.g. payment_method:read)
 * AND existing scopes that serve as fallbacks (e.g. provider_account:read)
 * without requiring clients to re-credential immediately.
 *
 * Usage:
 *   router.get('/...', requireAnyScope('payment_method:read', 'provider_account:read'), handler)
 */

import type { Request, Response, NextFunction } from 'express';

export function requireAnyScope(...scopeList: string[]) {
  return function requireAnyScopeMiddleware(req: Request, res: Response, next: NextFunction) {
    const auth = (req as any).auth as { scope?: string } | undefined;

    if (!auth) {
      res.status(401).json({
        ok: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication is required.',
          details: null,
        },
      });
      return;
    }

    const tokenScope = auth.scope ?? '';

    // Wildcard scope (internal / legacy service token) — always passes.
    if (tokenScope === '*') {
      next();
      return;
    }

    // Check if any of the provided scopes are satisfied.
    const tokenScopes = tokenScope.split(/[\s,]+/).filter(Boolean);
    const granted = scopeList.some((s) => tokenScopes.includes(s));

    if (!granted) {
      res.status(403).json({
        ok: false,
        error: {
          code: 'FORBIDDEN',
          message: `Insufficient scope. Required one of: ${scopeList.join(', ')}. Token has: ${tokenScope || '(none)'}`,
          details: null,
        },
      });
      return;
    }

    next();
  };
}
