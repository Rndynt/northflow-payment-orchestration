/**
 * disablePaymentMethod — S10: disable a payment method on a provider account.
 *
 * Usage:
 *   nf-admin disable-payment-method --merchant-id <id> --provider-account-id <paId>
 *                                   --method <method> --yes [--dry-run] [--json]
 */

import type { ParsedArgs } from '../parseArgs.ts';
import { requireFlag } from '../parseArgs.ts';
import { succeed, fail, dryRunNote } from '../output.ts';
import type { CliOutput } from '../output.ts';
import type { AdminContext } from '../adminContext.ts';
import { writeAdminAuditLog } from '../adminAudit.ts';
import { AuditAction } from '../../audit/auditActions.ts';
import { UpsertProviderAccountMethod } from '../../application/use-cases/UpsertProviderAccountMethod.ts';

export async function runDisablePaymentMethod(
  args: ParsedArgs,
  ctx: AdminContext,
): Promise<CliOutput> {
  const op = 'disable-payment-method';

  let merchantId: string;
  let providerAccountId: string;
  let method: string;
  try {
    merchantId = requireFlag(args, 'merchant-id');
    providerAccountId = requireFlag(args, 'provider-account-id');
    method = requireFlag(args, 'method');
  } catch (err: any) {
    return fail(op, err.code ?? 'ADMIN_INVALID_ARGUMENT', err.message);
  }

  if (!args.yes && !args.dryRun) {
    return fail(op, 'ADMIN_CONFIRMATION_REQUIRED', 'Disabling a payment method requires --yes to confirm.');
  }

  if (args.dryRun) {
    dryRunNote(op, `Would disable method=${method} on provider account ${providerAccountId}`, args.json);
    return succeed(op, { dryRun: true, merchantId, providerAccountId, method });
  }

  try {
    const useCase = new UpsertProviderAccountMethod(ctx.providerAccountRepo, ctx.methodRepo);
    const { method: m } = await useCase.execute({
      merchantId,
      providerAccountId,
      method,
      status: 'disabled',
    });

    void writeAdminAuditLog(ctx.auditRepo, {
      action: AuditAction.ADMIN_PAYMENT_METHOD_DISABLE,
      merchantId,
      resourceType: 'provider_account_method',
      resourceId: m.id,
      metadata: { merchantId, providerAccountId, method: m.method, methodId: m.id },
    });

    return succeed(op, {
      methodId: m.id,
      merchantId,
      providerAccountId: m.providerAccountId,
      method: m.method,
      status: m.status,
    });
  } catch (err: any) {
    const code = err.code === 'PROVIDER_ACCOUNT_NOT_FOUND' ? 'ADMIN_NOT_FOUND' : 'ADMIN_OPERATION_FAILED';
    return fail(op, code, err.message ?? 'Failed to disable payment method');
  }
}
