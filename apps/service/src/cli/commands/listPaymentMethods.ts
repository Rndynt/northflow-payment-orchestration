/**
 * listPaymentMethods — S10: list payment methods for a provider account.
 *
 * Usage:
 *   nf-admin list-payment-methods --merchant-id <id> --provider-account-id <paId> [--json]
 */

import type { ParsedArgs } from '../parseArgs.ts';
import { requireFlag } from '../parseArgs.ts';
import { succeed, fail } from '../output.ts';
import type { CliOutput } from '../output.ts';
import type { AdminContext } from '../adminContext.ts';

export async function runListPaymentMethods(
  args: ParsedArgs,
  ctx: AdminContext,
): Promise<CliOutput> {
  const op = 'list-payment-methods';

  let merchantId: string;
  let providerAccountId: string;
  try {
    merchantId = requireFlag(args, 'merchant-id');
    providerAccountId = requireFlag(args, 'provider-account-id');
  } catch (err: any) {
    return fail(op, err.code ?? 'ADMIN_INVALID_ARGUMENT', err.message);
  }

  try {
    const pa = await ctx.providerAccountRepo.findById(providerAccountId, merchantId);
    if (!pa) {
      return fail(op, 'ADMIN_NOT_FOUND', `Provider account not found: ${providerAccountId}`);
    }

    const methods = await ctx.methodRepo.listByProviderAccount(providerAccountId);

    return succeed(op, {
      providerAccountId,
      merchantId,
      provider: pa.provider,
      environment: pa.environment,
      methods: methods.map((m) => ({
        methodId: m.id,
        method: m.method,
        methodType: m.methodType,
        displayName: m.displayName,
        status: m.status,
        currency: m.currency,
        minAmount: m.minAmount,
        maxAmount: m.maxAmount,
        sortOrder: m.sortOrder,
      })),
      total: methods.length,
    });
  } catch (err: any) {
    return fail(op, 'ADMIN_OPERATION_FAILED', err.message ?? 'Failed to list payment methods');
  }
}
