/**
 * RotateCredential — S9.1: zero-downtime credential rotation.
 *
 * Behavior:
 *   1. Creates a new active credential for the client.
 *   2. Optionally revokes the specified old credential immediately.
 *   3. Returns the new plaintext credential once.
 *
 * Grace-period scheduled revocation is NOT supported in this phase.
 * If grace period is requested but not supported, the old credential is
 * left active — callers should manually revoke after deploying the new key.
 *
 * Safety rules:
 *   - Never accidentally revoke ALL credentials (only the explicitly named one).
 *   - Old credential revocation only happens when revokeOldCredentialId is provided
 *     AND that credential belongs to the same clientId.
 *   - Plaintext credential is returned once and never stored/logged.
 */

import { randomUUID } from 'node:crypto';
import type { ApiClientRepository, ClientCredentialRepository } from '@northflow/payment-orchestration-core';
import { generateCredential } from '../../middleware/auth.ts';
import type { SafeCredentialView } from './CreateCredential.ts';

export interface RotateCredentialInput {
  clientId: string;
  /** If provided, this credential is revoked immediately after the new one is created. */
  revokeOldCredentialId?: string | null;
  /** Grace period is not supported in S9.1. Providing this field is documented as a no-op. */
  oldCredentialGracePeriodSeconds?: number | null;
  expiresAt?: Date | null;
}

export interface RotateCredentialOutput {
  newCredential: SafeCredentialView;
  /** Plaintext credential — shown exactly once, never store or log. */
  rawCredential: string;
  /**
   * When revokeOldCredentialId was provided and matched a credential owned by
   * this client, this is the safe view of the now-revoked credential.
   */
  revokedCredential: SafeCredentialView | null;
  /** True when grace period was requested but is not supported in this phase. */
  gracePeriodUnsupported: boolean;
}

export class RotateCredential {
  constructor(
    private readonly apiClientRepo: ApiClientRepository,
    private readonly credentialRepo: ClientCredentialRepository,
  ) {}

  async execute(input: RotateCredentialInput): Promise<RotateCredentialOutput> {
    const client = await this.apiClientRepo.findById(input.clientId);
    if (!client) {
      const err: Error & { code?: string; statusCode?: number } = new Error(
        `API client not found: ${input.clientId}`,
      );
      err.code = 'API_CLIENT_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }

    // Step 1: Create new credential
    const credentialId = randomUUID().replace(/-/g, '');
    const { raw, prefix, hash } = generateCredential(client.environment, credentialId);

    const created = await this.credentialRepo.create({
      id: credentialId,
      clientId: input.clientId,
      credentialPrefix: prefix,
      credentialHash: hash,
      expiresAt: input.expiresAt ?? null,
    });

    const newCredential: SafeCredentialView = {
      id: created.id,
      clientId: created.clientId,
      credentialPrefix: created.credentialPrefix,
      status: created.status,
      expiresAt: created.expiresAt,
      lastUsedAt: created.lastUsedAt,
      createdAt: created.createdAt,
      revokedAt: created.revokedAt,
    };

    const gracePeriodUnsupported = Boolean(
      input.oldCredentialGracePeriodSeconds && input.oldCredentialGracePeriodSeconds > 0,
    );

    // Step 2: Optionally revoke old credential (only if it belongs to this client)
    let revokedCredential: SafeCredentialView | null = null;
    if (input.revokeOldCredentialId) {
      const old = await this.credentialRepo.findById(input.revokeOldCredentialId);
      if (old && old.clientId === input.clientId) {
        if (old.status !== 'revoked') {
          await this.credentialRepo.revoke(input.revokeOldCredentialId);
        }
        const reloaded = await this.credentialRepo.findById(input.revokeOldCredentialId);
        const final = reloaded ?? old;
        revokedCredential = {
          id: final.id,
          clientId: final.clientId,
          credentialPrefix: final.credentialPrefix,
          status: final.status,
          expiresAt: final.expiresAt,
          lastUsedAt: final.lastUsedAt,
          createdAt: final.createdAt,
          revokedAt: final.revokedAt,
        };
      }
      // If old credential not found or belongs to a different client, skip silently.
      // This prevents enumeration — callers cannot tell if a credential existed.
    }

    return { newCredential, rawCredential: raw, revokedCredential, gracePeriodUnsupported };
  }
}
