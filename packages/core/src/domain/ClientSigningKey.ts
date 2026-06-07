/**
 * ClientSigningKey — S9.4: domain types for HMAC signing keys and request nonces.
 *
 * ClientSigningKey is distinct from ClientCredential.
 * ClientCredential = bearer API key (stored as one-way hash, cannot verify HMAC).
 * ClientSigningKey = HMAC signing key (stored encrypted, used to verify request signatures).
 *
 * Raw signing secret is returned only once on create/rotate.
 * secret_ciphertext is stored encrypted (AES-256-GCM) and never returned in responses.
 */

export type ClientSigningKeyStatus = 'active' | 'revoked' | 'expired';

export interface ClientSigningKeyDTO {
  id: string;
  clientId: string;
  keyPrefix: string;
  status: ClientSigningKeyStatus;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
  revokedAt: Date | null;
  metadata: Record<string, unknown>;
}

export interface RequestNonceDTO {
  id: string;
  clientId: string;
  signingKeyId: string;
  nonce: string;
  timestamp: Date;
  expiresAt: Date;
  createdAt: Date;
  metadata: Record<string, unknown>;
}
