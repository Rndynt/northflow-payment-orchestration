/**
 * merchants — POST /v1/merchants, GET /v1/merchants/:id
 *
 * Phase 8D: real implementation wired to CreateMerchant and merchant repo.
 * Phase 8K: use frozen error envelope via apiErrorResponse().
 */

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import type { ServiceContainer } from '../container.ts';
import { apiErrorResponse } from './utils.ts';

export function createMerchantsRouter(container: ServiceContainer): Router {
  const router = Router();

  /**
   * POST /v1/merchants
   * Create or return existing merchant.
   */
  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id, name, legalName, sourceApp, externalRef, metadata } = req.body as Record<string, unknown>;

      if (!name || typeof name !== 'string') {
        res.status(400).json(apiErrorResponse('VALIDATION_ERROR', 'name is required and must be a string'));
        return;
      }

      const result = await container.useCases.createMerchant.execute({
        id: typeof id === 'string' ? id : undefined,
        name,
        legalName: typeof legalName === 'string' ? legalName : null,
        sourceApp: typeof sourceApp === 'string' ? sourceApp : null,
        externalRef: typeof externalRef === 'string' ? externalRef : null,
        metadata: metadata != null && typeof metadata === 'object' ? (metadata as Record<string, unknown>) : {},
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
      next(err);
    }
  });

  /**
   * GET /v1/merchants/:id
   */
  router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params['id'];
      if (!id) {
        res.status(400).json(apiErrorResponse('VALIDATION_ERROR', 'id is required'));
        return;
      }

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
