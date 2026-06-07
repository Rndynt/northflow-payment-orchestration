/**
 * createProviderAccount — S10: create a provider account for a merchant.
 *
 * Usage:
 *   nf-admin create-provider-account --merchant-id <id> --provider <provider>
 *                                    --environment sandbox|test|production
 *                                    [--provider-account-id <id>]
 *                                    [--provider-account-ref <ref>]
 *                                    [--credentials-ref <envVarName>]
 *                                    [--public-config '{}'] [--metadata '{}']
 *                                    [--dry-run] [--yes] [--json]
 */

import type { ParsedArgs } from '../parseArgs.ts';
import { requireFlag, getFlag, parseJsonFlag } from '../parseArgs.ts';
import { succeed, fail, dryRunNote } from '../output.ts';
import type { CliOutput } from '../output.ts';
import type { AdminContext } from '../adminContext.ts';
import { writeAdminAuditLog } from '../adminAudit.ts';
import { AuditAction } from '../../audit/auditActions.ts';
import { CreateProviderAccount } from '../../application/use-cases/CreateProviderAccount.ts';

export async function runCreateProviderAccount(
  args: ParsedArgs,
  ctx: AdminContext,
): Promise<CliOutput> {
  const op = 'create-provider-account';

  let merchantId: string;
  let provider: string;
  let environment: 'sandbox' | 'test' | 'production';

  try {
    merchantId = requireFlag(args, 'merchant-id');
    provider = requireFlag(args, 'provider');
    const envRaw = requireFlag(args, 'environment');
    if (envRaw !== 'sandbox' && envRaw !== 'test' && envRaw !== 'production') {
      return fail(op, 'ADMIN_INVALID_ARGUMENT', '--environment must be sandbox, test, or production');
    }
    environment = envRaw;
  } catch (err: any) {
    return fail(op, err.code ?? 'ADMIN_INVALID_ARGUMENT', err.message);
  }

  const paId = getFlag(args, 'provider-account-id');
  const providerAccountRef = getFlag(args, 'provider-account-ref');
  const credentialsRef = getFlag(args, 'credentials-ref');
  let publicConfig: Record<string, unknown> | null = null;
  let metadata: Record<string, unknown> | null = null;
  try {
    publicConfig = parseJsonFlag(args, 'public-config');
    metadata = parseJsonFlag(args, 'metadata');
  } catch (err: any) {
    return fail(op, err.code ?? 'ADMIN_INVALID_ARGUMENT', err.message);
  }

  if (args.dryRun) {
    dryRunNote(op, `Would create provider account merchant=${merchantId} provider=${provider} env=${environment}`, args.json);
    return succeed(op, { dryRun: true, merchantId, provider, environment });
  }

  try {
    const useCase = new CreateProviderAccount(ctx.merchantRepo, ctx.providerAccountRepo);
    const { providerAccount } = await useCase.execute({
      id: paId ?? undefined,
      merchantId,
      provider,
      environment,
      providerAccountRef,
      credentialsRef,
      publicConfig: publicConfig ?? {},
      metadata: metadata ?? {},
    });

    void writeAdminAuditLog(ctx.auditRepo, {
      action: AuditAction.ADMIN_PROVIDER_ACCOUNT_CREATE,
      merchantId,
      resourceType: 'provider_account',
      resourceId: providerAccount.id,
      metadata: {
        merchantId,
        providerAccountId: providerAccount.id,
        provider: providerAccount.provider,
        environment: providerAccount.environment,
      },
    });

    return succeed(op, {
      providerAccountId: providerAccount.id,
      merchantId: providerAccount.merchantId,
      provider: providerAccount.provider,
      environment: providerAccount.environment,
      providerAccountRef: providerAccount.providerAccountRef,
      credentialsRef: providerAccount.credentialsRef,
      status: providerAccount.status,
      createdAt: providerAccount.createdAt,
    });
  } catch (err: any) {
    const code = err.code === 'MERCHANT_NOT_FOUND' ? 'ADMIN_NOT_FOUND' : 'ADMIN_OPERATION_FAILED';
    return fail(op, code, err.message ?? 'Failed to create provider account');
  }
}
