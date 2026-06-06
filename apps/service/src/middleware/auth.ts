/**
 * auth — S2: per-client credential authentication middleware.
 *
 * Token format: nf_{8-char-prefix}_{random-hex}
 * Lookup: find credentials by prefix, hash presented token, compare with timingSafeEqual.
 *
 * Resolution order:
 *   1. Authorization: Bearer <token>  (primary)
 *   2. x-payment-orchestration-service-token  (legacy header alias)
 *   3. x-payment-engine-service-token  (legacy header alias)
 *
 * Legacy mode: PAYMENT_ORCHESTRATION_LEGACY_SERVICE_TOKEN_ENABLED=true
 *   - Allows the old shared service token to authorize protected routes.
 *   - Sets req.auth.clientId='legacy', scopes=['*'].
 *   - Disabled by default in production.
 *
 * S2: req.auth attached on success with clientId, sourceApp, environment, credentialId, scopes.
 */

import { createHash, timingSafeEqual } from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { apiErrorResponse } from '../routes/utils.ts';
import type { ClientCredentialRepository, ApiClientRepository } from '@northflow/payment-orchestration-core';
import type { RequestAuthContext } from '../types/auth.ts';

export function hashCredential(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export function extractCredentialPrefix(token: string): string | null {
  // Format: nf_{prefix}_{random} — prefix is always "nf_" + next segment
  const parts = token.split('_');
  if (parts.length < 3 || parts[0] !== 'nf') return null;
  return `nf_${parts[1]}`;
}

function safeEqual(a: string, b: string): boolean {
  try {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ab.length !== bb.length) return false;
    return timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}

function extractToken(req: Request): string | null {
  const auth = req.headers['authorization'];
  if (typeof auth === 'string') {
    const match = auth.match(/^Bearer\s+(.+)$/i);
    if (match) return match[1].trim();
  }
  const legacy1 = req.headers['x-payment-orchestration-service-token'];
  if (typeof legacy1 === 'string' && legacy1) return legacy1;
  const legacy2 = req.headers['x-payment-engine-service-token'];
  if (typeof legacy2 === 'string' && legacy2) return legacy2;
  return null;
}

export interface AuthMiddlewareOptions {
  serviceToken: string;
  nodeEnv: string;
  legacyEnabled: boolean;
  /** Optional — when absent the per-client path is skipped and only legacy token auth is attempted. */
  credentialRepo?: ClientCredentialRepository;
  /** Optional — when absent the per-client path is skipped and only legacy token auth is attempted. */
  clientRepo?: ApiClientRepository;
}

export function createAuthMiddleware(options: AuthMiddlewareOptions) {
  const { serviceToken, nodeEnv, legacyEnabled, credentialRepo, clientRepo } = options;

  if (!serviceToken && nodeEnv === 'production' && !legacyEnabled) {
    console.warn('[payment-orchestration-service/auth] No legacy service token configured — per-client credentials required.');
  }

  return async function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
    const token = extractToken(req);

    if (!token) {
      res.status(401).json(apiErrorResponse('UNAUTHORIZED', 'Missing authentication credential.'));
      return;
    }

    // ── Per-client credential path ─────────────────────────────────────────────
    const prefix = extractCredentialPrefix(token);
    if (prefix && credentialRepo && clientRepo) {
      try {
        const candidates = await credentialRepo.findByPrefix(prefix);
        const presented = hashCredential(token);

        for (const cred of candidates) {
          if (!safeEqual(presented, cred.credentialHash)) continue;

          if (cred.status === 'revoked') {
            res.status(401).json(apiErrorResponse('UNAUTHORIZED', 'Credential has been revoked.'));
            return;
          }
          if (cred.status === 'expired' || (cred.expiresAt && cred.expiresAt < new Date())) {
            res.status(401).json(apiErrorResponse('UNAUTHORIZED', 'Credential has expired.'));
            return;
          }

          const client = await clientRepo.findById(cred.clientId);
          if (!client || client.status !== 'active') {
            res.status(401).json(apiErrorResponse('UNAUTHORIZED', 'API client is inactive or not found.'));
            return;
          }

          // Touch last-used asynchronously — do not await to avoid latency
          credentialRepo.touchLastUsed(cred.id, new Date()).catch(() => {});

          const auth: RequestAuthContext = {
            clientId: client.id,
            sourceApp: client.sourceApp,
            environment: client.environment,
            credentialId: cred.id,
            scopes: client.scopes,
          };
          req.auth = auth;
          next();
          return;
        }
      } catch (err) {
        next(err);
        return;
      }
    }

    // ── Legacy shared service token (optional backward-compat fallback) ─────────
    if (legacyEnabled && serviceToken) {
      try {
        const tokenBuf = Buffer.from(token);
        const configuredBuf = Buffer.from(serviceToken);
        if (
          tokenBuf.length === configuredBuf.length &&
          timingSafeEqual(tokenBuf, configuredBuf)
        ) {
          const auth: RequestAuthContext = {
            clientId: 'legacy',
            sourceApp: 'internal',
            environment: nodeEnv,
            credentialId: 'legacy',
            scopes: ['*'],
          };
          req.auth = auth;
          next();
          return;
        }
      } catch {
        // fall through
      }
    }

    res.status(401).json(apiErrorResponse('UNAUTHORIZED', 'Invalid or missing credential.'));
  };
}

/**
 * generateCredential — create a new nf_ prefixed token.
 * Returns raw (shown once), prefix (stored), and hash (stored).
 * Never log or persist raw.
 */
export function generateCredential(clientIdShort: string): {
  raw: string;
  prefix: string;
  hash: string;
} {
  const { randomBytes } = require('crypto') as typeof import('crypto');
  const rand = randomBytes(24).toString('hex');
  const prefix = `nf_${clientIdShort.slice(0, 8)}`;
  const raw = `${prefix}_${rand}`;
  const hash = hashCredential(raw);
  return { raw, prefix, hash };
}
