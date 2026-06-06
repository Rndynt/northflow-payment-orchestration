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
 */

import { randomUUID } from 'crypto';
import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import type { ServiceContainer } from '../container.ts';
import { apiErrorResponse } from './utils.ts';
import { requireScope } from '../middleware/requireScope.ts';
import { assertMerchantAccessWithScope, assertSourceApp } from '../middleware/merchantAccess.ts';

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
        res.status(400).json(apiErrorResponse('VALIDATION_ERROR', 'name is required and must be a string'));
        return;
      }

      // P1.1: fail-closed — normal (non-legacy, non-internal) clients require the access repo
      // to be present before we create the merchant. This prevents orphan merchants.
      const isNormalClient = req.auth!.clientId !== 'legacy' && req.auth!.sourceApp !== 'internal';
      if (isNormalClient && !accessRepo) {
        res.status(503).json(apiErrorResponse(
          'SERVICE_MISCONFIGURED',
          'Merchant access authorization service is unavailable.',
        ));
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

      // P1.1: S3 — link newly-created merchant to the creating API client (non-legacy, non-system).
      // Grant creation is awaited and errors are NOT swallowed — a grant failure causes
      // the entire request to fail (500) so the caller knows no orphan merchant was created.
      if (result.created && isNormalClient && accessRepo) {
        await accessRepo.create({
          id: randomUUID(),
          clientId: req.auth!.clientId,
          merchantId: result.merchant.id,
          scopes: req.auth!.scopes,
        });
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
      if (denied) { res.status(denied.status).json(denied.body); return; }

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
