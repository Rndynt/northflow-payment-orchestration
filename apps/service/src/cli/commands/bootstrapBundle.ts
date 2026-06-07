/**
 * bootstrapBundle — S10: bootstrap a complete API client + credential + merchant + grant
 * in one atomic-style CLI operation.
 *
 * Usage:
 *   nf-admin bootstrap-bundle --client-id <id> --name <name> --source-app <app>
 *                             --environment <env> --merchant-name <name>
 *                             [--merchant-id <id>] [--scopes scope1,scope2]
 *                             [--grant-scopes scope1,scope2]
 *                             [--yes] [--dry-run] [--json]
 *
 * Creates:
 *   1. API client
 *   2. Bearer credential for the client (rawCredential returned once)
 *   3. Merchant (idempotent if --source-app + --merchant-id match existing)
 *   4. Merchant access grant for the client
 *
 * On any step failure, subsequent steps are skipped and the partial result is returned
 * with ok: false. The operator must clean up manually or re-run idempotent steps.
 *
 * Security: rawCredential is included once in the result; no hashes or secrets in metadata.
 */

import { randomUUID } from 'node:crypto';
import type { ParsedArgs } from '../parseArgs.ts';
import { requireFlag, getFlag, parseScopes, parseJsonFlag } from '../parseArgs.ts';
import { succeed, fail, dryRunNote } from '../output.ts';
import type { CliOutput } from '../output.ts';
import type { AdminContext } from '../adminContext.ts';
import { validateScopes } from '../adminContext.ts';
import { writeAdminAuditLog } from '../adminAudit.ts';
import { AuditAction } from '../../audit/auditActions.ts';
import { CreateCredential } from '../../application/use-cases/CreateCredential.ts';
import { CreateMerchant } from '../../application/use-cases/CreateMerchant.ts';

export async function runBootstrapBundle(
  args: ParsedArgs,
  ctx: AdminContext,
): Promise<CliOutput & { rawCredential?: string }> {
  const op = 'bootstrap-bundle';

  let clientId: string;
  let name: string;
  let sourceApp: string;
  let environment: string;
  let merchantName: string;

  try {
    clientId = getFlag(args, 'client-id') ?? `client_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    name = requireFlag(args, 'name');
    sourceApp = requireFlag(args, 'source-app');
    environment = requireFlag(args, 'environment');
    merchantName = requireFlag(args, 'merchant-name');
  } catch (err: any) {
    return fail(op, err.code ?? 'ADMIN_INVALID_ARGUMENT', err.message);
  }

  const merchantIdFlag = getFlag(args, 'merchant-id');
  const scopesRaw = getFlag(args, 'scopes');
  const scopes = scopesRaw ? parseScopes(scopesRaw) : [];
  const grantScopesRaw = getFlag(args, 'grant-scopes');
  const grantScopes = grantScopesRaw ? parseScopes(grantScopesRaw) : ['merchant:read'];

  let metadata: Record<string, unknown> | null = null;
  try {
    metadata = parseJsonFlag(args, 'metadata');
  } catch (err: any) {
    return fail(op, err.code ?? 'ADMIN_INVALID_ARGUMENT', err.message);
  }

  if (scopes.length > 0) {
    const { valid, unknown } = validateScopes(scopes);
    if (!valid) return fail(op, 'ADMIN_SCOPE_INVALID', `Unknown client scopes: ${unknown.join(', ')}`);
  }
  if (grantScopes.length > 0) {
    const { valid, unknown } = validateScopes(grantScopes);
    if (!valid) return fail(op, 'ADMIN_SCOPE_INVALID', `Unknown grant scopes: ${unknown.join(', ')}`);
  }

  if (args.dryRun) {
    dryRunNote(
      op,
      `Would bootstrap: client=${clientId}, merchant="${merchantName}", credential (1), grant (scopes=[${grantScopes.join(',')}])`,
      args.json,
    );
    return succeed(op, {
      dryRun: true,
      clientId,
      name,
      sourceApp,
      environment,
      merchantName,
      clientScopes: scopes,
      grantScopes,
    });
  }

  const steps: Record<string, unknown> = {};

  // ── Step 1: Create API client ───────────────────────────────────────────────
  try {
    const existing = await ctx.apiClientRepo.findById(clientId);
    if (existing) {
      return fail(op, 'ADMIN_ALREADY_EXISTS', `API client already exists: ${clientId}`);
    }
    const client = await ctx.apiClientRepo.create({
      id: clientId,
      name,
      sourceApp,
      environment,
      scopes,
      status: 'active',
      metadata: metadata ?? {},
    });
    steps['client'] = {
      clientId: client.id,
      name: client.name,
      sourceApp: client.sourceApp,
      environment: client.environment,
      status: client.status,
      scopes: client.scopes,
    };
    void writeAdminAuditLog(ctx.auditRepo, {
      action: AuditAction.ADMIN_API_CLIENT_CREATE,
      clientId: client.id,
      resourceType: 'api_client',
      resourceId: client.id,
      metadata: { clientId: client.id, name: client.name, via: 'bootstrap-bundle' },
    });
  } catch (err: any) {
    return fail(op, 'ADMIN_OPERATION_FAILED', `Step 1 (create-client) failed: ${err.message}`, steps);
  }

  // ── Step 2: Create credential ───────────────────────────────────────────────
  let rawCredential: string;
  try {
    const useCase = new CreateCredential(ctx.apiClientRepo, ctx.credentialRepo);
    const { credential, rawCredential: raw } = await useCase.execute({ clientId });
    rawCredential = raw;
    steps['credential'] = {
      credentialId: credential.id,
      credentialPrefix: credential.credentialPrefix,
      status: credential.status,
      rawCredential: raw,
    };
    void writeAdminAuditLog(ctx.auditRepo, {
      action: AuditAction.ADMIN_CLIENT_CREDENTIAL_CREATE,
      clientId,
      resourceType: 'client_credential',
      resourceId: credential.id,
      metadata: { clientId, credentialId: credential.id, credentialPrefix: credential.credentialPrefix, via: 'bootstrap-bundle' },
    });
  } catch (err: any) {
    return fail(op, 'ADMIN_OPERATION_FAILED', `Step 2 (create-credential) failed: ${err.message}`, steps);
  }

  // ── Step 3: Create merchant ─────────────────────────────────────────────────
  let merchantId: string;
  try {
    const createMerchant = new CreateMerchant(ctx.merchantRepo);
    const { merchant, created } = await createMerchant.execute({
      id: merchantIdFlag ?? undefined,
      name: merchantName,
      sourceApp,
      externalRef: merchantIdFlag ?? undefined,
    });
    merchantId = merchant.id;
    steps['merchant'] = {
      merchantId: merchant.id,
      displayName: merchant.displayName,
      status: merchant.status,
      created,
    };
    void writeAdminAuditLog(ctx.auditRepo, {
      action: AuditAction.ADMIN_MERCHANT_CREATE,
      merchantId: merchant.id,
      resourceType: 'merchant',
      resourceId: merchant.id,
      metadata: { merchantId: merchant.id, displayName: merchant.displayName, created, via: 'bootstrap-bundle' },
    });
  } catch (err: any) {
    return fail(op, 'ADMIN_OPERATION_FAILED', `Step 3 (create-merchant) failed: ${err.message}`, steps);
  }

  // ── Step 4: Grant merchant access ───────────────────────────────────────────
  try {
    const grant = await ctx.accessRepo.create({
      id: `cma_${randomUUID()}`,
      clientId,
      merchantId,
      scopes: grantScopes,
    });
    steps['grant'] = {
      grantId: grant.id,
      clientId: grant.clientId,
      merchantId: grant.merchantId,
      scopes: grant.scopes,
      status: grant.status,
    };
    void writeAdminAuditLog(ctx.auditRepo, {
      action: AuditAction.ADMIN_MERCHANT_GRANT,
      clientId,
      merchantId,
      resourceType: 'client_merchant_access',
      resourceId: grant.id,
      metadata: { clientId, merchantId, grantId: grant.id, scopes: grantScopes, via: 'bootstrap-bundle' },
    });
  } catch (err: any) {
    return fail(op, 'ADMIN_OPERATION_FAILED', `Step 4 (grant-merchant) failed: ${err.message}`, steps);
  }

  const result = succeed(op, { ...steps, rawCredential });
  return { ...result, rawCredential };
}
