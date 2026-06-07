/**
 * merchants — POST /v1/merchants, GET /v1/merchants/:id
 *
 * Phase 8D: real implementation wired to CreateMerchant and merchant repo.
 * Phase 8K: use frozen error envelope via apiErrorResponse().
 * Phase S3/S4/S5: merchant access guard, sourceApp enforcement, scope checks.
 * Phase S-Hardening P0.3/P0.4: use assertMerchantAccessWithScope (fail-closed + grant scopes).
 * Phase S1-P1.1: merchant creation is atomic — grant is always created or request fails.
 *   Normal clients cannot create an orphan merchant:
 *     - 503 SERVICE_MISCONFIGURED if accessRepo is missing before merchant creation.
 *     - Grant creation errors propagate as 500 (not swallowed).
 * Phase S8: audit log entries for all protected operations.
 */

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import type { ServiceContainer } from '../container.ts';
import { createMerchantWithGrantAtomic } from '../container.ts';
import { apiErrorResponse } from './utils.ts';
import { requireScope } from '../middleware/requireScope.ts';
import { assertMerchantAccessWithScope, assertSourceApp } from '../middleware/merchantAccess.ts';
import { auditSuccess, auditDenied, auditFailure, auditError } from '../audit/auditService.ts';
import { AuditAction } from '../audit/auditActions.ts';

export function createMerchantsRouter(container: ServiceContainer): Router {
  const router = Router();
  const accessRepo = container.authRepos?.clientMerchantAccessRepo;

  /**
   * POST /v1/merchants
   * S5: requires merchant:create scope (global).
   * S4: sourceApp must match authenticated client's sourceApp.
   * S3: newly-created merchant is linked to the creating client.
   * Note: no merchantId yet at creation time — no grant check needed here.
   */
  router.post('/', requireScope('merchant:create'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = req.body as Record<string, unknown>;
      const { id, name, legalName, externalRef, metadata } = body;

      if (!name || typeof name !== 'string') {
        void auditFailure(req, container, {
          action: AuditAction.MERCHANT_CREATE,
          errorCode: 'VALIDATION_ERROR',
          statusCode: 400,
        });
        res.status(400).json(apiErrorResponse('VALIDATION_ERROR', 'name is required and must be a string'));
        return;
      }

      // P1.1: fail-closed — normal (non-legacy, non-internal) clients require the access repo
      // to be present before we create the merchant. This prevents orphan merchants.
      const isNormalClient = req.auth!.clientId !== 'legacy' && req.auth!.sourceApp !== 'internal';
      if (isNormalClient && !accessRepo) {
        void auditFailure(req, container, {
          action: AuditAction.MERCHANT_CREATE,
          errorCode: 'SERVICE_MISCONFIGURED',
          statusCode: 503,
        });
        res.status(503).json(apiErrorResponse(
          'SERVICE_MISCONFIGURED',
          'Merchant access authorization service is unavailable.',
        ));
        return;
      }

      // S4: enforce sourceApp matches authenticated client
      const sourceAppErr = assertSourceApp(req.auth!, body);
      if (sourceAppErr) {
        void auditDenied(req, container, {
          action: AuditAction.MERCHANT_CREATE,
          errorCode: 'SOURCE_APP_MISMATCH',
          statusCode: 403,
        });
        res.status(403).json(sourceAppErr);
        return;
      }

      // P1.1: Atomic merchant + grant creation for normal clients.
      const merchantInput = {
        id: typeof id === 'string' ? id : undefined,
        name,
        legalName: typeof legalName === 'string' ? legalName : null,
        sourceApp: typeof body['sourceApp'] === 'string' ? body['sourceApp'] : null,
        externalRef: typeof externalRef === 'string' ? externalRef : null,
        metadata: metadata != null && typeof metadata === 'object' ? (metadata as Record<string, unknown>) : {},
      };

      let result;
      if (isNormalClient && accessRepo) {
        result = await createMerchantWithGrantAtomic(
          container,
          merchantInput,
          { clientId: req.auth!.clientId, scopes: req.auth!.scopes },
        );
      } else {
        result = await container.useCases.createMerchant.execute(merchantInput);
      }

      void auditSuccess(req, container, {
        action: AuditAction.MERCHANT_CREATE,
        resourceType: 'merchant',
        resourceId: result.merchant.id,
        statusCode: result.created ? 201 : 200,
      });

      res.status(result.created ? 201 : 200).json({
        ok: true,
        data: {
          id: result.merchant.id,
          name: result.merchant.displayName,
          legalName: result.merchant.legalName,
          status: result.merchant.status,
          metadata: result.merchant.metadata,
        },
      });
    } catch (err) {
      void auditError(req, container, {
        action: AuditAction.MERCHANT_CREATE,
        errorCode: err instanceof Error ? err.constructor.name : 'INTERNAL_ERROR',
      });
      next(err);
    }
  });

  /**
   * GET /v1/merchants/:id
   * requireScope: global client must have merchant:read.
   * assertMerchantAccessWithScope: grant must exist + grant must include merchant:read.
   */
  router.get('/:id', requireScope('merchant:read'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params['id'];
      if (!id) {
        res.status(400).json(apiErrorResponse('VALIDATION_ERROR', 'id is required'));
        return;
      }

      // P0.3/P0.4: merchant access + grant scope check
      const denied = await assertMerchantAccessWithScope(req.auth!, id, 'merchant:read', accessRepo);
      if (denied) {
        void auditDenied(req, container, {
          action: AuditAction.MERCHANT_READ,
          merchantId: id,
          resourceType: 'merchant',
          resourceId: id,
          errorCode: 'MERCHANT_ACCESS_DENIED',
        });
        res.status(denied.status).json(denied.body);
        return;
      }

      const merchant = await container.repos.merchantRepo.findById(id);
      if (!merchant) {
        void auditFailure(req, container, {
          action: AuditAction.MERCHANT_READ,
          merchantId: id,
          resourceType: 'merchant',
          resourceId: id,
          errorCode: 'MERCHANT_NOT_FOUND',
          statusCode: 404,
        });
        res.status(404).json(apiErrorResponse('MERCHANT_NOT_FOUND', `Merchant not found: ${id}`));
        return;
      }

      void auditSuccess(req, container, {
        action: AuditAction.MERCHANT_READ,
        merchantId: id,
        resourceType: 'merchant',
        resourceId: id,
        statusCode: 200,
      });

      res.json({
        ok: true,
        data: {
          id: merchant.id,
          name: merchant.displayName,
          legalName: merchant.legalName,
          status: merchant.status,
          metadata: merchant.metadata,
        },
      });
    } catch (err) {
      void auditError(req, container, {
        action: AuditAction.MERCHANT_READ,
        merchantId: req.params['id'],
        errorCode: err instanceof Error ? err.constructor.name : 'INTERNAL_ERROR',
      });
      next(err);
    }
  });

  return router;
}
