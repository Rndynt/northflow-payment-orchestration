/**
 * requireScope — S5: scope-based authorization middleware factory.
 *
 * Usage: router.post('/', requireScope('merchant:create'), handler)
 *
 * Legacy clients with scopes=['*'] pass all scope checks.
 * Returns 403 SCOPE_DENIED if the required scope is missing.
 */

import type { Request, Response, NextFunction } from 'express';
import { apiErrorResponse } from '../routes/utils.ts';

export function requireScope(scope: string) {
  return function scopeMiddleware(req: Request, res: Response, next: NextFunction): void {
    const auth = req.auth;
    if (!auth) {
      res.status(401).json(apiErrorResponse('UNAUTHORIZED', 'Not authenticated.'));
      return;
    }
    if (auth.scopes.includes('*') || auth.scopes.includes(scope)) {
      next();
      return;
    }
    res.status(403).json(apiErrorResponse('SCOPE_DENIED', `Missing required scope: ${scope}`));
  };
}
