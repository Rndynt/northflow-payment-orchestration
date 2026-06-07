/**
 * providerAccounts — routes under /v1/merchants/:merchantId/provider-accounts
 *
 * Phase 8D: real implementation.
 * Phase 8K: use frozen error envelope via apiErrorResponse().
 * Phase S3/S5: merchant access guard and scope checks.
 * Phase S-Hardening P0.3/P0.4: use assertMerchantAccessWithScope (fail-closed + grant scopes).
 * Phase S8: audit log entries for all protected operations.
 */

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import type { ServiceContainer } from '../container.ts';
import { apiErrorResponse } from './utils.ts';
import { requireScope } from '../middleware/requireScope.ts';
import { assertMerchantAccessWithScope } from '../middleware/merchantAccess.ts';
import { auditSuccess, auditDenied, auditFailure, auditError } from '../audit/auditService.ts';
import { AuditAction } from '../audit/auditActions.ts';

export function createProviderAccountsRouter(container: ServiceContainer): Router {
  const router = Router({ mergeParams: true });
  const accessRepo = container.authRepos?.clientMerchantAccessRepo;

  /**
   * POST /v1/merchants/:merchantId/provider-accounts
   * requireScope: provider_account:create (global)
   * assertMerchantAccessWithScope: grant must include provider_account:create
   */
  router.post('/', requireScope('provider_account:create'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const merchantId = req.params['merchantId'];
      if (!merchantId) {
        res.status(400).json(apiErrorResponse('VALIDATION_ERROR', 'merchantId is required'));
        return;
      }

      // P0.3/P0.4: merchant access + grant scope check
      const denied = await assertMerchantAccessWithScope(req.auth!, merchantId, 'provider_account:create', accessRepo);
      if (denied) {
        void auditDenied(req, container, {
          action: AuditAction.PROVIDER_ACCOUNT_CREATE,
          merchantId,
          errorCode: 'MERCHANT_ACCESS_DENIED',
        });
        res.status(denied.status).json(denied.body);
        return;
      }

      const { id, provider, environment, providerAccountRef, credentialsRef, publicConfig, metadata } =
        req.body as Record<string, unknown>;

      if (!provider || typeof provider !== 'string') {
        res.status(400).json(apiErrorResponse('VALIDATION_ERROR', 'provider is required'));
        return;
      }
      if (!environment || !['sandbox', 'test', 'production'].includes(environment as string)) {
        res.status(400).json(apiErrorResponse('VALIDATION_ERROR', 'environment must be sandbox, test, or production'));
        return;
      }

      const result = await container.useCases.createProviderAccount.execute({
        merchantId,
        id: typeof id === 'string' ? id : undefined,
        provider,
        environment: environment as 'sandbox' | 'test' | 'production',
        providerAccountRef: typeof providerAccountRef === 'string' ? providerAccountRef : null,
        credentialsRef: typeof credentialsRef === 'string' ? credentialsRef : null,
        publicConfig: publicConfig != null && typeof publicConfig === 'object' ? (publicConfig as Record<string, unknown>) : {},
        metadata: metadata != null && typeof metadata === 'object' ? (metadata as Record<string, unknown>) : {},
      });

      const pa = result.providerAccount;

      void auditSuccess(req, container, {
        action: AuditAction.PROVIDER_ACCOUNT_CREATE,
        merchantId,
        resourceType: 'provider_account',
        resourceId: pa.id,
        statusCode: 201,
      });

      res.status(201).json({
        ok: true,
        data: {
          id: pa.id,
          merchantId: pa.merchantId,
          provider: pa.provider,
          environment: pa.environment,
          providerAccountRef: pa.providerAccountRef ?? null,
          status: pa.status,
          publicConfig: pa.publicConfig ?? {},
          metadata: pa.metadata ?? {},
        },
      });
    } catch (err) {
      void auditError(req, container, {
        action: AuditAction.PROVIDER_ACCOUNT_CREATE,
        merchantId: req.params['merchantId'],
        errorCode: err instanceof Error ? err.constructor.name : 'INTERNAL_ERROR',
      });
      next(err);
    }
  });

  /**
   * GET /v1/merchants/:merchantId/provider-accounts/:id
   * requireScope: provider_account:read (global)
   * assertMerchantAccessWithScope: grant must include provider_account:read
   */
  router.get('/:id', requireScope('provider_account:read'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const merchantId = req.params['merchantId'];
      const id = req.params['id'];
      if (!merchantId || !id) {
        res.status(400).json(apiErrorResponse('VALIDATION_ERROR', 'merchantId and id are required'));
        return;
      }

      // P0.3/P0.4: merchant access + grant scope check
      const denied = await assertMerchantAccessWithScope(req.auth!, merchantId, 'provider_account:read', accessRepo);
      if (denied) {
        void auditDenied(req, container, {
          action: AuditAction.PROVIDER_ACCOUNT_READ,
          merchantId,
          resourceType: 'provider_account',
          resourceId: id,
          errorCode: 'MERCHANT_ACCESS_DENIED',
        });
        res.status(denied.status).json(denied.body);
        return;
      }

      const pa = await container.repos.providerAccountRepo.findById(id, merchantId);
      if (!pa) {
        void auditFailure(req, container, {
          action: AuditAction.PROVIDER_ACCOUNT_READ,
          merchantId,
          resourceType: 'provider_account',
          resourceId: id,
          errorCode: 'PROVIDER_ACCOUNT_NOT_FOUND',
          statusCode: 404,
        });
        res.status(404).json(apiErrorResponse('PROVIDER_ACCOUNT_NOT_FOUND', `Provider account not found: ${id}`));
        return;
      }

      void auditSuccess(req, container, {
        action: AuditAction.PROVIDER_ACCOUNT_READ,
        merchantId,
        resourceType: 'provider_account',
        resourceId: id,
        statusCode: 200,
      });

      res.json({
        ok: true,
        data: {
          id: pa.id,
          merchantId: pa.merchantId,
          provider: pa.provider,
          environment: pa.environment,
          providerAccountRef: pa.providerAccountRef ?? null,
          status: pa.status,
          publicConfig: pa.publicConfig ?? {},
          metadata: pa.metadata ?? {},
        },
      });
    } catch (err) {
      void auditError(req, container, {
        action: AuditAction.PROVIDER_ACCOUNT_READ,
        merchantId: req.params['merchantId'],
        resourceType: 'provider_account',
        resourceId: req.params['id'],
        errorCode: err instanceof Error ? err.constructor.name : 'INTERNAL_ERROR',
      });
      next(err);
    }
  });

  return router;
}
