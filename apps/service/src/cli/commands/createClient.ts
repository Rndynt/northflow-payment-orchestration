/**
 * createClient — S10: create an API client.
 *
 * Usage:
 *   nf-admin create-client --client-id <id> --name <name> --source-app <app> --environment <env>
 *                          [--scopes scope1,scope2] [--metadata '{}'] [--dry-run] [--yes] [--json]
 */

import { randomUUID } from 'node:crypto';
import type { ParsedArgs } from '../parseArgs.ts';
import { getFlag, requireFlag, parseScopes, parseJsonFlag } from '../parseArgs.ts';
import { succeed, fail, dryRunNote } from '../output.ts';
import type { CliOutput } from '../output.ts';
import type { AdminContext } from '../adminContext.ts';
import { validateScopes } from '../adminContext.ts';
import { writeAdminAuditLog } from '../adminAudit.ts';
import { AuditAction } from '../../audit/auditActions.ts';

export async function runCreateClient(
  args: ParsedArgs,
  ctx: AdminContext,
): Promise<CliOutput> {
  const op = 'create-client';

  let clientId: string;
  let name: string;
  let sourceApp: string;
  let environment: string;

  try {
    clientId = getFlag(args, 'client-id') ?? `client_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    name = requireFlag(args, 'name');
    sourceApp = requireFlag(args, 'source-app');
    environment = requireFlag(args, 'environment');
  } catch (err: any) {
    return fail(op, err.code ?? 'ADMIN_INVALID_ARGUMENT', err.message);
  }

  const scopesRaw = getFlag(args, 'scopes');
  const scopes = scopesRaw ? parseScopes(scopesRaw) : [];
  let metadata: Record<string, unknown> | null = null;
  try {
    metadata = parseJsonFlag(args, 'metadata');
  } catch (err: any) {
    return fail(op, err.code ?? 'ADMIN_INVALID_ARGUMENT', err.message);
  }

  if (scopes.length > 0) {
    const { valid, unknown } = validateScopes(scopes);
    if (!valid) {
      return fail(op, 'ADMIN_SCOPE_INVALID', `Unknown scopes: ${unknown.join(', ')}`);
    }
  }

  if (args.dryRun) {
    dryRunNote(op, `Would create API client id=${clientId} name="${name}" sourceApp=${sourceApp} environment=${environment} scopes=[${scopes.join(',')}]`, args.json);
    return succeed(op, { dryRun: true, clientId, name, sourceApp, environment, scopes });
  }

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

    void writeAdminAuditLog(ctx.auditRepo, {
      action: AuditAction.ADMIN_API_CLIENT_CREATE,
      clientId: client.id,
      resourceType: 'api_client',
      resourceId: client.id,
      metadata: { clientId: client.id, name: client.name, sourceApp: client.sourceApp, environment: client.environment },
    });

    return succeed(op, {
      clientId: client.id,
      name: client.name,
      sourceApp: client.sourceApp,
      environment: client.environment,
      status: client.status,
      scopes: client.scopes,
      createdAt: client.createdAt,
    });
  } catch (err: any) {
    return fail(op, 'ADMIN_OPERATION_FAILED', err.message ?? 'Failed to create API client');
  }
}
