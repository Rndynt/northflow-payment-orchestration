/**
 * AuditLog — S8: immutable audit trail entry for protected service API activity.
 *
 * Audit logs answer: who called, which merchant, which action, outcome, when.
 * They must never contain secrets, credentials, authorization headers, or raw provider responses.
 */

export type AuditActorType =
  | 'api_client'
  | 'legacy_client'
  | 'internal'
  | 'system'
  | 'worker'
  | 'unknown';

export type AuditStatus =
  | 'success'
  | 'failure'
  | 'denied'
  | 'error';

export interface AuditLog {
  id: string;
  requestId: string;
  clientId: string | null;
  sourceApp: string | null;
  merchantId: string | null;
  actorType: AuditActorType;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  status: AuditStatus;
  httpMethod: string | null;
  path: string | null;
  statusCode: number | null;
  errorCode: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}
