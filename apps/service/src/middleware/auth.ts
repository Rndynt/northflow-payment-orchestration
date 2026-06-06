/**
 * auth — S2: per-client credential authentication middleware.
 *
 * Credential format (P0.1): nf.<environment>.<credentialId>.<secret>
 *   - Dot-separated — safe even when credentialId contains no dots or underscores.
 *   - Stored prefix: nf.<environment>.<credentialId>  (deterministic, URL-safe)
 *   - Only prefix + SHA-256 hash are stored; raw secret is shown once at generation.
 *
 * Token extraction order (P0.2):
 *   1. Authorization: Bearer <token>   (primary standard header)
 *   2. x-nf-api-key: <token>           (Northflow dedicated header)
 *   3. Legacy compatibility headers     (only when legacyEnabled)
 *      x-payment-orchestration-service-token
 *      x-payment-engine-service-token
 *
 * Legacy mode: PAYMENT_ORCHESTRATION_LEGACY_SERVICE_TOKEN_ENABLED=true
 *   - Allows the old shared service token to authorize protected routes.
 *   - Sets req.auth.clientId='legacy', scopes=['*'].
 *   - Disabled by default in production.
 *
 * S2: req.auth attached on success with clientId, sourceApp, environment, credentialId, scopes.
 */

import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { apiErrorResponse } from '../routes/utils.ts';
import type { ClientCredentialRepository, ApiClientRepository } from '@northflow/payment-orchestration-core';
import type { RequestAuthContext } from '../types/auth.ts';

export function hashCredential(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/**
 * extractCredentialPrefix — P0.1 stable parser.
 *
 * Format: nf.<environment>.<credentialId>.<secret>
 * Prefix:  nf.<environment>.<credentialId>   (first 3 dot-segments)
 *
 * Returns null for any token that is not a valid nf. credential.
 */
export function extractCredentialPrefix(token: string): string | null {
  if (!token.startsWith('nf.')) return null;
  const segments = token.split('.');
  // Must have at least 4 segments: nf, environment, credentialId, secret
  if (segments.length < 4) return null;
  const env = segments[1];
  const credId = segments[2];
  if (!env || !credId) return null;
  // credentialId must not be empty and must be URL-safe (no spaces)
  if (/\s/.test(credId)) return null;
  return `nf.${env}.${credId}`;
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

/**
 * extractPrimaryToken — reads Authorization: Bearer or x-nf-api-key.
 * These are always tried regardless of legacy mode.
 */
function extractPrimaryToken(req: Request): string | null {
  const auth = req.headers['authorization'];
  if (typeof auth === 'string') {
    const match = auth.match(/^Bearer\s+(.+)$/i);
    if (match) return match[1].trim();
  }
  const nfKey = req.headers['x-nf-api-key'];
  if (typeof nfKey === 'string' && nfKey.trim()) return nfKey.trim();
  return null;
}

/**
 * extractLegacyToken — reads legacy compatibility headers.
 * Only used when legacyEnabled is true.
 */
function extractLegacyToken(req: Request): string | null {
  const h1 = req.headers['x-payment-orchestration-service-token'];
  if (typeof h1 === 'string' && h1.trim()) return h1.trim();
  const h2 = req.headers['x-payment-engine-service-token'];
  if (typeof h2 === 'string' && h2.trim()) return h2.trim();
  return null;
}

export interface AuthMiddlewareOptions {
  serviceToken: string;
  nodeEnv: string;
  legacyEnabled: boolean;
  /** Optional — when absent only legacy token auth is attempted. */
  credentialRepo?: ClientCredentialRepository;
  /** Optional — when absent only legacy token auth is attempted. */
  clientRepo?: ApiClientRepository;
}

export function createAuthMiddleware(options: AuthMiddlewareOptions) {
  const { serviceToken, nodeEnv, legacyEnabled, credentialRepo, clientRepo } = options;

  if (!serviceToken && nodeEnv === 'production' && !legacyEnabled) {
    console.warn('[payment-orchestration-service/auth] No legacy service token configured — per-client credentials required.');
  }

  return async function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
    // P0.2: primary headers always; legacy headers only if legacyEnabled
    const token = extractPrimaryToken(req) ?? (legacyEnabled ? extractLegacyToken(req) : null);

    if (!token) {
      res.status(401).json(apiErrorResponse('UNAUTHORIZED', 'Missing authentication credential.'));
      return;
    }

    // ── Per-client credential path (nf. format) ───────────────────────────────
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

    // ── Legacy shared service token (backward-compat fallback) ────────────────
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
 * generateCredential — P0.1: create a new nf.<env>.<credentialId>.<secret> token.
 *
 * Returns raw (shown once at generation, never stored), prefix (stored for DB lookup),
 * and hash (stored for constant-time verification).
 *
 * The credentialId is passed in (e.g. a UUIDv4 stripped of hyphens) — it must be
 * URL-safe and must not contain dots. The caller is responsible for storing credentialId
 * and using it as the DB record ID.
 *
 * Never log or persist raw.
 */
export function generateCredential(
  environment: string,
  credentialId: string,
): { raw: string; prefix: string; hash: string } {
  const secret = randomBytes(32).toString('base64url');
  const prefix = `nf.${environment}.${credentialId}`;
  const raw = `${prefix}.${secret}`;
  const hash = hashCredential(raw);
  return { raw, prefix, hash };
}
