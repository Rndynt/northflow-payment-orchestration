/**
 * merchants — POST /v1/merchants, GET /v1/merchants/:id
 *
 * Phase 8D: real implementation wired to CreateMerchant and merchant repo.
 * Phase 8K: use frozen error envelope via apiErrorResponse().
 * Phase S3/S4/S5: merchant access guard, sourceApp enforcement, scope checks.
 */

import { randomUUID } from 'crypto';
import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import type { ServiceContainer } from '../container.ts';
import { apiErrorResponse } from './utils.ts';
import { requireScope } from '../middleware/requireScope.ts';
import { assertMerchantAccess, assertSourceApp } from '../middleware/merchantAccess.ts';

export function createMerchantsRouter(container: ServiceContainer): Router {
  const router = Router();
  const accessRepo = container.authRepos?.clientMerchantAccessRepo;

  /**
   * POST /v1/merchants
   * Create or return existing merchant.
   * S5: requires merchant:create scope.
   * S4: sourceApp must match authenticated client's sourceApp.
   * S3: newly-created merchant is linked to the creating client.
   */
  router.post('/', requireScope('merchant:create'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = req.body as Record<string, unknown>;
      const { id, name, legalName, externalRef, metadata } = body;

      if (!name || typeof name !== 'string') {
        res.status(400).json(apiErrorResponse('VALIDATION_ERROR', 'name is required and must be a string'));
        return;
      }

      // S4: enforce sourceApp matches authenticated client
      const sourceAppErr = assertSourceApp(req.auth!, body);
      if (sourceAppErr) { res.status(403).json(sourceAppErr); return; }

      const result = await container.useCases.createMerchant.execute({
        id: typeof id === 'string' ? id : undefined,
        name,
        legalName: typeof legalName === 'string' ? legalName : null,
        sourceApp: typeof body['sourceApp'] === 'string' ? body['sourceApp'] : null,
        externalRef: typeof externalRef === 'string' ? externalRef : null,
        metadata: metadata != null && typeof metadata === 'object' ? (metadata as Record<string, unknown>) : {},
      });

      // S3: link newly-created merchant to the creating API client (non-legacy, non-system)
      if (result.created && accessRepo && req.auth && req.auth.clientId !== 'legacy' && req.auth.sourceApp !== 'internal') {
        await accessRepo.create({
          id: randomUUID(),
          clientId: req.auth.clientId,
          merchantId: result.merchant.id,
          scopes: req.auth.scopes,
        }).catch(() => {});
      }

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
      next(err);
    }
  });

  /**
   * GET /v1/merchants/:id
   * S5: requires merchant:read scope.
   * S3: client must have access to this merchant.
   */
  router.get('/:id', requireScope('merchant:read'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params['id'];
      if (!id) {
        res.status(400).json(apiErrorResponse('VALIDATION_ERROR', 'id is required'));
        return;
      }

      // S3: merchant ownership guard
      const denied = await assertMerchantAccess(req.auth!, id, accessRepo);
      if (denied) { res.status(403).json(denied); return; }

      const merchant = await container.repos.merchantRepo.findById(id);
      if (!merchant) {
        res.status(404).json(apiErrorResponse('MERCHANT_NOT_FOUND', `Merchant not found: ${id}`));
        return;
      }

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
      next(err);
    }
  });

  return router;
}
