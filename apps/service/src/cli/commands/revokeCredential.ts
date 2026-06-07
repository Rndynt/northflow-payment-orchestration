/**
 * revokeCredential — S10: revoke a client credential.
 *
 * Usage:
 *   nf-admin revoke-credential --client-id <id> --credential-id <credId> --yes [--dry-run] [--json]
 *
 * Behavior:
 *   - Idempotent: revoking an already-revoked credential returns success.
 *   - Requires --yes unless --dry-run.
 */

import type { ParsedArgs } from '../parseArgs.ts';
import { requireFlag } from '../parseArgs.ts';
import { succeed, fail, dryRunNote } from '../output.ts';
import type { CliOutput } from '../output.ts';
import type { AdminContext } from '../adminContext.ts';
import { writeAdminAuditLog } from '../adminAudit.ts';
import { AuditAction } from '../../audit/auditActions.ts';
import { RevokeCredential } from '../../application/use-cases/RevokeCredential.ts';

export async function runRevokeCredential(
  args: ParsedArgs,
  ctx: AdminContext,
): Promise<CliOutput> {
  const op = 'revoke-credential';

  let clientId: string;
  let credentialId: string;
  try {
    clientId = requireFlag(args, 'client-id');
    credentialId = requireFlag(args, 'credential-id');
  } catch (err: any) {
    return fail(op, err.code ?? 'ADMIN_INVALID_ARGUMENT', err.message);
  }

  if (!args.yes && !args.dryRun) {
    return fail(op, 'ADMIN_CONFIRMATION_REQUIRED', 'Revoking a credential is irreversible. Pass --yes to confirm.');
  }

  if (args.dryRun) {
    dryRunNote(op, `Would revoke credential ${credentialId} for client ${clientId}`, args.json);
    return succeed(op, { dryRun: true, clientId, credentialId });
  }

  try {
    const useCase = new RevokeCredential(ctx.credentialRepo);
    const { credential } = await useCase.execute({ clientId, credentialId });

    void writeAdminAuditLog(ctx.auditRepo, {
      action: AuditAction.ADMIN_CLIENT_CREDENTIAL_REVOKE,
      clientId,
      resourceType: 'client_credential',
      resourceId: credentialId,
      metadata: {
        clientId,
        credentialId,
        credentialPrefix: credential.credentialPrefix,
        revokedAt: credential.revokedAt?.toISOString() ?? null,
      },
    });

    return succeed(op, {
      credentialId: credential.id,
      clientId: credential.clientId,
      credentialPrefix: credential.credentialPrefix,
      status: credential.status,
      revokedAt: credential.revokedAt?.toISOString() ?? null,
    });
  } catch (err: any) {
    const code = err.code === 'CREDENTIAL_NOT_FOUND' ? 'ADMIN_NOT_FOUND' : 'ADMIN_OPERATION_FAILED';
    return fail(op, code, err.message ?? 'Failed to revoke credential');
  }
}
