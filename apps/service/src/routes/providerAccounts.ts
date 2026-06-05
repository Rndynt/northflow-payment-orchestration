/**
 * providerAccounts — routes under /v1/merchants/:merchantId/provider-accounts
 *
 * Phase 8D: real implementation.
 * Phase 8D Hardening (Task 3):
 *   - Return providerAccountRef directly from DTO field.
 *   - Never expose credentialsRef in any response.
 * Phase 8K: use frozen error envelope via apiErrorResponse().
 */

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import type { ServiceContainer } from '../container.ts';
import { apiErrorResponse } from './utils.ts';

export function createProviderAccountsRouter(container: ServiceContainer): Router {
  const router = Router({ mergeParams: true });

  /**
   * POST /v1/merchants/:merchantId/provider-accounts
   */
  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const merchantId = req.params['merchantId'];
      if (!merchantId) {
        res.status(400).json(apiErrorResponse('VALIDATION_ERROR', 'merchantId is required'));
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
      // ⚠ credentialsRef intentionally excluded from response.
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
      next(err);
    }
  });

  /**
   * GET /v1/merchants/:merchantId/provider-accounts/:id
   */
  router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const merchantId = req.params['merchantId'];
      const id = req.params['id'];
      if (!merchantId || !id) {
        res.status(400).json(apiErrorResponse('VALIDATION_ERROR', 'merchantId and id are required'));
        return;
      }

      const pa = await container.repos.providerAccountRepo.findById(id, merchantId);
      if (!pa) {
        res.status(404).json(apiErrorResponse('PROVIDER_ACCOUNT_NOT_FOUND', `Provider account not found: ${id}`));
        return;
      }

      // ⚠ credentialsRef intentionally excluded from response.
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
      next(err);
    }
  });

  return router;
}
