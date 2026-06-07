/**
 * auditLogs — S8: GET /v1/audit-logs
 *
 * Read API for the immutable service audit trail.
 *
 * Access control:
 *   - Requires scope: audit_log:read
 *   - Internal/legacy clients receive all entries (filterable via query params)
 *   - Normal API clients receive only entries for merchants they have access to.
 *     If merchantId is not provided, returns their own clientId-scoped entries.
 *
 * Query parameters:
 *   merchantId   — filter by merchant (access-checked for normal clients)
 *   clientId     — filter by client (internal/legacy only)
 *   action       — filter by action name
 *   status       — filter by status (success|failure|denied|error)
 *   limit        — max entries per page (default 50, max 200)
 *   offset       — pagination offset (default 0)
 */

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import type { ServiceContainer } from '../container.ts';
import { apiErrorResponse } from './utils.ts';
import { requireScope } from '../middleware/requireScope.ts';
import { assertMerchantAccessWithScope } from '../middleware/merchantAccess.ts';
import { auditSuccess, auditDenied, auditFailure } from '../audit/auditService.ts';
import { AuditAction } from '../audit/auditActions.ts';

export function createAuditLogsRouter(container: ServiceContainer): Router {
  const router = Router();
  const accessRepo = container.authRepos?.clientMerchantAccessRepo;

  /**
   * GET /v1/audit-logs
   *
   * requireScope: audit_log:read
   * Normal clients: scoped to their own clientId or an explicitly provided merchantId (with access check).
   * Internal/legacy clients: access all entries, filterable via query params.
   */
  router.get('/', requireScope('audit_log:read'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auditRepo = container.auditRepo;
      if (!auditRepo) {
        res.status(503).json(apiErrorResponse('SERVICE_MISCONFIGURED', 'Audit log service is unavailable.'));
        return;
      }

      const auth = req.auth!;
      const isPrivileged = auth.clientId === 'legacy' || auth.sourceApp === 'internal';

      const merchantIdParam = req.query['merchantId'] as string | undefined;
      const clientIdParam = req.query['clientId'] as string | undefined;
      const actionParam = req.query['action'] as string | undefined;
      const statusParam = req.query['status'] as string | undefined;
      const limitParam = req.query['limit'] ? parseInt(req.query['limit'] as string, 10) : 50;
      const offsetParam = req.query['offset'] ? parseInt(req.query['offset'] as string, 10) : 0;

      if (isNaN(limitParam) || isNaN(offsetParam)) {
        void auditFailure(req, container, { action: AuditAction.AUDIT_LOG_READ, statusCode: 400, errorCode: 'VALIDATION_ERROR' });
        res.status(400).json(apiErrorResponse('VALIDATION_ERROR', 'limit and offset must be integers'));
        return;
      }

      let resolvedMerchantId: string | null = merchantIdParam ?? null;
      let resolvedClientId: string | null = clientIdParam ?? null;

      // Normal clients: enforce scope on merchantId if provided, or default to self clientId filter
      if (!isPrivileged) {
        if (resolvedMerchantId) {
          const denied = await assertMerchantAccessWithScope(auth, resolvedMerchantId, 'audit_log:read', accessRepo);
          if (denied) {
            void auditDenied(req, container, {
              action: AuditAction.AUDIT_LOG_READ,
              merchantId: resolvedMerchantId,
              errorCode: 'MERCHANT_ACCESS_DENIED',
            });
            res.status(denied.status).json(denied.body);
            return;
          }
        } else {
          resolvedClientId = auth.clientId;
        }
        // Normal clients cannot query by arbitrary clientId
        if (clientIdParam && clientIdParam !== auth.clientId) {
          void auditDenied(req, container, {
            action: AuditAction.AUDIT_LOG_READ,
            errorCode: 'SCOPE_DENIED',
          });
          res.status(403).json(apiErrorResponse('SCOPE_DENIED', 'Normal clients can only query their own audit logs.'));
          return;
        }
      }

      const result = await auditRepo.list({
        merchantId: resolvedMerchantId,
        clientId: resolvedClientId,
        action: actionParam ?? null,
        status: (statusParam as any) ?? null,
        limit: limitParam,
        offset: offsetParam,
      });

      void auditSuccess(req, container, {
        action: AuditAction.AUDIT_LOG_READ,
        merchantId: resolvedMerchantId,
        statusCode: 200,
        metadata: { count: result.entries.length, total: result.total },
      });

      res.json({
        ok: true,
        data: {
          entries: result.entries.map(serializeAuditLog),
          total: result.total,
          limit: limitParam,
          offset: offsetParam,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

function serializeAuditLog(entry: {
  id: string;
  requestId: string;
  clientId: string | null;
  sourceApp: string | null;
  merchantId: string | null;
  actorType: string;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  status: string;
  httpMethod: string | null;
  path: string | null;
  statusCode: number | null;
  errorCode: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}) {
  return {
    id: entry.id,
    requestId: entry.requestId,
    clientId: entry.clientId,
    sourceApp: entry.sourceApp,
    merchantId: entry.merchantId,
    actorType: entry.actorType,
    action: entry.action,
    resourceType: entry.resourceType,
    resourceId: entry.resourceId,
    status: entry.status,
    httpMethod: entry.httpMethod,
    path: entry.path,
    statusCode: entry.statusCode,
    errorCode: entry.errorCode,
    metadata: entry.metadata,
    createdAt: entry.createdAt,
  };
}
