/**
 * createCredential — S10: create a bearer credential for an API client.
 *
 * Usage:
 *   nf-admin create-credential --client-id <id> [--scopes scope1,scope2] [--expires-at ISO] [--dry-run] [--yes] [--json]
 *
 * Security:
 *   - rawCredential is printed exactly once and never stored in logs or audit.
 *   - Only prefix + hash are persisted.
 */

import type { ParsedArgs } from '../parseArgs.ts';
import { requireFlag, getFlag, parseScopes } from '../parseArgs.ts';
import { succeed, fail, dryRunNote, oneTimeSecretNote } from '../output.ts';
import type { CliOutput } from '../output.ts';
import type { AdminContext } from '../adminContext.ts';
import { writeAdminAuditLog } from '../adminAudit.ts';
import { AuditAction } from '../../audit/auditActions.ts';
import { CreateCredential } from '../../application/use-cases/CreateCredential.ts';

export async function runCreateCredential(
  args: ParsedArgs,
  ctx: AdminContext,
): Promise<CliOutput & { rawCredential?: string }> {
  const op = 'create-credential';

  let clientId: string;
  try {
    clientId = requireFlag(args, 'client-id');
  } catch (err: any) {
    return fail(op, err.code ?? 'ADMIN_INVALID_ARGUMENT', err.message);
  }

  const scopesRaw = getFlag(args, 'scopes');
  const _scopes = scopesRaw ? parseScopes(scopesRaw) : [];
  const expiresAtStr = getFlag(args, 'expires-at');
  let expiresAt: Date | null = null;
  if (expiresAtStr) {
    expiresAt = new Date(expiresAtStr);
    if (isNaN(expiresAt.getTime())) {
      return fail(op, 'ADMIN_INVALID_ARGUMENT', '--expires-at must be a valid ISO 8601 date string');
    }
    if (expiresAt <= new Date()) {
      return fail(op, 'ADMIN_INVALID_ARGUMENT', '--expires-at must be in the future');
    }
  }

  if (args.dryRun) {
    dryRunNote(op, `Would create credential for client ${clientId}${expiresAt ? ` expiring ${expiresAt.toISOString()}` : ''}`, args.json);
    return succeed(op, { dryRun: true, clientId, expiresAt: expiresAt?.toISOString() ?? null });
  }

  try {
    const useCase = new CreateCredential(ctx.apiClientRepo, ctx.credentialRepo);
    const { credential, rawCredential } = await useCase.execute({ clientId, expiresAt });

    void writeAdminAuditLog(ctx.auditRepo, {
      action: AuditAction.ADMIN_CLIENT_CREDENTIAL_CREATE,
      clientId,
      resourceType: 'client_credential',
      resourceId: credential.id,
      metadata: {
        clientId,
        credentialId: credential.id,
        credentialPrefix: credential.credentialPrefix,
        expiresAt: credential.expiresAt?.toISOString() ?? null,
      },
    });

    const result = succeed(op, {
      credentialId: credential.id,
      clientId: credential.clientId,
      credentialPrefix: credential.credentialPrefix,
      status: credential.status,
      expiresAt: credential.expiresAt?.toISOString() ?? null,
      createdAt: credential.createdAt,
      rawCredential,
    });

    if (!args.json) {
      oneTimeSecretNote(args.json);
    }

    return { ...result, rawCredential };
  } catch (err: any) {
    return fail(op, err.code === 'API_CLIENT_NOT_FOUND' ? 'ADMIN_NOT_FOUND' : 'ADMIN_OPERATION_FAILED', err.message ?? 'Failed to create credential');
  }
}
