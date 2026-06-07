/**
 * requireAnyScope — Express middleware that accepts any ONE of the provided scopes.
 *
 * Strategy (S7.5):
 * - If req.auth?.scopes includes '*' (wildcard, internal/legacy), always passes.
 * - If req.auth?.scopes contains any of the provided scopeList, passes.
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
import type { RequestAuthContext } from '../types/auth.ts';

export function requireAnyScope(...scopeList: string[]) {
  return function requireAnyScopeMiddleware(req: Request, res: Response, next: NextFunction) {
    const auth = req.auth as RequestAuthContext | undefined;

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

    const tokenScopes: string[] = auth.scopes ?? [];

    // Wildcard scope (internal / legacy service token) — always passes.
    if (tokenScopes.includes('*')) {
      next();
      return;
    }

    // Check if any of the provided scopes are satisfied.
    const granted = scopeList.some((s) => tokenScopes.includes(s));

    if (!granted) {
      res.status(403).json({
        ok: false,
        error: {
          code: 'FORBIDDEN',
          message: `Insufficient scope. Required one of: ${scopeList.join(', ')}. Token has: ${tokenScopes.join(' ') || '(none)'}`,
          details: null,
        },
      });
      return;
    }

    next();
  };
}
