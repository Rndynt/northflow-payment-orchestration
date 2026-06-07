/**
 * auditService — S8: helper utilities for writing audit log entries.
 *
 * All helpers are best-effort: write errors are logged to console.error
 * but must never propagate to the caller or break payment operations.
 *
 * Security rules:
 * - Never include authorization headers, API keys, credentials, or provider secrets.
 * - Metadata must be small (< 2KB) and safe.
 * - No full request bodies.
 * - No raw provider responses.
 *
 * Usage:
 *   await auditSuccess(req, container, { action: AuditAction.MERCHANT_CREATE, merchantId, resourceType: 'merchant', resourceId: merchant.id });
 *   await auditDenied(req, container, { action: AuditAction.MERCHANT_READ, merchantId, errorCode: 'MERCHANT_ACCESS_DENIED', statusCode: 403 });
 *   await auditFailure(req, container, { action: AuditAction.GATEWAY_PAYMENT_CREATE, merchantId, errorCode: 'INTENT_NOT_FOUND', statusCode: 404 });
 */

import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import type { ServiceContainer } from '../container.ts';
import type { RequestAuthContext } from '../types/auth.ts';
import type { AuditActorType, AuditStatus } from '@northflow/payment-orchestration-core';

export interface AuditEntryInput {
  action: string;
  merchantId?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  errorCode?: string | null;
  statusCode?: number | null;
  metadata?: Record<string, unknown>;
}

/**
 * resolveActorType — determines actor_type from the request auth context.
 */
function resolveActorType(auth: RequestAuthContext | undefined): AuditActorType {
  if (!auth) return 'unknown';
  if (auth.clientId === 'legacy') return 'legacy_client';
  if (auth.sourceApp === 'internal') return 'internal';
  return 'api_client';
}

/**
 * resolveIpAddress — extracts the client IP, respecting X-Forwarded-For from proxies.
 * Never returns values that look like secret material.
 */
function resolveIpAddress(req: Request): string | null {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0]?.trim() ?? null;
  }
  return req.socket?.remoteAddress ?? null;
}

/**
 * resolveUserAgent — extracts user-agent header. Truncated to 256 chars for safety.
 */
function resolveUserAgent(req: Request): string | null {
  const ua = req.headers['user-agent'];
  if (typeof ua !== 'string' || !ua) return null;
  return ua.slice(0, 256);
}

/**
 * sanitizePath — strips query strings from path for storage.
 * Ensures we store the route path, not query param values.
 */
function sanitizePath(req: Request): string | null {
  return req.path ?? null;
}

async function writeAuditLog(
  req: Request,
  container: ServiceContainer,
  status: AuditStatus,
  input: AuditEntryInput,
): Promise<void> {
  const auditRepo = container.auditRepo;
  if (!auditRepo) return;

  const auth = req.auth;
  const requestId: string = (req as any).requestId ?? randomUUID();

  try {
    await auditRepo.create({
      id: randomUUID(),
      requestId,
      clientId: auth?.clientId ?? null,
      sourceApp: auth?.sourceApp ?? null,
      merchantId: input.merchantId ?? null,
      actorType: resolveActorType(auth),
      action: input.action,
      resourceType: input.resourceType ?? null,
      resourceId: input.resourceId ?? null,
      status,
      httpMethod: req.method ?? null,
      path: sanitizePath(req),
      statusCode: input.statusCode ?? null,
      errorCode: input.errorCode ?? null,
      ipAddress: resolveIpAddress(req),
      userAgent: resolveUserAgent(req),
      metadata: input.metadata ?? {},
    });
  } catch (err) {
    console.error('[audit] Failed to write audit log:', {
      requestId,
      action: input.action,
      status,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * auditSuccess — records a successful protected operation.
 */
export async function auditSuccess(
  req: Request,
  container: ServiceContainer,
  input: AuditEntryInput & { statusCode?: number },
): Promise<void> {
  return writeAuditLog(req, container, 'success', {
    ...input,
    statusCode: input.statusCode ?? (req.res?.statusCode ?? null),
  });
}

/**
 * auditDenied — records a denied authorization attempt.
 */
export async function auditDenied(
  req: Request,
  container: ServiceContainer,
  input: AuditEntryInput,
): Promise<void> {
  return writeAuditLog(req, container, 'denied', {
    statusCode: 403,
    ...input,
  });
}

/**
 * auditFailure — records a business or use-case failure (e.g. not found, validation).
 */
export async function auditFailure(
  req: Request,
  container: ServiceContainer,
  input: AuditEntryInput,
): Promise<void> {
  return writeAuditLog(req, container, 'failure', input);
}

/**
 * auditError — records an unexpected internal error.
 */
export async function auditError(
  req: Request,
  container: ServiceContainer,
  input: AuditEntryInput,
): Promise<void> {
  return writeAuditLog(req, container, 'error', {
    statusCode: 500,
    ...input,
  });
}
