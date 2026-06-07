/**
 * grantMerchant — S10: grant an API client access to a merchant.
 *
 * Usage:
 *   nf-admin grant-merchant --client-id <id> --merchant-id <id>
 *                           [--scopes scope1,scope2] [--yes] [--dry-run] [--json]
 *
 * If a grant already exists but is revoked, creates a new grant.
 * If an active grant already exists, returns ADMIN_ALREADY_EXISTS.
 */

import { randomUUID } from 'node:crypto';
import type { ParsedArgs } from '../parseArgs.ts';
import { requireFlag, getFlag, parseScopes } from '../parseArgs.ts';
import { succeed, fail, dryRunNote } from '../output.ts';
import type { CliOutput } from '../output.ts';
import type { AdminContext } from '../adminContext.ts';
import { validateScopes } from '../adminContext.ts';
import { writeAdminAuditLog } from '../adminAudit.ts';
import { AuditAction } from '../../audit/auditActions.ts';

export async function runGrantMerchant(
  args: ParsedArgs,
  ctx: AdminContext,
): Promise<CliOutput> {
  const op = 'grant-merchant';

  let clientId: string;
  let merchantId: string;
  try {
    clientId = requireFlag(args, 'client-id');
    merchantId = requireFlag(args, 'merchant-id');
  } catch (err: any) {
    return fail(op, err.code ?? 'ADMIN_INVALID_ARGUMENT', err.message);
  }

  const scopesRaw = getFlag(args, 'scopes');
  const scopes = scopesRaw ? parseScopes(scopesRaw) : ['merchant:read'];

  if (scopes.length > 0) {
    const { valid, unknown } = validateScopes(scopes);
    if (!valid) {
      return fail(op, 'ADMIN_SCOPE_INVALID', `Unknown scopes: ${unknown.join(', ')}`);
    }
  }

  if (args.dryRun) {
    dryRunNote(op, `Would grant client ${clientId} access to merchant ${merchantId} with scopes [${scopes.join(',')}]`, args.json);
    return succeed(op, { dryRun: true, clientId, merchantId, scopes });
  }

  try {
    const client = await ctx.apiClientRepo.findById(clientId);
    if (!client) {
      return fail(op, 'ADMIN_NOT_FOUND', `API client not found: ${clientId}`);
    }

    const merchant = await ctx.merchantRepo.findById(merchantId);
    if (!merchant) {
      return fail(op, 'ADMIN_NOT_FOUND', `Merchant not found: ${merchantId}`);
    }

    const existing = await ctx.accessRepo.findByClientAndMerchant(clientId, merchantId);
    if (existing && existing.status === 'active') {
      return fail(op, 'ADMIN_ALREADY_EXISTS', `Client ${clientId} already has an active grant to merchant ${merchantId} (grantId=${existing.id})`);
    }

    const grant = await ctx.accessRepo.create({
      id: `cma_${randomUUID()}`,
      clientId,
      merchantId,
      scopes,
    });

    void writeAdminAuditLog(ctx.auditRepo, {
      action: AuditAction.ADMIN_MERCHANT_GRANT,
      clientId,
      merchantId,
      resourceType: 'client_merchant_access',
      resourceId: grant.id,
      metadata: { clientId, merchantId, grantId: grant.id, scopes },
    });

    return succeed(op, {
      grantId: grant.id,
      clientId: grant.clientId,
      merchantId: grant.merchantId,
      scopes: grant.scopes,
      status: grant.status,
      createdAt: grant.createdAt,
    });
  } catch (err: any) {
    return fail(op, 'ADMIN_OPERATION_FAILED', err.message ?? 'Failed to grant merchant access');
  }
}
