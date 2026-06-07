/**
 * listClients — S10: list all API clients (safe view, no credential material).
 *
 * Usage:
 *   nf-admin list-clients [--json]
 */

import type { ParsedArgs } from '../parseArgs.ts';
import { succeed, fail } from '../output.ts';
import type { CliOutput } from '../output.ts';
import type { AdminContext } from '../adminContext.ts';
import { poApiClients } from '../../infrastructure/schema.ts';

export async function runListClients(
  _args: ParsedArgs,
  ctx: AdminContext,
): Promise<CliOutput> {
  const op = 'list-clients';
  try {
    const rows = await ctx.db.select({
      id: poApiClients.id,
      name: poApiClients.name,
      sourceApp: poApiClients.sourceApp,
      environment: poApiClients.environment,
      status: poApiClients.status,
      scopes: poApiClients.scopes,
      createdAt: poApiClients.createdAt,
      updatedAt: poApiClients.updatedAt,
    }).from(poApiClients);

    return succeed(op, {
      clients: rows.map((r) => ({
        clientId: r.id,
        name: r.name,
        sourceApp: r.sourceApp,
        environment: r.environment,
        status: r.status,
        scopes: r.scopes ?? [],
        createdAt: r.createdAt,
      })),
      total: rows.length,
    });
  } catch (err: any) {
    return fail(op, 'ADMIN_OPERATION_FAILED', err.message ?? 'Failed to list API clients');
  }
}
