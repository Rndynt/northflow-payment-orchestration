/**
 * signedAuth — S9.4: HMAC signed request verification middleware.
 *
 * Signed request headers:
 *   x-nf-client-id:         <clientId>
 *   x-nf-key-id:            <keyPrefix>
 *   x-nf-timestamp:         <unix milliseconds>
 *   x-nf-nonce:             <unique random nonce>
 *   x-nf-signature:         <lowercase hex HMAC-SHA256>
 *   x-nf-signature-version: v1
 *
 * Resolution flow (optional mode):
 *   1. If signed headers are present, attempt signed request auth.
 *   2. If signed auth succeeds, attach req.auth and continue.
 *   3. If signed headers are present but auth fails, reject (do NOT fall back to bearer).
 *   4. If no signed headers, fall back to bearer/API key auth.
 *
 * Resolution flow (required mode):
 *   1. Missing signed headers → 401 SIGNED_REQUEST_REQUIRED.
 *   2. Bearer-only auth is rejected for protected /v1 routes.
 *
 * Security invariants:
 *   - Raw signing secret is NEVER logged.
 *   - Nonce is consumed atomically after signature and timestamp are verified.
 *   - Nonce store failure → fail closed (do not allow signed auth to succeed).
 *   - lastUsedAt is updated on the signing key after successful auth.
 *   - Rate limiting applies regardless of auth method.
 */

import { timingSafeEqual } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import type { RequestAuthContext } from '../types/auth.ts';
import { apiErrorResponse } from '../routes/utils.ts';
import { decrypt } from '../security/signingSecretProtector.ts';
import {
  buildCanonicalString,
  computeSignature,
  hashBody,
  SIGNATURE_VERSION,
} from '@northflow/payment-orchestration-core';
import type { DrizzleClientSigningKeyRepository } from '../infrastructure/repositories/DrizzleClientSigningKeyRepository.ts';
import type { DrizzleRequestNonceRepository } from '../infrastructure/repositories/DrizzleRequestNonceRepository.ts';
import type { ApiClientRepository } from '@northflow/payment-orchestration-core';

export const SIGNED_REQUEST_HEADERS = [
  'x-nf-client-id',
  'x-nf-key-id',
  'x-nf-timestamp',
  'x-nf-nonce',
  'x-nf-signature',
  'x-nf-signature-version',
] as const;

export function hasSignedRequestHeaders(req: Request): boolean {
  return (
    typeof req.headers['x-nf-client-id'] === 'string' ||
    typeof req.headers['x-nf-signature'] === 'string' ||
    typeof req.headers['x-nf-key-id'] === 'string'
  );
}

export interface SignedAuthOptions {
  signingKeyRepo: DrizzleClientSigningKeyRepository;
  nonceRepo: DrizzleRequestNonceRepository;
  clientRepo: ApiClientRepository;
  maxSkewMs: number;
  nonceTtlMs: number;
}

/**
 * verifySignedRequest — verify HMAC headers against the stored signing key.
 *
 * Returns the resolved RequestAuthContext on success.
 * Returns a string error code on failure (caller responds with 401).
 */
export async function verifySignedRequest(
  req: Request,
  options: SignedAuthOptions,
): Promise<RequestAuthContext | string> {
  const {
    signingKeyRepo,
    nonceRepo,
    clientRepo,
    maxSkewMs,
    nonceTtlMs,
  } = options;

  const clientId = req.headers['x-nf-client-id'];
  const keyId = req.headers['x-nf-key-id'];
  const timestampStr = req.headers['x-nf-timestamp'];
  const nonce = req.headers['x-nf-nonce'];
  const signature = req.headers['x-nf-signature'];
  const sigVersion = req.headers['x-nf-signature-version'];

  if (
    typeof clientId !== 'string' || !clientId.trim() ||
    typeof keyId !== 'string' || !keyId.trim() ||
    typeof timestampStr !== 'string' || !timestampStr.trim() ||
    typeof nonce !== 'string' || !nonce.trim() ||
    typeof signature !== 'string' || !signature.trim() ||
    typeof sigVersion !== 'string' || !sigVersion.trim()
  ) {
    return 'SIGNED_REQUEST_HEADERS_MISSING';
  }

  if (sigVersion.trim() !== SIGNATURE_VERSION) {
    return 'SIGNED_REQUEST_SIGNATURE_INVALID';
  }

  const timestampMs = Number(timestampStr.trim());
  if (!Number.isInteger(timestampMs) || isNaN(timestampMs) || timestampMs <= 0) {
    return 'SIGNED_REQUEST_TIMESTAMP_INVALID';
  }

  const now = Date.now();
  const skew = Math.abs(now - timestampMs);
  if (skew > maxSkewMs) {
    return 'SIGNED_REQUEST_TIMESTAMP_EXPIRED';
  }

  const candidateKeys = await signingKeyRepo.findByPrefixWithCiphertext(keyId.trim());
  const matchingKey = candidateKeys.find((k) => k.clientId === clientId.trim());
  if (!matchingKey) {
    return 'SIGNED_REQUEST_KEY_NOT_FOUND';
  }

  if (matchingKey.status === 'revoked') {
    return 'SIGNED_REQUEST_KEY_REVOKED';
  }
  if (
    matchingKey.status === 'expired' ||
    (matchingKey.expiresAt && matchingKey.expiresAt < new Date())
  ) {
    return 'SIGNED_REQUEST_KEY_EXPIRED';
  }

  let rawSecret: string;
  try {
    rawSecret = decrypt(matchingKey.secretCiphertext);
  } catch {
    return 'SIGNED_REQUEST_SECRET_UNAVAILABLE';
  }

  const rawBody: Buffer | undefined = (req as any).rawBody;
  const bodyHash = hashBody(rawBody ?? null);

  const path = req.baseUrl + req.path;
  const query = req.query as Record<string, string | string[] | undefined>;

  const canonicalStr = buildCanonicalString({
    timestampMs,
    nonce: nonce.trim(),
    method: req.method,
    path,
    query,
    bodyHash,
  });

  const expected = computeSignature(rawSecret, canonicalStr);

  let sigMatches = false;
  try {
    const expBuf = Buffer.from(expected, 'hex');
    const recvStr = signature.trim().toLowerCase();
    const recvBuf = Buffer.from(recvStr, 'hex');
    if (expBuf.length === recvBuf.length) {
      sigMatches = timingSafeEqual(expBuf, recvBuf);
    }
  } catch {
    sigMatches = false;
  }

  if (!sigMatches) {
    return 'SIGNED_REQUEST_SIGNATURE_INVALID';
  }

  const timestampDate = new Date(timestampMs);
  const expiresAt = new Date(timestampMs + nonceTtlMs);

  let nonceConsumed: boolean;
  try {
    const result = await nonceRepo.consume({
      id: randomUUID(),
      clientId: clientId.trim(),
      signingKeyId: matchingKey.id,
      nonce: nonce.trim(),
      timestamp: timestampDate,
      expiresAt,
    });
    nonceConsumed = result.consumed;
  } catch {
    return 'SIGNED_REQUEST_SECRET_UNAVAILABLE';
  }

  if (!nonceConsumed) {
    return 'SIGNED_REQUEST_NONCE_REPLAYED';
  }

  const client = await clientRepo.findById(clientId.trim());
  if (!client || client.status !== 'active') {
    return 'SIGNED_REQUEST_KEY_NOT_FOUND';
  }

  signingKeyRepo.touchLastUsed(matchingKey.id, new Date()).catch(() => {});

  const auth: RequestAuthContext = {
    clientId: client.id,
    sourceApp: client.sourceApp,
    environment: client.environment,
    credentialId: matchingKey.id,
    scopes: client.scopes,
  };

  return auth;
}
