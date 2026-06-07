/**
 * canonicalRequest — S9.4: deterministic canonical request builder for HMAC signing.
 *
 * Canonical string format (NF-HMAC-SHA256-V1):
 *
 *   NF-HMAC-SHA256-V1\n
 *   <timestamp_unix_ms>\n
 *   <nonce>\n
 *   <METHOD>\n
 *   <path>\n
 *   <canonical_query>\n
 *   <body_sha256_hex>
 *
 * Rules:
 *   - Timestamp: Unix milliseconds as decimal string.
 *   - Nonce: unique random string provided by the caller.
 *   - METHOD: HTTP verb in uppercase (GET, POST, PUT, PATCH, DELETE).
 *   - path: request path without scheme or host (e.g. /v1/payment-intents).
 *   - canonical_query: query string keys sorted lexicographically, values percent-encoded.
 *     Keys with no value are represented as key=. Multiple values for the same key
 *     are sorted by value. Format: key=value&key2=value2 (no leading ?).
 *   - body_sha256_hex: lowercase hex SHA-256 digest of the raw request body bytes.
 *     Empty body → SHA-256 of empty string (stable known value).
 *
 * Signature algorithm: HMAC-SHA256(signingSecret, canonicalString)
 * Signature encoding: lowercase hex.
 * Signature version header: v1
 *
 * Shared by service verification and SDK signing — both must produce identical
 * canonical strings for the same inputs.
 */

import { createHash, createHmac } from 'node:crypto';

export const SIGNATURE_VERSION = 'v1' as const;
export const CANONICAL_ALGORITHM = 'NF-HMAC-SHA256-V1' as const;

export const EMPTY_BODY_HASH = createHash('sha256').update('').digest('hex');

/**
 * hashBody — compute SHA-256 hex digest of raw body bytes.
 * Pass a Buffer or Uint8Array for request body bytes.
 * For empty or missing body, returns EMPTY_BODY_HASH.
 */
export function hashBody(body: Buffer | Uint8Array | string | null | undefined): string {
  if (body == null || (typeof body !== 'string' && !Buffer.isBuffer(body) && !(body instanceof Uint8Array))) {
    return EMPTY_BODY_HASH;
  }
  if (typeof body === 'string' && body.length === 0) return EMPTY_BODY_HASH;
  if ((Buffer.isBuffer(body) || body instanceof Uint8Array) && body.length === 0) return EMPTY_BODY_HASH;
  return createHash('sha256').update(body).digest('hex');
}

/**
 * canonicalQuery — produce a deterministic canonical query string from a
 * query parameter record or raw query string.
 *
 * Sorting: keys are sorted lexicographically. When a key has multiple values,
 * each value is included as a separate pair, sorted by value.
 * Encoding: keys and values are percent-encoded using encodeURIComponent.
 * Empty value: key= (with trailing equals).
 * Result: joined with &, no leading ?.
 */
export function canonicalQuery(query: Record<string, string | string[] | undefined> | string): string {
  let pairs: [string, string][];

  if (typeof query === 'string') {
    const raw = query.startsWith('?') ? query.slice(1) : query;
    if (!raw) return '';
    pairs = raw.split('&').map((part) => {
      const eq = part.indexOf('=');
      if (eq === -1) return [decodeURIComponent(part), ''] as [string, string];
      return [
        decodeURIComponent(part.slice(0, eq)),
        decodeURIComponent(part.slice(eq + 1)),
      ] as [string, string];
    });
  } else {
    pairs = [];
    for (const [key, val] of Object.entries(query)) {
      if (val === undefined) continue;
      if (Array.isArray(val)) {
        for (const v of val) {
          pairs.push([key, v]);
        }
      } else {
        pairs.push([key, val]);
      }
    }
  }

  pairs.sort((a, b) => {
    const keyDiff = a[0].localeCompare(b[0]);
    if (keyDiff !== 0) return keyDiff;
    return a[1].localeCompare(b[1]);
  });

  return pairs
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

export interface CanonicalRequestInput {
  timestampMs: number;
  nonce: string;
  method: string;
  path: string;
  query?: Record<string, string | string[] | undefined> | string;
  bodyHash: string;
}

/**
 * buildCanonicalString — produce the canonical string to be HMAC-signed.
 */
export function buildCanonicalString(input: CanonicalRequestInput): string {
  const cq = canonicalQuery(input.query ?? {});
  return [
    CANONICAL_ALGORITHM,
    String(input.timestampMs),
    input.nonce,
    input.method.toUpperCase(),
    input.path,
    cq,
    input.bodyHash,
  ].join('\n');
}

/**
 * computeSignature — HMAC-SHA256 of the canonical string, returned as lowercase hex.
 *
 * @param signingSecret  raw signing secret (plaintext) — never log this
 * @param canonicalStr   output of buildCanonicalString
 */
export function computeSignature(signingSecret: string, canonicalStr: string): string {
  return createHmac('sha256', signingSecret).update(canonicalStr).digest('hex');
}

/**
 * signRequest — convenience: build canonical string and compute signature in one step.
 */
export function signRequest(
  signingSecret: string,
  input: CanonicalRequestInput,
): { signature: string; canonicalString: string } {
  const canonicalString = buildCanonicalString(input);
  const signature = computeSignature(signingSecret, canonicalString);
  return { signature, canonicalString };
}
