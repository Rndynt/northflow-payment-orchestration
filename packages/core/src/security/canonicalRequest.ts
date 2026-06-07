/**
 * canonicalRequest — S9.4: deterministic canonical request builder for HMAC signing.
 *
 * Cross-environment: uses the Web Crypto API (globalThis.crypto) which is available
 * in Node.js 18+, modern browsers, and edge runtimes. No node:crypto dependency.
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

export const SIGNATURE_VERSION = 'v1' as const;
export const CANONICAL_ALGORITHM = 'NF-HMAC-SHA256-V1' as const;

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return toHex(digest);
}

export const EMPTY_BODY_HASH: string = (() => {
  // Pre-computed SHA-256 of empty string — stable, well-known value.
  // Avoids async initialization at module load time.
  return 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
})();

/**
 * hashBody — compute SHA-256 hex digest of raw body bytes.
 * Synchronous for empty/null bodies (returns EMPTY_BODY_HASH).
 * Returns a Promise for non-empty bodies.
 */
export function hashBody(body: Buffer | Uint8Array | string | null | undefined): string | Promise<string> {
  if (body == null) return EMPTY_BODY_HASH;
  if (typeof body === 'string') {
    if (body.length === 0) return EMPTY_BODY_HASH;
    return sha256Hex(body);
  }
  if (body instanceof Uint8Array || (typeof Buffer !== 'undefined' && Buffer.isBuffer(body))) {
    if (body.length === 0) return EMPTY_BODY_HASH;
    return sha256Hex(body as Uint8Array);
  }
  return EMPTY_BODY_HASH;
}

/**
 * hashBodySync — synchronous hash for service-side use where body bytes are
 * already available as a Buffer. Falls back to EMPTY_BODY_HASH for empty/null.
 * NOTE: This is provided for backward compatibility. Prefer hashBodyAsync when possible.
 */
export function hashBodySync(body: Buffer | Uint8Array | string | null | undefined): string {
  if (body == null) return EMPTY_BODY_HASH;
  if (typeof body === 'string' && body.length === 0) return EMPTY_BODY_HASH;
  if ((body instanceof Uint8Array || (typeof Buffer !== 'undefined' && Buffer.isBuffer(body))) && body.length === 0) {
    return EMPTY_BODY_HASH;
  }
  // For non-empty bodies in sync context, we use the Node.js crypto module if available.
  // This path is only hit on the server side (service/worker), never in the browser.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nodeCrypto = require('crypto') as typeof import('crypto');
    return nodeCrypto.createHash('sha256').update(body as Buffer).digest('hex');
  } catch {
    // Browser environment — synchronous hashing not available for non-empty bodies.
    // Callers should use hashBodyAsync instead.
    throw new Error('hashBodySync: non-empty body hashing requires Node.js crypto. Use hashBodyAsync in browser environments.');
  }
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
 * Returns a Promise (uses Web Crypto API — works in browsers and Node.js 18+).
 *
 * @param signingSecret  raw signing secret (plaintext) — never log this
 * @param canonicalStr   output of buildCanonicalString
 */
export async function computeSignature(signingSecret: string, canonicalStr: string): Promise<string> {
  const keyBytes = new TextEncoder().encode(signingSecret);
  const msgBytes = new TextEncoder().encode(canonicalStr);
  const cryptoKey = await globalThis.crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await globalThis.crypto.subtle.sign('HMAC', cryptoKey, msgBytes);
  return toHex(sig);
}

/**
 * computeSignatureSync — synchronous HMAC-SHA256 for server-side use only.
 * Uses Node.js crypto module via require(). Throws in browser environments.
 */
export function computeSignatureSync(signingSecret: string, canonicalStr: string): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nodeCrypto = require('crypto') as typeof import('crypto');
    return nodeCrypto.createHmac('sha256', signingSecret).update(canonicalStr).digest('hex');
  } catch {
    throw new Error('computeSignatureSync: requires Node.js crypto. Use computeSignature (async) in browser environments.');
  }
}

/**
 * signRequest — convenience: build canonical string and compute signature in one step.
 * Async — uses Web Crypto API (browser + Node.js 18+).
 */
export async function signRequest(
  signingSecret: string,
  input: CanonicalRequestInput,
): Promise<{ signature: string; canonicalString: string }> {
  const canonicalString = buildCanonicalString(input);
  const signature = await computeSignature(signingSecret, canonicalString);
  return { signature, canonicalString };
}
