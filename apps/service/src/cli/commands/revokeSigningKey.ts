/**
 * revokeSigningKey — S10: revoke a client signing key.
 *
 * Usage:
 *   nf-admin revoke-signing-key --client-id <id> --signing-key-id <keyId> --yes [--dry-run] [--json]
 *
 * Behavior:
 *   - Idempotent: revoking an already-revoked key returns success.
 *   - Requires --yes unless --dry-run.
 */

import type { ParsedArgs } from '../parseArgs.ts';
import { requireFlag } from '../parseArgs.ts';
import { succeed, fail, dryRunNote } from '../output.ts';
import type { CliOutput } from '../output.ts';
import type { AdminContext } from '../adminContext.ts';
import { writeAdminAuditLog } from '../adminAudit.ts';
import { AuditAction } from '../../audit/auditActions.ts';

export async function runRevokeSigningKey(
  args: ParsedArgs,
  ctx: AdminContext,
): Promise<CliOutput> {
  const op = 'revoke-signing-key';

  let clientId: string;
  let signingKeyId: string;
  try {
    clientId = requireFlag(args, 'client-id');
    signingKeyId = requireFlag(args, 'signing-key-id');
  } catch (err: any) {
    return fail(op, err.code ?? 'ADMIN_INVALID_ARGUMENT', err.message);
  }

  if (!args.yes && !args.dryRun) {
    return fail(op, 'ADMIN_CONFIRMATION_REQUIRED', 'Revoking a signing key is irreversible. Pass --yes to confirm.');
  }

  if (args.dryRun) {
    dryRunNote(op, `Would revoke signing key ${signingKeyId} for client ${clientId}`, args.json);
    return succeed(op, { dryRun: true, clientId, signingKeyId });
  }

  try {
    const key = await ctx.signingKeyRepo.findById(signingKeyId);
    if (!key) {
      return fail(op, 'ADMIN_NOT_FOUND', `Signing key not found: ${signingKeyId}`);
    }
    if (key.clientId !== clientId) {
      return fail(op, 'ADMIN_NOT_FOUND', `Signing key ${signingKeyId} does not belong to client ${clientId}`);
    }

    const revokedAt = new Date();
    if (key.status !== 'revoked') {
      await ctx.signingKeyRepo.revoke(signingKeyId, revokedAt);
    }

    const updated = (await ctx.signingKeyRepo.findById(signingKeyId)) ?? key;

    void writeAdminAuditLog(ctx.auditRepo, {
      action: AuditAction.ADMIN_CLIENT_SIGNING_KEY_REVOKE,
      clientId,
      resourceType: 'client_signing_key',
      resourceId: signingKeyId,
      metadata: {
        clientId,
        signingKeyId,
        keyPrefix: key.keyPrefix,
        revokedAt: updated.revokedAt?.toISOString() ?? revokedAt.toISOString(),
      },
    });

    return succeed(op, {
      signingKeyId: updated.id,
      clientId: updated.clientId,
      keyPrefix: updated.keyPrefix,
      status: updated.status,
      revokedAt: updated.revokedAt?.toISOString() ?? revokedAt.toISOString(),
    });
  } catch (err: any) {
    return fail(op, 'ADMIN_OPERATION_FAILED', err.message ?? 'Failed to revoke signing key');
  }
}
