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
 * S9.2: auth failure rate limiting — IP + credential prefix counters.
 *   - Invalid auth attempts are counted per-IP and optionally per-prefix.
 *   - When threshold exceeded, 429 RATE_LIMITED is returned instead of 401.
 *   - Prefix counting never reveals whether a prefix exists in the database.
 */

import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { apiErrorResponse } from '../routes/utils.ts';
import type { ClientCredentialRepository, ApiClientRepository } from '@northflow/payment-orchestration-core';
import type { RequestAuthContext } from '../types/auth.ts';
import type { RateLimiterStore } from '../rate-limit/rateLimiter.ts';

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

/**
 * resolveClientIp — extracts the best-effort client IP for rate limiting.
 * Never returns credential or key material.
 */
function resolveClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0]?.trim() ?? req.socket?.remoteAddress ?? 'unknown';
  }
  return req.socket?.remoteAddress ?? 'unknown';
}

export interface AuthMiddlewareOptions {
  serviceToken: string;
  nodeEnv: string;
  legacyEnabled: boolean;
  /** Optional — when absent only legacy token auth is attempted. */
  credentialRepo?: ClientCredentialRepository;
  /** Optional — when absent only legacy token auth is attempted. */
  clientRepo?: ApiClientRepository;
  /** S9.2: Optional rate limiter for auth failure tracking. */
  rateLimiter?: RateLimiterStore;
  /** S9.2: Whether auth failure rate limiting is enabled. */
  authFailureRateLimitEnabled?: boolean;
  /** S9.2: Max failed auth attempts per IP per minute before 429. */
  authFailurePerMinute?: number;
}

export function createAuthMiddleware(options: AuthMiddlewareOptions) {
  const {
    serviceToken,
    nodeEnv,
    legacyEnabled,
    credentialRepo,
    clientRepo,
    rateLimiter,
    authFailureRateLimitEnabled = false,
    authFailurePerMinute = 30,
  } = options;

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
            await applyAuthFailureRateLimit(req, res, token, prefix, rateLimiter, authFailureRateLimitEnabled, authFailurePerMinute);
            if (res.headersSent) return;
            res.status(401).json(apiErrorResponse('UNAUTHORIZED', 'Credential has been revoked.'));
            return;
          }
          if (cred.status === 'expired' || (cred.expiresAt && cred.expiresAt < new Date())) {
            await applyAuthFailureRateLimit(req, res, token, prefix, rateLimiter, authFailureRateLimitEnabled, authFailurePerMinute);
            if (res.headersSent) return;
            res.status(401).json(apiErrorResponse('UNAUTHORIZED', 'Credential has expired.'));
            return;
          }

          const client = await clientRepo.findById(cred.clientId);
          if (!client || client.status !== 'active') {
            await applyAuthFailureRateLimit(req, res, token, prefix, rateLimiter, authFailureRateLimitEnabled, authFailurePerMinute);
            if (res.headersSent) return;
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

    // ── Auth failure — apply rate limiting before returning 401 ───────────────
    await applyAuthFailureRateLimit(req, res, token, prefix, rateLimiter, authFailureRateLimitEnabled, authFailurePerMinute);
    if (res.headersSent) return;

    res.status(401).json(apiErrorResponse('UNAUTHORIZED', 'Invalid or missing credential.'));
  };
}

/**
 * applyAuthFailureRateLimit — S9.2 helper.
 *
 * Increments IP-based and (if parseable) prefix-based auth failure counters.
 * If the IP counter is exceeded, sends a 429 response and returns.
 * If the response was already sent (res.headersSent), the caller must return.
 *
 * Security invariants:
 *   - Prefix counter is incremented regardless of whether the prefix exists in DB.
 *   - Callers cannot distinguish "prefix not found" from "rate limited".
 *   - No sensitive token material is stored in the rate limit key beyond the prefix.
 */
async function applyAuthFailureRateLimit(
  req: Request,
  res: Response,
  _token: string,
  prefix: string | null,
  rateLimiter: RateLimiterStore | undefined,
  enabled: boolean,
  authFailurePerMinute: number,
): Promise<void> {
  if (!rateLimiter || !enabled) return;

  const windowMs = 60_000;
  const ip = resolveClientIp(req);

  try {
    const ipResult = await rateLimiter.hit(`ip:${ip}:auth_fail`, windowMs, authFailurePerMinute);

    // Also count by prefix (best-effort, don't let it block the response).
    if (prefix) {
      void rateLimiter.hit(`credential_prefix:${prefix}:auth_fail`, windowMs, authFailurePerMinute).catch(() => {});
    }

    if (!ipResult.allowed) {
      res
        .status(429)
        .set('Retry-After', String(ipResult.retryAfterSeconds))
        .set('X-RateLimit-Limit', String(authFailurePerMinute))
        .set('X-RateLimit-Remaining', '0')
        .set('X-RateLimit-Reset', String(Math.floor(ipResult.resetAt.getTime() / 1000)))
        .json(apiErrorResponse('RATE_LIMITED', 'Too many authentication failures. Please wait before retrying.'));
    }
  } catch {
    // Best-effort: rate limiter failures must not block auth responses.
  }
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
/**
 * Allowed character patterns for credential components (P1.2):
 *   environment  — lowercase letters, digits, hyphen only  (e.g. "live", "sandbox", "prod-1")
 *   credentialId — letters, digits, hyphen only            (e.g. "abc123", "credA1", "cred-42")
 *
 * Rejected for BOTH fields: empty values, dots, whitespace, slashes, underscores,
 * and any character that could break the nf.<env>.<id>.<secret> dot-split parsing
 * or introduce ambiguity with legacy underscore-based credential formats.
 *
 * Underscores are explicitly rejected: the old format used them as delimiters
 * (nf_{prefix}_{secret}). Disallowing them keeps components unambiguous and URL-safe.
 */
const ENV_RE = /^[a-z0-9-]+$/;
const CRED_ID_RE = /^[a-zA-Z0-9-]+$/;

export function generateCredential(
  environment: string,
  credentialId: string,
): { raw: string; prefix: string; hash: string } {
  if (!environment || !ENV_RE.test(environment)) {
    throw new Error(
      `[generateCredential] Invalid environment "${environment}": must be non-empty and match /^[a-z0-9-]+$/`,
    );
  }
  if (!credentialId || !CRED_ID_RE.test(credentialId)) {
    throw new Error(
      `[generateCredential] Invalid credentialId "${credentialId}": must be non-empty and match /^[a-zA-Z0-9-]+$/ (letters, digits, hyphen only — no underscores, dots, or whitespace)`,
    );
  }
  const secret = randomBytes(32).toString('base64url');
  const prefix = `nf.${environment}.${credentialId}`;
  const raw = `${prefix}.${secret}`;
  const hash = hashCredential(raw);
  return { raw, prefix, hash };
}
