/**
 * revokeMerchant — S10: revoke an API client's access to a merchant.
 *
 * Usage:
 *   nf-admin revoke-merchant --client-id <id> --merchant-id <id> --yes [--dry-run] [--json]
 *
 * Behavior:
 *   - Requires --yes unless --dry-run.
 *   - Fails if no active grant exists.
 */

import type { ParsedArgs } from '../parseArgs.ts';
import { requireFlag } from '../parseArgs.ts';
import { succeed, fail, dryRunNote } from '../output.ts';
import type { CliOutput } from '../output.ts';
import type { AdminContext } from '../adminContext.ts';
import { writeAdminAuditLog } from '../adminAudit.ts';
import { AuditAction } from '../../audit/auditActions.ts';

export async function runRevokeMerchant(
  args: ParsedArgs,
  ctx: AdminContext,
): Promise<CliOutput> {
  const op = 'revoke-merchant';

  let clientId: string;
  let merchantId: string;
  try {
    clientId = requireFlag(args, 'client-id');
    merchantId = requireFlag(args, 'merchant-id');
  } catch (err: any) {
    return fail(op, err.code ?? 'ADMIN_INVALID_ARGUMENT', err.message);
  }

  if (!args.yes && !args.dryRun) {
    return fail(op, 'ADMIN_CONFIRMATION_REQUIRED', 'Revoking merchant access is irreversible. Pass --yes to confirm.');
  }

  if (args.dryRun) {
    dryRunNote(op, `Would revoke access for client ${clientId} to merchant ${merchantId}`, args.json);
    return succeed(op, { dryRun: true, clientId, merchantId });
  }

  try {
    const grant = await ctx.accessRepo.findByClientAndMerchant(clientId, merchantId);
    if (!grant || grant.status !== 'active') {
      return fail(op, 'ADMIN_NOT_FOUND', `No active grant found for client ${clientId} to merchant ${merchantId}`);
    }

    await ctx.accessRepo.revoke(grant.id);

    void writeAdminAuditLog(ctx.auditRepo, {
      action: AuditAction.ADMIN_MERCHANT_REVOKE,
      clientId,
      merchantId,
      resourceType: 'client_merchant_access',
      resourceId: grant.id,
      metadata: { clientId, merchantId, grantId: grant.id },
    });

    return succeed(op, {
      grantId: grant.id,
      clientId: grant.clientId,
      merchantId: grant.merchantId,
      status: 'revoked',
      revokedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    return fail(op, 'ADMIN_OPERATION_FAILED', err.message ?? 'Failed to revoke merchant access');
  }
}
