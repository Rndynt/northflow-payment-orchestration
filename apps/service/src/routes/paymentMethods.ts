/**
 * paymentMethods — S7.5: routes for per-provider-account payment method management.
 *
 * Route hierarchy:
 *   /v1/merchants/:merchantId/provider-accounts/:providerAccountId/methods
 *     GET    /            → listByProviderAccount
 *     PUT    /:method     → upsertProviderAccountMethod
 *     POST   /sync        → syncProviderAccountMethods
 *
 *   /v1/merchants/:merchantId/payment-methods
 *     GET    /            → listByMerchant (active methods across all PA)
 *
 *   /v1/payment-intents/:intentId/payment-options
 *     GET    /            → getPaymentMethodOptions
 *
 * Scopes (required one-of):
 *   read endpoints  → payment_method:read  OR provider_account:read
 *   write/upsert    → payment_method:write OR provider_account:create
 *   sync            → payment_method:sync  OR provider_account:create
 *
 * S1-S5 auth guards are applied at the app.ts /v1 level.
 * Per-merchant access checked via assertMerchantAccessWithScope.
 *
 * Security (P0.3 fail-closed):
 *   assertMerchantAccessWithAnyScope is called unconditionally on all routes.
 *   assertMerchantAccessWithScope (called inside) rejects normal API clients with
 *   503 SERVICE_MISCONFIGURED when accessRepo is missing — fail closed, not fail open.
 *   Only legacy (clientId='legacy') and internal (sourceApp='internal') clients bypass.
 *
 * Phase S8: audit log entries for all protected operations.
 */

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { requireAnyScope } from '../middleware/requireAnyScope.ts';
import { assertMerchantAccessWithScope } from '../middleware/merchantAccess.ts';
import type { MerchantAccessDenied } from '../middleware/merchantAccess.ts';
import type { ServiceContainer } from '../container.ts';
import type { ClientMerchantAccessRepository } from '@northflow/payment-orchestration-core';
import type { RequestAuthContext } from '../types/auth.ts';
import { UpsertProviderAccountMethod } from '../application/use-cases/UpsertProviderAccountMethod.ts';
import { SyncProviderAccountMethods } from '../application/use-cases/SyncProviderAccountMethods.ts';
import { ListProviderAccountMethods } from '../application/use-cases/ListProviderAccountMethods.ts';
import { GetPaymentMethodOptions } from '../application/use-cases/GetPaymentMethodOptions.ts';
import { auditSuccess, auditDenied, auditError } from '../audit/auditService.ts';
import { AuditAction } from '../audit/auditActions.ts';

/**
 * assertMerchantAccessWithAnyScope — S7.5 local helper.
 * Tries each scope in the list; returns null if ANY one passes.
 * Used so new payment_method:* scopes and legacy provider_account:* scopes
 * are both accepted in merchant access grants without needing re-credentialing.
 *
 * Fail-closed: delegates to assertMerchantAccessWithScope which returns
 * 503 SERVICE_MISCONFIGURED for normal API clients when accessRepo is missing.
 * This helper must be called unconditionally (no `if (accessRepo)` guard).
 */
async function assertMerchantAccessWithAnyScope(
  auth: RequestAuthContext,
  merchantId: string,
  scopeList: string[],
  accessRepo: ClientMerchantAccessRepository | undefined,
): Promise<MerchantAccessDenied | null> {
  let lastDenied: MerchantAccessDenied | null = null;
  for (const scope of scopeList) {
    const result = await assertMerchantAccessWithScope(auth, merchantId, scope, accessRepo);
    if (!result) return null; // at least one scope passed
    lastDenied = result;
  }
  return lastDenied;
}

function serializeMethod(m: {
  id: string;
  merchantId: string;
  providerAccountId: string;
  provider: string;
  method: string;
  methodType: string;
  providerMethodCode: string | null;
  displayName: string;
  status: string;
  currency: string;
  minAmount: number | null;
  maxAmount: number | null;
  sortOrder: number;
  publicConfig: Record<string, unknown>;
  providerMetadata: Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: m.id,
    merchantId: m.merchantId,
    providerAccountId: m.providerAccountId,
    provider: m.provider,
    method: m.method,
    methodType: m.methodType,
    providerMethodCode: m.providerMethodCode,
    displayName: m.displayName,
    status: m.status,
    currency: m.currency,
    minAmount: m.minAmount,
    maxAmount: m.maxAmount,
    sortOrder: m.sortOrder,
    publicConfig: m.publicConfig,
    metadata: m.metadata,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  };
}

/**
 * createProviderAccountMethodsSubRouter — routes nested under
 * /v1/merchants/:merchantId/provider-accounts/:providerAccountId
 *
 * Mount at:
 *   app.use('/v1/merchants/:merchantId/provider-accounts/:providerAccountId', createProviderAccountMethodsSubRouter(container))
 */
export function createProviderAccountMethodsSubRouter(container: ServiceContainer): Router {
  const router = Router({ mergeParams: true });

  const { providerAccountMethodRepo, providerAccountRepo, providerRegistry } = container as any;
  if (!providerAccountMethodRepo) return router; // graceful no-op if not wired

  const listUseCase = new ListProviderAccountMethods(
    container.repos.providerAccountRepo,
    providerAccountMethodRepo,
  );
  const upsertUseCase = new UpsertProviderAccountMethod(
    container.repos.providerAccountRepo,
    providerAccountMethodRepo,
  );
  const syncUseCase = new SyncProviderAccountMethods(
    container.repos.providerAccountRepo,
    providerAccountMethodRepo,
    container.providerRegistry,
  );

  const accessRepo = container.authRepos?.clientMerchantAccessRepo;

  /**
   * GET /v1/merchants/:merchantId/provider-accounts/:providerAccountId/methods
   *
   * requireAnyScope: payment_method:read OR provider_account:read
   * assertMerchantAccessWithAnyScope: fail-closed — called unconditionally.
   */
  router.get(
    '/methods',
    requireAnyScope('payment_method:read', 'provider_account:read'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { merchantId, providerAccountId } = req.params as { merchantId: string; providerAccountId: string };
        const denied = await assertMerchantAccessWithAnyScope(
          req.auth!,
          merchantId,
          ['payment_method:read', 'provider_account:read'],
          accessRepo,
        );
        if (denied) {
          void auditDenied(req, container, {
            action: AuditAction.PAYMENT_METHOD_LIST,
            merchantId,
            resourceType: 'provider_account',
            resourceId: providerAccountId,
            errorCode: 'MERCHANT_ACCESS_DENIED',
          });
          res.status(denied.status).json(denied.body);
          return;
        }
        const methods = await listUseCase.listByProviderAccount({ merchantId, providerAccountId });
        void auditSuccess(req, container, {
          action: AuditAction.PAYMENT_METHOD_LIST,
          merchantId,
          resourceType: 'provider_account',
          resourceId: providerAccountId,
          statusCode: 200,
        });
        res.json({ ok: true, data: methods.map(serializeMethod) });
      } catch (err) {
        void auditError(req, container, {
          action: AuditAction.PAYMENT_METHOD_LIST,
          merchantId: (req.params as any)['merchantId'],
          errorCode: err instanceof Error ? err.constructor.name : 'INTERNAL_ERROR',
        });
        next(err);
      }
    },
  );

  /**
   * PUT /v1/merchants/:merchantId/provider-accounts/:providerAccountId/methods/:method
   *
   * requireAnyScope: payment_method:write OR provider_account:create
   * assertMerchantAccessWithAnyScope: fail-closed — called unconditionally.
   */
  router.put(
    '/methods/:method',
    requireAnyScope('payment_method:write', 'provider_account:create'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { merchantId, providerAccountId, method } = req.params as { merchantId: string; providerAccountId: string; method: string };
        const denied = await assertMerchantAccessWithAnyScope(
          req.auth!,
          merchantId,
          ['payment_method:write', 'provider_account:create'],
          accessRepo,
        );
        if (denied) {
          void auditDenied(req, container, {
            action: AuditAction.PAYMENT_METHOD_UPSERT,
            merchantId,
            resourceType: 'provider_account',
            resourceId: providerAccountId,
            errorCode: 'MERCHANT_ACCESS_DENIED',
          });
          res.status(denied.status).json(denied.body);
          return;
        }
        const result = await upsertUseCase.execute({
          merchantId,
          providerAccountId,
          method,
          ...req.body,
        });
        void auditSuccess(req, container, {
          action: AuditAction.PAYMENT_METHOD_UPSERT,
          merchantId,
          resourceType: 'payment_method',
          resourceId: result.method.id,
          statusCode: result.created ? 201 : 200,
          metadata: { method },
        });
        res.status(result.created ? 201 : 200).json({ ok: true, data: { ...serializeMethod(result.method), created: result.created } });
      } catch (err) {
        void auditError(req, container, {
          action: AuditAction.PAYMENT_METHOD_UPSERT,
          merchantId: (req.params as any)['merchantId'],
          errorCode: err instanceof Error ? err.constructor.name : 'INTERNAL_ERROR',
        });
        next(err);
      }
    },
  );

  /**
   * POST /v1/merchants/:merchantId/provider-accounts/:providerAccountId/methods/sync
   *
   * requireAnyScope: payment_method:sync OR provider_account:create
   * assertMerchantAccessWithAnyScope: fail-closed — called unconditionally.
   */
  router.post(
    '/methods/sync',
    requireAnyScope('payment_method:sync', 'provider_account:create'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { merchantId, providerAccountId } = req.params as { merchantId: string; providerAccountId: string };
        const denied = await assertMerchantAccessWithAnyScope(
          req.auth!,
          merchantId,
          ['payment_method:sync', 'provider_account:create'],
          accessRepo,
        );
        if (denied) {
          void auditDenied(req, container, {
            action: AuditAction.PAYMENT_METHOD_SYNC,
            merchantId,
            resourceType: 'provider_account',
            resourceId: providerAccountId,
            errorCode: 'MERCHANT_ACCESS_DENIED',
          });
          res.status(denied.status).json(denied.body);
          return;
        }
        const result = await syncUseCase.execute({ merchantId, providerAccountId });
        void auditSuccess(req, container, {
          action: AuditAction.PAYMENT_METHOD_SYNC,
          merchantId,
          resourceType: 'provider_account',
          resourceId: providerAccountId,
          statusCode: 200,
          metadata: { syncedCount: result.syncedCount, skippedCount: result.skippedCount },
        });
        res.json({ ok: true, data: { methods: result.methods.map(serializeMethod), syncedCount: result.syncedCount, skippedCount: result.skippedCount, message: result.message } });
      } catch (err) {
        void auditError(req, container, {
          action: AuditAction.PAYMENT_METHOD_SYNC,
          merchantId: (req.params as any)['merchantId'],
          errorCode: err instanceof Error ? err.constructor.name : 'INTERNAL_ERROR',
        });
        next(err);
      }
    },
  );

  return router;
}

/**
 * createMerchantPaymentMethodsRouter — routes for merchant-level method listing.
 *
 * Mount at: /v1/merchants/:merchantId/payment-methods
 */
export function createMerchantPaymentMethodsRouter(container: ServiceContainer): Router {
  const router = Router({ mergeParams: true });

  const { providerAccountMethodRepo } = container as any;
  if (!providerAccountMethodRepo) return router;

  const listUseCase = new ListProviderAccountMethods(
    container.repos.providerAccountRepo,
    providerAccountMethodRepo,
  );

  const accessRepo = container.authRepos?.clientMerchantAccessRepo;

  /**
   * GET /v1/merchants/:merchantId/payment-methods
   *
   * assertMerchantAccessWithAnyScope: fail-closed — called unconditionally.
   */
  router.get(
    '/',
    requireAnyScope('payment_method:read', 'provider_account:read', 'intent:read'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { merchantId } = req.params as { merchantId: string };
        const denied = await assertMerchantAccessWithAnyScope(
          req.auth!,
          merchantId,
          ['payment_method:read', 'provider_account:read', 'intent:read'],
          accessRepo,
        );
        if (denied) {
          void auditDenied(req, container, {
            action: AuditAction.PAYMENT_METHOD_LIST,
            merchantId,
            errorCode: 'MERCHANT_ACCESS_DENIED',
          });
          res.status(denied.status).json(denied.body);
          return;
        }
        const methods = await listUseCase.listByMerchant({ merchantId });
        void auditSuccess(req, container, {
          action: AuditAction.PAYMENT_METHOD_LIST,
          merchantId,
          statusCode: 200,
          metadata: { count: methods.length },
        });
        res.json({ ok: true, data: methods.map(serializeMethod) });
      } catch (err) {
        void auditError(req, container, {
          action: AuditAction.PAYMENT_METHOD_LIST,
          merchantId: (req.params as any)['merchantId'],
          errorCode: err instanceof Error ? err.constructor.name : 'INTERNAL_ERROR',
        });
        next(err);
      }
    },
  );

  return router;
}

/**
 * createPaymentOptionsRouter — routes for intent-level payment option discovery.
 *
 * Mount at: /v1/payment-intents/:intentId/payment-options
 */
export function createPaymentOptionsRouter(container: ServiceContainer): Router {
  const router = Router({ mergeParams: true });

  const { providerAccountMethodRepo } = container as any;
  if (!providerAccountMethodRepo) return router;

  const useCase = new GetPaymentMethodOptions(
    container.repos.intentRepo,
    providerAccountMethodRepo,
  );

  const accessRepo = container.authRepos?.clientMerchantAccessRepo;

  /**
   * GET /v1/payment-intents/:intentId/payment-options
   *
   * assertMerchantAccessWithAnyScope: fail-closed — called unconditionally.
   */
  router.get(
    '/',
    requireAnyScope('payment_method:read', 'intent:read'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { intentId } = req.params as { intentId: string };
        const merchantId =
          (req.query['merchantId'] as string) ??
          (req.headers['x-payment-merchant-id'] as string) ??
          (req.body as Record<string, unknown>)?.['merchantId'] as string;
        if (!merchantId) {
          res.status(400).json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'merchantId is required (query param or x-payment-merchant-id header)', details: null } });
          return;
        }
        const denied = await assertMerchantAccessWithAnyScope(
          req.auth!,
          merchantId,
          ['payment_method:read', 'intent:read'],
          accessRepo,
        );
        if (denied) {
          void auditDenied(req, container, {
            action: AuditAction.PAYMENT_OPTIONS_READ,
            merchantId,
            resourceType: 'payment_intent',
            resourceId: intentId,
            errorCode: 'MERCHANT_ACCESS_DENIED',
          });
          res.status(denied.status).json(denied.body);
          return;
        }
        const result = await useCase.execute({ intentId, merchantId });
        void auditSuccess(req, container, {
          action: AuditAction.PAYMENT_OPTIONS_READ,
          merchantId,
          resourceType: 'payment_intent',
          resourceId: intentId,
          statusCode: 200,
        });
        res.json({ ok: true, data: result });
      } catch (err) {
        void auditError(req, container, {
          action: AuditAction.PAYMENT_OPTIONS_READ,
          errorCode: err instanceof Error ? err.constructor.name : 'INTERNAL_ERROR',
        });
        next(err);
      }
    },
  );

  return router;
}
