/**
 * signingSecretProtector — S9.4: AES-256-GCM encryption for signing key secrets.
 *
 * The encryption master key is read from:
 *   PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_SECRET
 *
 * Key version is tracked via:
 *   PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_KEY_VERSION  (default: v1)
 *
 * Security invariants:
 *   - The encryption secret is NEVER logged.
 *   - The encryption secret is NEVER returned from /ready, /version, or audit metadata.
 *   - If the encryption secret is missing, encrypt() throws — key creation fails closed.
 *   - decrypt() also throws if the secret is missing.
 *   - Raw signing secrets are NEVER stored anywhere — only ciphertext.
 *
 * Ciphertext format (stored in secret_ciphertext column):
 *   <keyVersion>:<base64url(iv)>:<base64url(ciphertextWithAuthTag)>
 *
 * AES-256-GCM:
 *   - Key: 32 bytes derived from the env secret — must decode to exactly 32 bytes (base64) or be exactly 32 UTF-8 bytes. No padding or truncation.
 *   - IV: 12 random bytes per encryption.
 *   - Auth tag: 16 bytes appended to ciphertext.
 *
 * If you change the master key, existing ciphertext cannot be decrypted.
 * Key rotation for the master key is out of scope for S9.4.
 */

import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
} from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

/**
 * deriveKey — derive a 32-byte Buffer from the env secret.
 *
 * Accepts exactly one of:
 *   - A base64-encoded value that decodes to exactly 32 bytes.
 *   - A raw UTF-8 string that is exactly 32 bytes long.
 *
 * Throws on any other input. Silent padding and truncation are forbidden —
 * they would allow weak or unintended key material to silently produce a
 * different effective key, breaking decryption correctness and key hygiene.
 */
function deriveKey(secret: string): Buffer {
  // Try base64 decode first — must produce exactly 32 bytes.
  const b64decoded = Buffer.from(secret, 'base64');
  if (b64decoded.length === 32) {
    return b64decoded;
  }

  // Fall back to raw UTF-8 — must be exactly 32 bytes.
  const utf8buf = Buffer.from(secret, 'utf8');
  if (utf8buf.length === 32) {
    return utf8buf;
  }

  throw new Error(
    '[signingSecretProtector] Encryption key must be exactly 32 bytes. ' +
    'Provide a base64-encoded 32-byte value or a 32-character ASCII/UTF-8 string. ' +
    'Silent padding and truncation are not allowed.',
  );
}

function getEncryptionSecret(): string {
  const secret = process.env['PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_SECRET'];
  if (!secret || secret.trim().length < 32) {
    throw new Error(
      '[signingSecretProtector] PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_SECRET is not configured or too short (minimum 32 characters). ' +
      'Signing key creation is disabled until this secret is set.',
    );
  }
  return secret.trim();
}

function getKeyVersion(): string {
  return (process.env['PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_KEY_VERSION'] ?? 'v1').trim();
}

/**
 * encrypt — encrypt a raw signing secret and return the stored ciphertext string.
 *
 * Throws if PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_SECRET is not configured.
 * Never logs the raw secret or the encryption key.
 */
export function encrypt(rawSecret: string): string {
  const secret = getEncryptionSecret();
  const keyVersion = getKeyVersion();
  const key = deriveKey(secret);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([
    cipher.update(rawSecret, 'utf8'),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  const ivB64 = iv.toString('base64url');
  const ctB64 = encrypted.toString('base64url');
  return `${keyVersion}:${ivB64}:${ctB64}`;
}

/**
 * decrypt — decrypt a stored ciphertext string and return the raw signing secret.
 *
 * Throws if:
 *   - PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_SECRET is not configured.
 *   - The ciphertext format is invalid.
 *   - The auth tag verification fails (tampered ciphertext).
 * Never logs the raw secret or the encryption key.
 */
export function decrypt(ciphertext: string): string {
  const secret = getEncryptionSecret();
  const key = deriveKey(secret);

  const parts = ciphertext.split(':');
  if (parts.length !== 3) {
    throw new Error('[signingSecretProtector] Invalid ciphertext format.');
  }
  const [, ivB64, ctB64] = parts;
  const iv = Buffer.from(ivB64!, 'base64url');
  const ctWithTag = Buffer.from(ctB64!, 'base64url');

  if (ctWithTag.length < AUTH_TAG_LENGTH) {
    throw new Error('[signingSecretProtector] Ciphertext too short (missing auth tag).');
  }

  const authTag = ctWithTag.subarray(ctWithTag.length - AUTH_TAG_LENGTH);
  const ct = ctWithTag.subarray(0, ctWithTag.length - AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(ct), decipher.final()]);
  return decrypted.toString('utf8');
}

/**
 * isEncryptionConfigured — returns true if the encryption secret env var is set.
 * Does NOT return the secret value or any derived material.
 * Safe to use in /ready or version responses.
 */
export function isEncryptionConfigured(): boolean {
  const secret = process.env['PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_SECRET'];
  return Boolean(secret && secret.trim().length >= 32);
}
