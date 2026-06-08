/**
 * createMerchant — S10: create a merchant.
 *
 * Usage:
 *   nf-admin create-merchant --name <name> [--merchant-id <id>] [--legal-name <name>]
 *                            [--source-app <app>] [--external-ref <ref>]
 *                            [--metadata '{}'] [--dry-run] [--yes] [--json]
 *
 * Idempotent: if --source-app and --external-ref match an existing merchant, returns it.
 */

import type { ParsedArgs } from '../parseArgs.ts';
import { requireFlag, getFlag, parseJsonFlag } from '../parseArgs.ts';
import { succeed, fail, dryRunNote } from '../output.ts';
import type { CliOutput } from '../output.ts';
import type { AdminContext } from '../adminContext.ts';
import { writeAdminAuditLog } from '../adminAudit.ts';
import { AuditAction } from '../../audit/auditActions.ts';
import { CreateMerchant } from '../../application/use-cases/CreateMerchant.ts';

export async function runCreateMerchant(
  args: ParsedArgs,
  ctx: AdminContext,
): Promise<CliOutput> {
  const op = 'create-merchant';

  let name: string;
  try {
    name = requireFlag(args, 'name');
  } catch (err: any) {
    return fail(op, err.code ?? 'ADMIN_INVALID_ARGUMENT', err.message);
  }

  const merchantId = getFlag(args, 'merchant-id');
  const legalName = getFlag(args, 'legal-name');
  const sourceApp = getFlag(args, 'source-app');
  const externalRef = getFlag(args, 'external-ref');
  let metadata: Record<string, unknown> | null = null;
  try {
    metadata = parseJsonFlag(args, 'metadata');
  } catch (err: any) {
    return fail(op, err.code ?? 'ADMIN_INVALID_ARGUMENT', err.message);
  }

  if (args.dryRun) {
    dryRunNote(op, `Would create merchant name="${name}"${merchantId ? ` id=${merchantId}` : ''}`, args.json);
    return succeed(op, { dryRun: true, name, merchantId, legalName, sourceApp, externalRef });
  }

  try {
    const useCase = new CreateMerchant(ctx.merchantRepo);
    const { merchant, created } = await useCase.execute({
      id: merchantId ?? undefined,
      name,
      legalName,
      sourceApp,
      externalRef,
      metadata: metadata ?? {},
    });

    void writeAdminAuditLog(ctx.auditRepo, {
      action: AuditAction.ADMIN_MERCHANT_CREATE,
      merchantId: merchant.id,
      resourceType: 'merchant',
      resourceId: merchant.id,
      metadata: { merchantId: merchant.id, name: merchant.displayName, created },
    });

    return succeed(op, {
      merchantId: merchant.id,
      name: merchant.displayName,
      legalName: merchant.legalName,
      sourceApp: merchant.sourceApp,
      externalRef: merchant.externalRef,
      status: merchant.status,
      created,
      createdAt: merchant.createdAt,
    });
  } catch (err: any) {
    return fail(op, 'ADMIN_OPERATION_FAILED', err.message ?? 'Failed to create merchant');
  }
}
