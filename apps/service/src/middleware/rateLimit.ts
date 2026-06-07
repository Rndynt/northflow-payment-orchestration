/**
 * rateLimit — S9.2: rate-limit middleware for authenticated /v1 routes.
 *
 * Applied AFTER auth middleware so req.auth is available.
 * Checks two limits per request:
 *   1. Global per-client limit  (all routes)
 *   2. Per-route per-client limit (sensitive route groups)
 *
 * Response headers on every authenticated request:
 *   X-RateLimit-Limit      — effective limit for the most restrictive bucket
 *   X-RateLimit-Remaining  — remaining requests in the current window
 *   X-RateLimit-Reset      — Unix timestamp (seconds) when the window resets
 *
 * On 429:
 *   Retry-After            — seconds until the window resets
 *   body: { ok: false, error: { code: 'RATE_LIMITED', message: '...', details: null } }
 *
 * Route groups used for per-route keys:
 *   gateway_payment.create, payment.refund, payment.void, payment.reconcile,
 *   payment_method.sync, api_client.credential.create, api_client.credential.rotate,
 *   api_client.credential.revoke, default
 */

import type { Request, Response, NextFunction } from 'express';
import type { RateLimiterStore, RateLimitResult } from '../rate-limit/rateLimiter.ts';
import type { ServiceContainer } from '../container.ts';
import { apiErrorResponse } from '../routes/utils.ts';
import { auditDenied } from '../audit/auditService.ts';
import { AuditAction } from '../audit/auditActions.ts';

// ── Route group resolution ─────────────────────────────────────────────────────

function resolveRouteGroup(method: string, path: string): string {
  if (/\/v1\/api-clients\/[^/]+\/credentials\/[^/]+\/revoke/.test(path)) {
    return 'api_client.credential.revoke';
  }
  if (/\/v1\/api-clients\/[^/]+\/credentials\/rotate/.test(path)) {
    return 'api_client.credential.rotate';
  }
  if (/\/v1\/api-clients\/[^/]+\/credentials/.test(path) && method === 'POST') {
    return 'api_client.credential.create';
  }
  if (/\/v1\/api-clients\/[^/]+\/credentials/.test(path) && method === 'GET') {
    return 'api_client.credential.read';
  }
  if (/\/v1\/payment-intents\/[^/]+\/gateway-payments/.test(path) && method === 'POST') {
    return 'gateway_payment.create';
  }
  if (/\/v1\/payment-transactions\/[^/]+\/refund/.test(path)) {
    return 'payment.refund';
  }
  if (/\/v1\/payment-transactions\/[^/]+\/void/.test(path)) {
    return 'payment.void';
  }
  if (/\/v1\/payment-transactions\/[^/]+\/reconcile/.test(path)) {
    return 'payment.reconcile';
  }
  if (/\/v1\/merchants\/[^/]+\/provider-accounts\/[^/]+\/payment-methods\/sync/.test(path)) {
    return 'payment_method.sync';
  }
  return 'default';
}

// ── Header helpers ─────────────────────────────────────────────────────────────

function applyRateLimitHeaders(res: Response, result: RateLimitResult): void {
  res.setHeader('X-RateLimit-Limit', result.limit);
  res.setHeader('X-RateLimit-Remaining', result.remaining);
  res.setHeader('X-RateLimit-Reset', Math.floor(result.resetAt.getTime() / 1000));
}

// ── Middleware factory ─────────────────────────────────────────────────────────

export interface RateLimitConfig {
  enabled: boolean;
  clientGlobalPerMinute: number;
  clientRoutePerMinute: number;
}

export function createRateLimitMiddleware(
  rateLimiter: RateLimiterStore,
  config: RateLimitConfig,
  container: ServiceContainer,
) {
  const windowMs = 60_000; // 1-minute fixed window

  return async function rateLimitMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    if (!config.enabled) {
      next();
      return;
    }

    const auth = req.auth;
    if (!auth) {
      // Not authenticated — auth middleware will handle this.
      next();
      return;
    }

    const clientId = auth.clientId;
    const routeGroup = resolveRouteGroup(req.method, req.path);

    try {
      // ── 1. Global per-client limit ───────────────────────────────────────
      const globalResult = await rateLimiter.hit(
        `client:${clientId}:global`,
        windowMs,
        config.clientGlobalPerMinute,
      );

      applyRateLimitHeaders(res, globalResult);

      if (!globalResult.allowed) {
        void auditDenied(req, container, {
          action: AuditAction.RATE_LIMIT_DENIED,
          metadata: {
            routeGroup,
            limit: config.clientGlobalPerMinute,
            resetAt: globalResult.resetAt.toISOString(),
            clientId,
            bucket: 'global',
          },
        });
        res
          .status(429)
          .set('Retry-After', String(globalResult.retryAfterSeconds))
          .json(apiErrorResponse('RATE_LIMITED', 'Global rate limit exceeded. Please slow down.'));
        return;
      }

      // ── 2. Per-route per-client limit ────────────────────────────────────
      const routeResult = await rateLimiter.hit(
        `client:${clientId}:route:${req.method}:${routeGroup}`,
        windowMs,
        config.clientRoutePerMinute,
      );

      // Apply the more restrictive header values (route limit may be lower).
      applyRateLimitHeaders(res, routeResult);

      if (!routeResult.allowed) {
        void auditDenied(req, container, {
          action: AuditAction.RATE_LIMIT_DENIED,
          metadata: {
            routeGroup,
            limit: config.clientRoutePerMinute,
            resetAt: routeResult.resetAt.toISOString(),
            clientId,
            bucket: 'route',
          },
        });
        res
          .status(429)
          .set('Retry-After', String(routeResult.retryAfterSeconds))
          .json(
            apiErrorResponse(
              'RATE_LIMITED',
              `Route rate limit exceeded for ${routeGroup}. Please slow down.`,
            ),
          );
        return;
      }

      next();
    } catch (err) {
      // Rate limiter failures must never block legitimate requests.
      console.error('[rate-limit] Rate limiter error — allowing request through:', err);
      next();
    }
  };
}
