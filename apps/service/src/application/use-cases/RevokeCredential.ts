/**
 * RevokeCredential — S9.1: revoke an API client credential.
 *
 * Rules:
 *   - Credential must exist.
 *   - Credential must belong to the target clientId.
 *   - Revocation sets status to 'revoked' and records revokedAt.
 *   - Revoking an already-revoked credential is idempotent (no error).
 *   - Does not delete credential rows (audit trail preserved).
 *   - Revoked credentials cannot authenticate (enforced by auth middleware).
 */

import type { ClientCredentialRepository } from '@northflow/payment-orchestration-core';
import type { SafeCredentialView } from './CreateCredential.ts';

export interface RevokeCredentialInput {
  clientId: string;
  credentialId: string;
}

export interface RevokeCredentialOutput {
  credential: SafeCredentialView;
}

export class RevokeCredential {
  constructor(private readonly credentialRepo: ClientCredentialRepository) {}

  async execute(input: RevokeCredentialInput): Promise<RevokeCredentialOutput> {
    const credential = await this.credentialRepo.findById(input.credentialId);

    if (!credential) {
      const err: Error & { code?: string; statusCode?: number } = new Error(
        `Credential not found: ${input.credentialId}`,
      );
      err.code = 'CREDENTIAL_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }

    if (credential.clientId !== input.clientId) {
      const err: Error & { code?: string; statusCode?: number } = new Error(
        'Credential does not belong to the specified API client.',
      );
      err.code = 'CREDENTIAL_NOT_OWNED';
      err.statusCode = 403;
      throw err;
    }

    // Idempotent: if already revoked, return current state without re-writing.
    if (credential.status !== 'revoked') {
      await this.credentialRepo.revoke(input.credentialId);
    }

    // Reload to get updated revokedAt timestamp (or return current if idempotent)
    const updated = await this.credentialRepo.findById(input.credentialId);
    const final = updated ?? credential;

    const view: SafeCredentialView = {
      id: final.id,
      clientId: final.clientId,
      credentialPrefix: final.credentialPrefix,
      status: final.status,
      expiresAt: final.expiresAt,
      lastUsedAt: final.lastUsedAt,
      createdAt: final.createdAt,
      revokedAt: final.revokedAt,
    };

    return { credential: view };
  }
}
