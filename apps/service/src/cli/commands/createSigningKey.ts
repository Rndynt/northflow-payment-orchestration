/**
 * createSigningKey — S10: create an HMAC signing key for an API client.
 *
 * Usage:
 *   nf-admin create-signing-key --client-id <id> [--expires-at ISO] [--dry-run] [--yes] [--json]
 *
 * Security:
 *   - rawSigningSecret is printed exactly once and never stored in logs or audit.
 *   - Only encrypted ciphertext is persisted.
 *   - Requires PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_SECRET to be configured.
 */

import { randomUUID, randomBytes } from 'node:crypto';
import type { ParsedArgs } from '../parseArgs.ts';
import { requireFlag, getFlag } from '../parseArgs.ts';
import { succeed, fail, dryRunNote, oneTimeSecretNote } from '../output.ts';
import type { CliOutput } from '../output.ts';
import type { AdminContext } from '../adminContext.ts';
import { writeAdminAuditLog } from '../adminAudit.ts';
import { AuditAction } from '../../audit/auditActions.ts';
import { encrypt, isEncryptionConfigured } from '../../security/signingSecretProtector.ts';

function generateSigningKeyPrefix(): string {
  return `nfsk.${randomBytes(8).toString('base64url').replace(/[^a-zA-Z0-9]/g, '').slice(0, 12)}`;
}

export async function runCreateSigningKey(
  args: ParsedArgs,
  ctx: AdminContext,
): Promise<CliOutput & { rawSigningSecret?: string }> {
  const op = 'create-signing-key';

  let clientId: string;
  try {
    clientId = requireFlag(args, 'client-id');
  } catch (err: any) {
    return fail(op, err.code ?? 'ADMIN_INVALID_ARGUMENT', err.message);
  }

  const expiresAtStr = getFlag(args, 'expires-at');
  let expiresAt: Date | null = null;
  if (expiresAtStr) {
    expiresAt = new Date(expiresAtStr);
    if (isNaN(expiresAt.getTime())) {
      return fail(op, 'ADMIN_INVALID_ARGUMENT', '--expires-at must be a valid ISO 8601 date string');
    }
    if (expiresAt <= new Date()) {
      return fail(op, 'ADMIN_INVALID_ARGUMENT', '--expires-at must be in the future');
    }
  }

  if (!isEncryptionConfigured()) {
    return fail(
      op,
      'ADMIN_CONFIG_MISSING',
      'Signing key encryption is not configured. Set PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_SECRET.',
    );
  }

  if (args.dryRun) {
    dryRunNote(op, `Would create signing key for client ${clientId}${expiresAt ? ` expiring ${expiresAt.toISOString()}` : ''}`, args.json);
    return succeed(op, { dryRun: true, clientId, expiresAt: expiresAt?.toISOString() ?? null });
  }

  try {
    const client = await ctx.apiClientRepo.findById(clientId);
    if (!client) {
      return fail(op, 'ADMIN_NOT_FOUND', `API client not found: ${clientId}`);
    }

    const rawSigningSecret = randomBytes(32).toString('base64url');
    const secretCiphertext = encrypt(rawSigningSecret);
    const keyPrefix = generateSigningKeyPrefix();
    const id = randomUUID();
    const keyVersion = (process.env['PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_KEY_VERSION'] ?? 'v1').trim();

    const signingKey = await ctx.signingKeyRepo.create({
      id,
      clientId,
      keyPrefix,
      secretCiphertext,
      secretKeyVersion: keyVersion,
      expiresAt,
    });

    void writeAdminAuditLog(ctx.auditRepo, {
      action: AuditAction.ADMIN_CLIENT_SIGNING_KEY_CREATE,
      clientId,
      resourceType: 'client_signing_key',
      resourceId: signingKey.id,
      metadata: {
        clientId,
        signingKeyId: signingKey.id,
        keyPrefix: signingKey.keyPrefix,
        expiresAt: signingKey.expiresAt?.toISOString() ?? null,
      },
    });

    const result = succeed(op, {
      signingKeyId: signingKey.id,
      clientId: signingKey.clientId,
      keyPrefix: signingKey.keyPrefix,
      status: signingKey.status,
      expiresAt: signingKey.expiresAt?.toISOString() ?? null,
      createdAt: signingKey.createdAt,
      rawSigningSecret,
    });

    if (!args.json) {
      oneTimeSecretNote(args.json);
    }

    return { ...result, rawSigningSecret };
  } catch (err: any) {
    return fail(op, 'ADMIN_OPERATION_FAILED', err.message ?? 'Failed to create signing key');
  }
}
