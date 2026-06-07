/**
 * getClient — S10: get a single API client by ID (safe view, no credential material).
 *
 * Usage:
 *   nf-admin get-client --client-id <id> [--json]
 */

import type { ParsedArgs } from '../parseArgs.ts';
import { requireFlag } from '../parseArgs.ts';
import { succeed, fail } from '../output.ts';
import type { CliOutput } from '../output.ts';
import type { AdminContext } from '../adminContext.ts';

export async function runGetClient(
  args: ParsedArgs,
  ctx: AdminContext,
): Promise<CliOutput> {
  const op = 'get-client';

  let clientId: string;
  try {
    clientId = requireFlag(args, 'client-id');
  } catch (err: any) {
    return fail(op, err.code ?? 'ADMIN_INVALID_ARGUMENT', err.message);
  }

  try {
    const client = await ctx.apiClientRepo.findById(clientId);
    if (!client) {
      return fail(op, 'ADMIN_NOT_FOUND', `API client not found: ${clientId}`);
    }

    const credentials = await ctx.credentialRepo.listByClientId(clientId);
    const signingKeys = await ctx.signingKeyRepo.listByClientId(clientId);

    return succeed(op, {
      clientId: client.id,
      name: client.name,
      sourceApp: client.sourceApp,
      environment: client.environment,
      status: client.status,
      scopes: client.scopes,
      createdAt: client.createdAt,
      updatedAt: client.updatedAt,
      credentials: credentials.map((c) => ({
        credentialId: c.id,
        credentialPrefix: c.credentialPrefix,
        status: c.status,
        expiresAt: c.expiresAt,
        lastUsedAt: c.lastUsedAt,
        createdAt: c.createdAt,
        revokedAt: c.revokedAt,
      })),
      signingKeys: signingKeys.map((k) => ({
        signingKeyId: k.id,
        keyPrefix: k.keyPrefix,
        status: k.status,
        expiresAt: k.expiresAt,
        lastUsedAt: k.lastUsedAt,
        createdAt: k.createdAt,
        revokedAt: k.revokedAt,
      })),
    });
  } catch (err: any) {
    return fail(op, 'ADMIN_OPERATION_FAILED', err.message ?? 'Failed to get API client');
  }
}
