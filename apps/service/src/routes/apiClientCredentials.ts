/**
 * apiClientCredentials — S9.1: credential lifecycle management routes.
 *
 * Routes:
 *   POST /v1/api-clients/:clientId/credentials                      — create credential
 *   GET  /v1/api-clients/:clientId/credentials                      — list credentials
 *   POST /v1/api-clients/:clientId/credentials/rotate               — rotate (new + optional revoke old)
 *   POST /v1/api-clients/:clientId/credentials/:credentialId/revoke — revoke credential
 *
 * Access rules:
 *   - Legacy clients (clientId='legacy') and internal sourceApp clients may manage any clientId.
 *   - Normal API clients may only manage their own credentials (clientId === auth.clientId).
 *   - Managing another client's credentials returns 403 CREDENTIAL_NOT_OWNED.
 *
 * Required scopes:
 *   api_client:credential:create  — POST credentials
 *   api_client:credential:read    — GET credentials
 *   api_client:credential:revoke  — POST .../revoke
 *   api_client:credential:rotate  — POST .../rotate
 *
 * Security invariants enforced here:
 *   - rawCredential is returned only in create/rotate responses.
 *   - credentialHash is never included in any response.
 *   - Audit metadata never includes rawCredential, credentialHash, Authorization header,
 *     or x-nf-api-key values.
 */

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import type { ServiceContainer } from '../container.ts';
import { apiErrorResponse } from './utils.ts';
import { requireScope } from '../middleware/requireScope.ts';
import { auditSuccess, auditDenied, auditFailure } from '../audit/auditService.ts';
import { AuditAction } from '../audit/auditActions.ts';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * isSystemClient — true for legacy token clients and internal sourceApp clients.
 * System clients bypass per-client ownership checks and can manage any clientId.
 */
function isSystemClient(auth: NonNullable<Request['auth']>): boolean {
  return auth.clientId === 'legacy' || auth.sourceApp === 'internal';
}

/**
 * assertClientAccess — ensure the authenticated caller may manage the target clientId.
 * Returns a 403 deny response body if denied, null if allowed.
 */
function assertClientAccess(
  auth: NonNullable<Request['auth']>,
  targetClientId: string,
): ReturnType<typeof apiErrorResponse> | null {
  if (isSystemClient(auth)) return null;
  if (auth.clientId === targetClientId) return null;
  return apiErrorResponse(
    'CREDENTIAL_NOT_OWNED',
    'You may only manage credentials for your own API client.',
  );
}

// ── Router factory ────────────────────────────────────────────────────────────

export function createApiClientCredentialsRouter(container: ServiceContainer): Router {
  const router = Router({ mergeParams: true });
  const uc = container.useCases;

  // ── POST /v1/api-clients/:clientId/credentials ──────────────────────────────

  router.post(
    '/',
    requireScope('api_client:credential:create'),
    async (req: Request, res: Response, next: NextFunction) => {
      const clientId = req.params['clientId'];
      try {
        if (!clientId) {
          res.status(400).json(apiErrorResponse('VALIDATION_ERROR', 'clientId is required'));
          return;
        }

        const denied = assertClientAccess(req.auth!, clientId);
        if (denied) {
          void auditDenied(req, container, {
            action: AuditAction.API_CLIENT_CREDENTIAL_CREATE,
            errorCode: 'CREDENTIAL_NOT_OWNED',
            metadata: { clientId },
          });
          res.status(403).json(denied);
          return;
        }

        if (!uc.createCredential) {
          res.status(503).json(apiErrorResponse('SERVICE_MISCONFIGURED', 'Credential management is unavailable.'));
          return;
        }

        const body = req.body as Record<string, unknown>;
        const expiresAt = typeof body['expiresAt'] === 'string'
          ? new Date(body['expiresAt'])
          : null;

        if (expiresAt && isNaN(expiresAt.getTime())) {
          void auditFailure(req, container, {
            action: AuditAction.API_CLIENT_CREDENTIAL_CREATE,
            errorCode: 'VALIDATION_ERROR',
            statusCode: 400,
            metadata: { clientId },
          });
          res.status(400).json(apiErrorResponse('VALIDATION_ERROR', 'expiresAt must be a valid ISO 8601 date string'));
          return;
        }

        if (expiresAt && expiresAt <= new Date()) {
          void auditFailure(req, container, {
            action: AuditAction.API_CLIENT_CREDENTIAL_CREATE,
            errorCode: 'VALIDATION_ERROR',
            statusCode: 400,
            metadata: { clientId },
          });
          res.status(400).json(apiErrorResponse('VALIDATION_ERROR', 'expiresAt must be in the future'));
          return;
        }

        const result = await uc.createCredential.execute({ clientId, expiresAt });

        void auditSuccess(req, container, {
          action: AuditAction.API_CLIENT_CREDENTIAL_CREATE,
          resourceType: 'client_credential',
          resourceId: result.credential.id,
          statusCode: 201,
          metadata: {
            clientId,
            credentialId: result.credential.id,
            credentialPrefix: result.credential.credentialPrefix,
            status: result.credential.status,
            expiresAt: result.credential.expiresAt?.toISOString() ?? null,
          },
        });

        res.status(201).json({
          ok: true,
          data: {
            ...result.credential,
            rawCredential: result.rawCredential,
          },
        });
      } catch (err: unknown) {
        const e = err as { code?: string; statusCode?: number; message?: string };
        if (e.code === 'API_CLIENT_NOT_FOUND') {
          void auditFailure(req, container, {
            action: AuditAction.API_CLIENT_CREDENTIAL_CREATE,
            errorCode: 'API_CLIENT_NOT_FOUND',
            statusCode: 404,
            metadata: { clientId },
          });
          res.status(404).json(apiErrorResponse('API_CLIENT_NOT_FOUND', e.message ?? 'API client not found'));
          return;
        }
        next(err);
      }
    },
  );

  // ── GET /v1/api-clients/:clientId/credentials ───────────────────────────────

  router.get(
    '/',
    requireScope('api_client:credential:read'),
    async (req: Request, res: Response, next: NextFunction) => {
      const clientId = req.params['clientId'];
      try {
        if (!clientId) {
          res.status(400).json(apiErrorResponse('VALIDATION_ERROR', 'clientId is required'));
          return;
        }

        const denied = assertClientAccess(req.auth!, clientId);
        if (denied) {
          void auditDenied(req, container, {
            action: AuditAction.API_CLIENT_CREDENTIAL_READ,
            errorCode: 'CREDENTIAL_NOT_OWNED',
            metadata: { clientId },
          });
          res.status(403).json(denied);
          return;
        }

        if (!uc.listCredentials) {
          res.status(503).json(apiErrorResponse('SERVICE_MISCONFIGURED', 'Credential management is unavailable.'));
          return;
        }

        const result = await uc.listCredentials.execute({ clientId });

        void auditSuccess(req, container, {
          action: AuditAction.API_CLIENT_CREDENTIAL_READ,
          resourceType: 'client_credential',
          statusCode: 200,
          metadata: {
            clientId,
            count: result.credentials.length,
          },
        });

        res.json({ ok: true, data: result.credentials });
      } catch (err) {
        next(err);
      }
    },
  );

  // ── POST /v1/api-clients/:clientId/credentials/rotate ──────────────────────
  // IMPORTANT: must be registered BEFORE /:credentialId/revoke to avoid 'rotate'
  // being matched as a credentialId parameter.

  router.post(
    '/rotate',
    requireScope('api_client:credential:rotate'),
    async (req: Request, res: Response, next: NextFunction) => {
      const clientId = req.params['clientId'];
      try {
        if (!clientId) {
          res.status(400).json(apiErrorResponse('VALIDATION_ERROR', 'clientId is required'));
          return;
        }

        const denied = assertClientAccess(req.auth!, clientId);
        if (denied) {
          void auditDenied(req, container, {
            action: AuditAction.API_CLIENT_CREDENTIAL_ROTATE,
            errorCode: 'CREDENTIAL_NOT_OWNED',
            metadata: { clientId },
          });
          res.status(403).json(denied);
          return;
        }

        if (!uc.rotateCredential) {
          res.status(503).json(apiErrorResponse('SERVICE_MISCONFIGURED', 'Credential management is unavailable.'));
          return;
        }

        const body = req.body as Record<string, unknown>;
        const revokeOldCredentialId = typeof body['revokeOldCredentialId'] === 'string'
          ? body['revokeOldCredentialId']
          : null;
        const oldCredentialGracePeriodSeconds =
          typeof body['oldCredentialGracePeriodSeconds'] === 'number'
            ? body['oldCredentialGracePeriodSeconds']
            : null;
        const expiresAt = typeof body['expiresAt'] === 'string'
          ? new Date(body['expiresAt'])
          : null;

        if (expiresAt && isNaN(expiresAt.getTime())) {
          res.status(400).json(apiErrorResponse('VALIDATION_ERROR', 'expiresAt must be a valid ISO 8601 date string'));
          return;
        }

        const result = await uc.rotateCredential.execute({
          clientId,
          revokeOldCredentialId,
          oldCredentialGracePeriodSeconds,
          expiresAt,
        });

        void auditSuccess(req, container, {
          action: AuditAction.API_CLIENT_CREDENTIAL_ROTATE,
          resourceType: 'client_credential',
          resourceId: result.newCredential.id,
          statusCode: 201,
          metadata: {
            clientId,
            newCredentialId: result.newCredential.id,
            newCredentialPrefix: result.newCredential.credentialPrefix,
            revokedCredentialId: result.revokedCredential?.id ?? null,
            revokedCredentialPrefix: result.revokedCredential?.credentialPrefix ?? null,
            gracePeriodUnsupported: result.gracePeriodUnsupported,
          },
        });

        res.status(201).json({
          ok: true,
          data: {
            newCredential: {
              ...result.newCredential,
              rawCredential: result.rawCredential,
            },
            revokedCredential: result.revokedCredential,
            gracePeriodUnsupported: result.gracePeriodUnsupported,
          },
        });
      } catch (err: unknown) {
        const e = err as { code?: string; statusCode?: number; message?: string };
        if (e.code === 'API_CLIENT_NOT_FOUND') {
          void auditFailure(req, container, {
            action: AuditAction.API_CLIENT_CREDENTIAL_ROTATE,
            errorCode: 'API_CLIENT_NOT_FOUND',
            statusCode: 404,
            metadata: { clientId },
          });
          res.status(404).json(apiErrorResponse('API_CLIENT_NOT_FOUND', e.message ?? 'API client not found'));
          return;
        }
        next(err);
      }
    },
  );

  // ── POST /v1/api-clients/:clientId/credentials/:credentialId/revoke ─────────

  router.post(
    '/:credentialId/revoke',
    requireScope('api_client:credential:revoke'),
    async (req: Request, res: Response, next: NextFunction) => {
      const clientId = req.params['clientId'];
      const credentialId = req.params['credentialId'];
      try {
        if (!clientId || !credentialId) {
          res.status(400).json(apiErrorResponse('VALIDATION_ERROR', 'clientId and credentialId are required'));
          return;
        }

        const denied = assertClientAccess(req.auth!, clientId);
        if (denied) {
          void auditDenied(req, container, {
            action: AuditAction.API_CLIENT_CREDENTIAL_REVOKE,
            errorCode: 'CREDENTIAL_NOT_OWNED',
            metadata: { clientId, credentialId },
          });
          res.status(403).json(denied);
          return;
        }

        if (!uc.revokeCredential) {
          res.status(503).json(apiErrorResponse('SERVICE_MISCONFIGURED', 'Credential management is unavailable.'));
          return;
        }

        const result = await uc.revokeCredential.execute({ clientId, credentialId });

        void auditSuccess(req, container, {
          action: AuditAction.API_CLIENT_CREDENTIAL_REVOKE,
          resourceType: 'client_credential',
          resourceId: credentialId,
          statusCode: 200,
          metadata: {
            clientId,
            credentialId,
            credentialPrefix: result.credential.credentialPrefix,
            status: result.credential.status,
            revokedAt: result.credential.revokedAt?.toISOString() ?? null,
          },
        });

        res.json({ ok: true, data: result.credential });
      } catch (err: unknown) {
        const e = err as { code?: string; statusCode?: number; message?: string };
        if (e.code === 'CREDENTIAL_NOT_FOUND') {
          void auditFailure(req, container, {
            action: AuditAction.API_CLIENT_CREDENTIAL_REVOKE,
            errorCode: 'CREDENTIAL_NOT_FOUND',
            statusCode: 404,
            metadata: { clientId, credentialId },
          });
          res.status(404).json(apiErrorResponse('CREDENTIAL_NOT_FOUND', e.message ?? 'Credential not found'));
          return;
        }
        if (e.code === 'CREDENTIAL_NOT_OWNED') {
          void auditDenied(req, container, {
            action: AuditAction.API_CLIENT_CREDENTIAL_REVOKE,
            errorCode: 'CREDENTIAL_NOT_OWNED',
            statusCode: 403,
            metadata: { clientId, credentialId },
          });
          res.status(403).json(apiErrorResponse('CREDENTIAL_NOT_OWNED', e.message ?? 'Credential not owned'));
          return;
        }
        next(err);
      }
    },
  );

  return router;
}
