/**
 * adminAudit — S10: audit log helper for CLI admin commands.
 *
 * Unlike HTTP route audit helpers, CLI admin commands have no Express req object.
 * This helper writes audit entries directly from CLI context.
 *
 * Security rules:
 *   - Never store raw credentials, signing secrets, protected material, or DB URLs.
 *   - Never store Authorization headers.
 *   - Metadata must be safe and small.
 *   - Write errors are reported as warnings but do NOT roll back a successful operation.
 */

import { randomUUID } from 'node:crypto';
import type { AuditLogRepository } from '@northflow/payment-orchestration-core';

export interface AdminAuditInput {
  action: string;
  clientId?: string | null;
  merchantId?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  metadata?: Record<string, unknown>;
}

export async function writeAdminAuditLog(
  auditRepo: AuditLogRepository | undefined,
  input: AdminAuditInput,
): Promise<void> {
  if (!auditRepo) return;
  try {
    await auditRepo.create({
      id: randomUUID(),
      requestId: randomUUID(),
      clientId: input.clientId ?? null,
      sourceApp: 'admin-cli',
      merchantId: input.merchantId ?? null,
      actorType: 'internal',
      action: input.action,
      resourceType: input.resourceType ?? null,
      resourceId: input.resourceId ?? null,
      status: 'success',
      httpMethod: null,
      path: null,
      statusCode: null,
      errorCode: null,
      ipAddress: null,
      userAgent: 'nf-admin-cli',
      metadata: input.metadata ?? {},
    });
  } catch (err) {
    console.warn('[admin-audit] Warning: failed to write audit log:', {
      action: input.action,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
