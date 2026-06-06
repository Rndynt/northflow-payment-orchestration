/**
 * providerAccounts — routes under /v1/merchants/:merchantId/provider-accounts
 *
 * Phase 8D: real implementation.
 * Phase 8K: use frozen error envelope via apiErrorResponse().
 * Phase S3/S5: merchant access guard and scope checks.
 * Phase S-Hardening P0.3/P0.4: use assertMerchantAccessWithScope (fail-closed + grant scopes).
 */

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import type { ServiceContainer } from '../container.ts';
import { apiErrorResponse } from './utils.ts';
import { requireScope } from '../middleware/requireScope.ts';
import { assertMerchantAccessWithScope } from '../middleware/merchantAccess.ts';

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
      if (denied) { res.status(denied.status).json(denied.body); return; }

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
      if (denied) { res.status(denied.status).json(denied.body); return; }

      const pa = await container.repos.providerAccountRepo.findById(id, merchantId);
      if (!pa) {
        res.status(404).json(apiErrorResponse('PROVIDER_ACCOUNT_NOT_FOUND', `Provider account not found: ${id}`));
        return;
      }

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
