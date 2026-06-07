/**
 * CreateCredential — S9.1: create a new API client credential.
 *
 * Security rules:
 *   - Generates a secure random plaintext credential (nf.<env>.<id>.<secret>).
 *   - Stores only prefix + SHA-256 hash — plaintext is NEVER persisted.
 *   - Returns plaintext credential exactly once in the output.
 *   - Never logs plaintext credential.
 *   - Audit metadata must not include plaintext or hash.
 *
 * Returns a SafeCredentialView (no hash field) + rawCredential shown once.
 */

import { randomUUID } from 'node:crypto';
import type { ApiClientRepository, ClientCredentialRepository } from '@northflow/payment-orchestration-core';
import { generateCredential } from '../../middleware/auth.ts';

export interface CreateCredentialInput {
  clientId: string;
  expiresAt?: Date | null;
}

export interface SafeCredentialView {
  id: string;
  clientId: string;
  credentialPrefix: string;
  status: string;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
  revokedAt: Date | null;
}

export interface CreateCredentialOutput {
  credential: SafeCredentialView;
  /** Plaintext credential — shown exactly once, never store or log. */
  rawCredential: string;
}

export class CreateCredential {
  constructor(
    private readonly apiClientRepo: ApiClientRepository,
    private readonly credentialRepo: ClientCredentialRepository,
  ) {}

  async execute(input: CreateCredentialInput): Promise<CreateCredentialOutput> {
    const client = await this.apiClientRepo.findById(input.clientId);
    if (!client) {
      const err: Error & { code?: string; statusCode?: number } = new Error(
        `API client not found: ${input.clientId}`,
      );
      err.code = 'API_CLIENT_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }

    // Generate secure credential: nf.<env>.<credentialId>.<secret>
    // credentialId must be alphanumeric+hyphen — use UUID without hyphens.
    const credentialId = randomUUID().replace(/-/g, '');
    const { raw, prefix, hash } = generateCredential(client.environment, credentialId);

    const created = await this.credentialRepo.create({
      id: credentialId,
      clientId: input.clientId,
      credentialPrefix: prefix,
      credentialHash: hash,
      expiresAt: input.expiresAt ?? null,
    });

    const view: SafeCredentialView = {
      id: created.id,
      clientId: created.clientId,
      credentialPrefix: created.credentialPrefix,
      status: created.status,
      expiresAt: created.expiresAt,
      lastUsedAt: created.lastUsedAt,
      createdAt: created.createdAt,
      revokedAt: created.revokedAt,
    };

    return { credential: view, rawCredential: raw };
  }
}
