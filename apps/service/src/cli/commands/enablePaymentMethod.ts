/**
 * enablePaymentMethod — S10: upsert / enable a payment method on a provider account.
 *
 * Usage:
 *   nf-admin enable-payment-method --merchant-id <id> --provider-account-id <paId>
 *                                  --method <method> [--method-type qris|virtual_account|ewallet|card|retail_outlet|manual|other]
 *                                  [--display-name <name>] [--currency <code>]
 *                                  [--min-amount <n>] [--max-amount <n>]
 *                                  [--provider-method-code <code>]
 *                                  [--public-config '{}'] [--metadata '{}']
 *                                  [--yes] [--dry-run] [--json]
 */

import type { ParsedArgs } from '../parseArgs.ts';
import { requireFlag, getFlag, parseJsonFlag } from '../parseArgs.ts';
import { succeed, fail, dryRunNote } from '../output.ts';
import type { CliOutput } from '../output.ts';
import type { AdminContext } from '../adminContext.ts';
import { writeAdminAuditLog } from '../adminAudit.ts';
import { AuditAction } from '../../audit/auditActions.ts';
import { UpsertProviderAccountMethod } from '../../application/use-cases/UpsertProviderAccountMethod.ts';
import type { ProviderAccountPaymentMethodType } from '@northflow/payment-orchestration-core';

const VALID_METHOD_TYPES: ProviderAccountPaymentMethodType[] = [
  'qris',
  'virtual_account',
  'ewallet',
  'card',
  'retail_outlet',
  'manual',
  'other',
];

export async function runEnablePaymentMethod(
  args: ParsedArgs,
  ctx: AdminContext,
): Promise<CliOutput> {
  const op = 'enable-payment-method';

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

  const methodTypeRaw = getFlag(args, 'method-type');
  if (methodTypeRaw && !VALID_METHOD_TYPES.includes(methodTypeRaw as ProviderAccountPaymentMethodType)) {
    return fail(op, 'ADMIN_INVALID_ARGUMENT', `--method-type must be one of: ${VALID_METHOD_TYPES.join(', ')}`);
  }
  const methodType = (methodTypeRaw ?? 'other') as ProviderAccountPaymentMethodType;

  const displayName = getFlag(args, 'display-name');
  const currency = getFlag(args, 'currency');
  const providerMethodCode = getFlag(args, 'provider-method-code');
  const minAmountStr = getFlag(args, 'min-amount');
  const maxAmountStr = getFlag(args, 'max-amount');
  let minAmount: number | null = null;
  let maxAmount: number | null = null;

  if (minAmountStr !== null) {
    minAmount = parseFloat(minAmountStr);
    if (isNaN(minAmount)) return fail(op, 'ADMIN_INVALID_ARGUMENT', '--min-amount must be a number');
  }
  if (maxAmountStr !== null) {
    maxAmount = parseFloat(maxAmountStr);
    if (isNaN(maxAmount)) return fail(op, 'ADMIN_INVALID_ARGUMENT', '--max-amount must be a number');
  }

  let publicConfig: Record<string, unknown> | null = null;
  let metadata: Record<string, unknown> | null = null;
  try {
    publicConfig = parseJsonFlag(args, 'public-config');
    metadata = parseJsonFlag(args, 'metadata');
  } catch (err: any) {
    return fail(op, err.code ?? 'ADMIN_INVALID_ARGUMENT', err.message);
  }

  if (args.dryRun) {
    dryRunNote(op, `Would enable method=${method} on provider account ${providerAccountId}`, args.json);
    return succeed(op, { dryRun: true, merchantId, providerAccountId, method, methodType });
  }

  try {
    const useCase = new UpsertProviderAccountMethod(ctx.providerAccountRepo, ctx.methodRepo);
    const { method: m, created } = await useCase.execute({
      merchantId,
      providerAccountId,
      method,
      methodType,
      providerMethodCode,
      displayName: displayName ?? method,
      status: 'active',
      currency: currency ?? undefined,
      minAmount,
      maxAmount,
      publicConfig: publicConfig ?? {},
      metadata: metadata ?? {},
    });

    void writeAdminAuditLog(ctx.auditRepo, {
      action: AuditAction.ADMIN_PAYMENT_METHOD_ENABLE,
      merchantId,
      resourceType: 'provider_account_method',
      resourceId: m.id,
      metadata: {
        merchantId,
        providerAccountId,
        method: m.method,
        methodId: m.id,
        created,
      },
    });

    return succeed(op, {
      methodId: m.id,
      merchantId,
      providerAccountId: m.providerAccountId,
      method: m.method,
      methodType: m.methodType,
      displayName: m.displayName,
      status: m.status,
      currency: m.currency,
      minAmount: m.minAmount,
      maxAmount: m.maxAmount,
      created,
    });
  } catch (err: any) {
    const code = err.code === 'PROVIDER_ACCOUNT_NOT_FOUND' ? 'ADMIN_NOT_FOUND' : 'ADMIN_OPERATION_FAILED';
    return fail(op, code, err.message ?? 'Failed to enable payment method');
  }
}
