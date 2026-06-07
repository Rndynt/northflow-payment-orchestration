/**
 * ListCredentials — S9.1: list all credentials for an API client.
 *
 * Security rules:
 *   - Never returns credentialHash.
 *   - Returns all statuses (active, revoked, expired) so callers can audit
 *     the full lifecycle.
 *   - Sorted by createdAt descending (newest first).
 */

import type { ClientCredentialRepository } from '@northflow/payment-orchestration-core';
import type { SafeCredentialView } from './CreateCredential.ts';

export interface ListCredentialsInput {
  clientId: string;
}

export interface ListCredentialsOutput {
  credentials: SafeCredentialView[];
}

export class ListCredentials {
  constructor(private readonly credentialRepo: ClientCredentialRepository) {}

  async execute(input: ListCredentialsInput): Promise<ListCredentialsOutput> {
    const rows = await this.credentialRepo.listByClientId(input.clientId);
    const credentials: SafeCredentialView[] = rows.map((c) => ({
      id: c.id,
      clientId: c.clientId,
      credentialPrefix: c.credentialPrefix,
      status: c.status,
      expiresAt: c.expiresAt,
      lastUsedAt: c.lastUsedAt,
      createdAt: c.createdAt,
      revokedAt: c.revokedAt,
    }));
    return { credentials };
  }
}
