/**
 * signingKeys — S9.4: HMAC signing key lifecycle management routes.
 *
 * Routes:
 *   POST /v1/api-clients/:clientId/signing-keys                     — create signing key
 *   GET  /v1/api-clients/:clientId/signing-keys                     — list signing keys
 *   POST /v1/api-clients/:clientId/signing-keys/rotate              — rotate signing key
 *   POST /v1/api-clients/:clientId/signing-keys/:signingKeyId/revoke — revoke signing key
 *
 * Required scopes:
 *   api_client:signing_key:create
 *   api_client:signing_key:read
 *   api_client:signing_key:rotate
 *   api_client:signing_key:revoke
 *
 * Security invariants:
 *   - rawSigningSecret is returned ONLY in create/rotate responses — never again.
 *   - secretCiphertext is NEVER returned in any response.
 *   - Audit metadata never includes rawSigningSecret or secretCiphertext.
 *   - Normal API clients may only manage their own signing keys.
 *   - System/internal clients may manage any client's signing keys.
 *
 * Encryption dependency:
 *   - If PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_SECRET is not set,
 *     create/rotate fails with 503 SERVICE_MISCONFIGURED.
 *   - Bearer auth still works in optional mode even without the encryption secret.
 */

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { randomUUID, randomBytes } from 'node:crypto';
import type { ServiceContainer } from '../container.ts';
import { apiErrorResponse } from './utils.ts';
import { requireScope } from '../middleware/requireScope.ts';
import { auditSuccess, auditDenied, auditFailure } from '../audit/auditService.ts';
import { AuditAction } from '../audit/auditActions.ts';
import { encrypt, isEncryptionConfigured } from '../security/signingSecretProtector.ts';

function generateSigningKeyPrefix(): string {
  const b = randomBytes(8).toString('base64url').replace(/[^a-zA-Z0-9]/g, '').slice(0, 12);
  return `nfsk.${b}`;
}

function generateRawSigningSecret(): string {
  return randomBytes(32).toString('base64url');
}

function isSystemClient(auth: NonNullable<Request['auth']>): boolean {
  return auth.clientId === 'legacy' || auth.sourceApp === 'internal';
}

function assertClientAccess(
  auth: NonNullable<Request['auth']>,
  targetClientId: string,
): ReturnType<typeof apiErrorResponse> | null {
  if (isSystemClient(auth)) return null;
  if (auth.clientId === targetClientId) return null;
  return apiErrorResponse(
    'SIGNING_KEY_NOT_OWNED',
    'You may only manage signing keys for your own API client.',
  );
}

export function createSigningKeysRouter(container: ServiceContainer): Router {
  const router = Router({ mergeParams: true });
  const repos = container.signingKeyRepo;
  const clientRepo = container.authRepos?.apiClientRepo;

  // ── POST /v1/api-clients/:clientId/signing-keys ─────────────────────────────

  router.post(
    '/',
    requireScope('api_client:signing_key:create'),
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
            action: AuditAction.API_CLIENT_SIGNING_KEY_CREATE,
            errorCode: 'SIGNING_KEY_NOT_OWNED',
            metadata: { clientId },
          });
          res.status(403).json(denied);
          return;
        }

        if (!repos) {
          res.status(503).json(apiErrorResponse('SERVICE_MISCONFIGURED', 'Signing key management is unavailable.'));
          return;
        }

        if (!clientRepo) {
          res.status(503).json(apiErrorResponse('SERVICE_MISCONFIGURED', 'Signing key management is unavailable.'));
          return;
        }

        if (!isEncryptionConfigured()) {
          res.status(503).json(apiErrorResponse(
            'SERVICE_MISCONFIGURED',
            'Signing key encryption is not configured. Set PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_SECRET.',
          ));
          return;
        }

        const client = await clientRepo.findById(clientId);
        if (!client) {
          void auditFailure(req, container, {
            action: AuditAction.API_CLIENT_SIGNING_KEY_CREATE,
            errorCode: 'API_CLIENT_NOT_FOUND',
            statusCode: 404,
            metadata: { clientId },
          });
          res.status(404).json(apiErrorResponse('API_CLIENT_NOT_FOUND', 'API client not found'));
          return;
        }

        const body = req.body as Record<string, unknown>;
        const expiresAt = typeof body['expiresAt'] === 'string'
          ? new Date(body['expiresAt'])
          : null;

        if (expiresAt && isNaN(expiresAt.getTime())) {
          res.status(400).json(apiErrorResponse('VALIDATION_ERROR', 'expiresAt must be a valid ISO 8601 date string'));
          return;
        }
        if (expiresAt && expiresAt <= new Date()) {
          res.status(400).json(apiErrorResponse('VALIDATION_ERROR', 'expiresAt must be in the future'));
          return;
        }

        const rawSigningSecret = generateRawSigningSecret();
        const secretCiphertext = encrypt(rawSigningSecret);
        const keyPrefix = generateSigningKeyPrefix();
        const id = randomUUID();

        const keyVersion = (process.env['PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_KEY_VERSION'] ?? 'v1').trim();

        const signingKey = await repos.create({
          id,
          clientId,
          keyPrefix,
          secretCiphertext,
          secretKeyVersion: keyVersion,
          expiresAt,
        });

        void auditSuccess(req, container, {
          action: AuditAction.API_CLIENT_SIGNING_KEY_CREATE,
          resourceType: 'client_signing_key',
          resourceId: signingKey.id,
          statusCode: 201,
          metadata: {
            clientId,
            signingKeyId: signingKey.id,
            keyPrefix: signingKey.keyPrefix,
            status: signingKey.status,
            expiresAt: signingKey.expiresAt?.toISOString() ?? null,
          },
        });

        res.status(201).json({
          ok: true,
          data: {
            ...signingKey,
            rawSigningSecret,
          },
        });
      } catch (err) {
        next(err);
      }
    },
  );

  // ── GET /v1/api-clients/:clientId/signing-keys ──────────────────────────────

  router.get(
    '/',
    requireScope('api_client:signing_key:read'),
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
            action: AuditAction.API_CLIENT_SIGNING_KEY_READ,
            errorCode: 'SIGNING_KEY_NOT_OWNED',
            metadata: { clientId },
          });
          res.status(403).json(denied);
          return;
        }

        if (!repos) {
          res.status(503).json(apiErrorResponse('SERVICE_MISCONFIGURED', 'Signing key management is unavailable.'));
          return;
        }

        const keys = await repos.listByClientId(clientId);

        void auditSuccess(req, container, {
          action: AuditAction.API_CLIENT_SIGNING_KEY_READ,
          resourceType: 'client_signing_key',
          statusCode: 200,
          metadata: { clientId, count: keys.length },
        });

        res.json({ ok: true, data: keys });
      } catch (err) {
        next(err);
      }
    },
  );

  // ── POST /v1/api-clients/:clientId/signing-keys/rotate ─────────────────────
  // Must be registered BEFORE /:signingKeyId/revoke to prevent 'rotate' being
  // matched as a signingKeyId parameter.

  router.post(
    '/rotate',
    requireScope('api_client:signing_key:rotate'),
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
            action: AuditAction.API_CLIENT_SIGNING_KEY_ROTATE,
            errorCode: 'SIGNING_KEY_NOT_OWNED',
            metadata: { clientId },
          });
          res.status(403).json(denied);
          return;
        }

        if (!repos) {
          res.status(503).json(apiErrorResponse('SERVICE_MISCONFIGURED', 'Signing key management is unavailable.'));
          return;
        }

        if (!clientRepo) {
          res.status(503).json(apiErrorResponse('SERVICE_MISCONFIGURED', 'Signing key management is unavailable.'));
          return;
        }

        if (!isEncryptionConfigured()) {
          res.status(503).json(apiErrorResponse(
            'SERVICE_MISCONFIGURED',
            'Signing key encryption is not configured. Set PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_SECRET.',
          ));
          return;
        }

        const client = await clientRepo.findById(clientId);
        if (!client) {
          void auditFailure(req, container, {
            action: AuditAction.API_CLIENT_SIGNING_KEY_ROTATE,
            errorCode: 'API_CLIENT_NOT_FOUND',
            statusCode: 404,
            metadata: { clientId },
          });
          res.status(404).json(apiErrorResponse('API_CLIENT_NOT_FOUND', 'API client not found'));
          return;
        }

        const body = req.body as Record<string, unknown>;
        const revokeOldKeyId = typeof body['revokeOldKeyId'] === 'string'
          ? body['revokeOldKeyId']
          : null;
        const expiresAt = typeof body['expiresAt'] === 'string'
          ? new Date(body['expiresAt'])
          : null;

        if (expiresAt && isNaN(expiresAt.getTime())) {
          res.status(400).json(apiErrorResponse('VALIDATION_ERROR', 'expiresAt must be a valid ISO 8601 date string'));
          return;
        }
        if (expiresAt && expiresAt <= new Date()) {
          res.status(400).json(apiErrorResponse('VALIDATION_ERROR', 'expiresAt must be in the future'));
          return;
        }

        const rawSigningSecret = generateRawSigningSecret();
        const secretCiphertext = encrypt(rawSigningSecret);
        const keyPrefix = generateSigningKeyPrefix();
        const id = randomUUID();
        const keyVersion = (process.env['PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_KEY_VERSION'] ?? 'v1').trim();

        const newKey = await repos.create({
          id,
          clientId,
          keyPrefix,
          secretCiphertext,
          secretKeyVersion: keyVersion,
          expiresAt,
        });

        let revokedKey = null;
        if (revokeOldKeyId) {
          const old = await repos.findById(revokeOldKeyId);
          if (old && old.clientId === clientId && old.status === 'active') {
            await repos.revoke(revokeOldKeyId, new Date());
            revokedKey = { ...old, status: 'revoked' as const, revokedAt: new Date() };
          }
        }

        void auditSuccess(req, container, {
          action: AuditAction.API_CLIENT_SIGNING_KEY_ROTATE,
          resourceType: 'client_signing_key',
          resourceId: newKey.id,
          statusCode: 201,
          metadata: {
            clientId,
            newKeyId: newKey.id,
            newKeyPrefix: newKey.keyPrefix,
            revokedKeyId: revokedKey?.id ?? null,
            revokedKeyPrefix: revokedKey?.keyPrefix ?? null,
          },
        });

        res.status(201).json({
          ok: true,
          data: {
            newSigningKey: {
              ...newKey,
              rawSigningSecret,
            },
            revokedSigningKey: revokedKey,
          },
        });
      } catch (err) {
        next(err);
      }
    },
  );

  // ── POST /v1/api-clients/:clientId/signing-keys/:signingKeyId/revoke ─────────

  router.post(
    '/:signingKeyId/revoke',
    requireScope('api_client:signing_key:revoke'),
    async (req: Request, res: Response, next: NextFunction) => {
      const clientId = req.params['clientId'];
      const signingKeyId = req.params['signingKeyId'];
      try {
        if (!clientId || !signingKeyId) {
          res.status(400).json(apiErrorResponse('VALIDATION_ERROR', 'clientId and signingKeyId are required'));
          return;
        }

        const denied = assertClientAccess(req.auth!, clientId);
        if (denied) {
          void auditDenied(req, container, {
            action: AuditAction.API_CLIENT_SIGNING_KEY_REVOKE,
            errorCode: 'SIGNING_KEY_NOT_OWNED',
            metadata: { clientId, signingKeyId },
          });
          res.status(403).json(denied);
          return;
        }

        if (!repos) {
          res.status(503).json(apiErrorResponse('SERVICE_MISCONFIGURED', 'Signing key management is unavailable.'));
          return;
        }

        const key = await repos.findById(signingKeyId);
        if (!key) {
          void auditFailure(req, container, {
            action: AuditAction.API_CLIENT_SIGNING_KEY_REVOKE,
            errorCode: 'SIGNING_KEY_NOT_FOUND',
            statusCode: 404,
            metadata: { clientId, signingKeyId },
          });
          res.status(404).json(apiErrorResponse('SIGNING_KEY_NOT_FOUND', 'Signing key not found'));
          return;
        }

        if (key.clientId !== clientId) {
          void auditDenied(req, container, {
            action: AuditAction.API_CLIENT_SIGNING_KEY_REVOKE,
            errorCode: 'SIGNING_KEY_NOT_OWNED',
            metadata: { clientId, signingKeyId },
          });
          res.status(403).json(apiErrorResponse('SIGNING_KEY_NOT_OWNED', 'Signing key does not belong to this API client.'));
          return;
        }

        const revokedAt = new Date();
        if (key.status !== 'revoked') {
          await repos.revoke(signingKeyId, revokedAt);
        }

        const updated = await repos.findById(signingKeyId);

        void auditSuccess(req, container, {
          action: AuditAction.API_CLIENT_SIGNING_KEY_REVOKE,
          resourceType: 'client_signing_key',
          resourceId: signingKeyId,
          statusCode: 200,
          metadata: {
            clientId,
            signingKeyId,
            keyPrefix: key.keyPrefix,
            status: updated?.status ?? 'revoked',
            revokedAt: updated?.revokedAt?.toISOString() ?? null,
          },
        });

        res.json({ ok: true, data: updated ?? { ...key, status: 'revoked', revokedAt } });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
