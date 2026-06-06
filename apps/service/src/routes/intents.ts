/**
 * intents — payment intent routes for payment-orchestration-service.
 *
 * Phase 8D: real implementation wired to use cases.
 * Phase 8D Hardening (Task 2): merchantId resolution with x-payment-merchant-id header fallback.
 * Phase 8K: use frozen error envelope via apiErrorResponse().
 * Phase S3/S4/S5: merchant access guard, sourceApp enforcement, scope checks.
 * Phase S-Hardening P0.3/P0.4: use assertMerchantAccessWithScope (fail-closed + grant scopes).
 *
 * Routes:
 *   POST /v1/payment-intents            [intent:create]
 *   GET  /v1/payment-intents/:id/status [intent:read]
 *   GET  /v1/payment-intents/:id/refundability [intent:read]
 *   POST /v1/payment-intents/:id/gateway-payments [payment:create]
 *   POST /v1/payment-intents/:id/reconcile [payment:reconcile]
 */

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import type { ServiceContainer } from '../container.ts';
import { resolveMerchantId, resolveMerchantIdQuery, apiErrorResponse } from './utils.ts';
import { requireScope } from '../middleware/requireScope.ts';
import { assertMerchantAccessWithScope, assertSourceApp } from '../middleware/merchantAccess.ts';

export function createIntentsRouter(container: ServiceContainer): Router {
  const router = Router();
  const accessRepo = container.authRepos?.clientMerchantAccessRepo;

  /**
   * POST /v1/payment-intents
   * requireScope: intent:create (global)
   * assertMerchantAccessWithScope: grant must include intent:create
   */
  router.post('/', requireScope('intent:create'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = req.body as Record<string, unknown>;
      const {
        providerAccountId,
        externalTenantId,
        externalOutletId,
        externalLocationId,
        externalPayableType,
        externalPayableId,
        currency,
        amountDue,
        allowPartial,
        expiresAt,
        metadata,
        idempotencyKey,
      } = body;

      const merchantId = resolveMerchantId(req, body['merchantId']);
      if (!merchantId) {
        res.status(400).json(apiErrorResponse('VALIDATION_ERROR', 'merchantId is required (body or x-payment-merchant-id header)'));
        return;
      }

      // P0.3/P0.4: merchant access + grant scope check
      const denied = await assertMerchantAccessWithScope(req.auth!, merchantId, 'intent:create', accessRepo);
      if (denied) { res.status(denied.status).json(denied.body); return; }

      // S4: sourceApp enforcement
      const sourceAppErr = assertSourceApp(req.auth!, body);
      if (sourceAppErr) { res.status(403).json(sourceAppErr); return; }

      if (!externalPayableType || typeof externalPayableType !== 'string') {
        res.status(400).json(apiErrorResponse('VALIDATION_ERROR', 'externalPayableType is required'));
        return;
      }
      if (!externalPayableId || typeof externalPayableId !== 'string') {
        res.status(400).json(apiErrorResponse('VALIDATION_ERROR', 'externalPayableId is required'));
        return;
      }
      if (typeof amountDue !== 'number' || !Number.isInteger(amountDue) || amountDue <= 0) {
        res.status(400).json(apiErrorResponse('VALIDATION_ERROR', 'amountDue must be a positive integer'));
        return;
      }

      const result = await container.useCases.createPaymentIntent.execute({
        merchantId,
        providerAccountId: typeof providerAccountId === 'string' ? providerAccountId : null,
        sourceApp: typeof body['sourceApp'] === 'string' ? body['sourceApp'] : null,
        externalTenantId: typeof externalTenantId === 'string' ? externalTenantId : null,
        externalOutletId: typeof externalOutletId === 'string' ? externalOutletId : null,
        externalLocationId: typeof externalLocationId === 'string' ? externalLocationId : null,
        externalPayableType,
        externalPayableId,
        currency: typeof currency === 'string' ? currency : 'IDR',
        amountDue,
        allowPartial: allowPartial === true,
        expiresAt: typeof expiresAt === 'string' ? new Date(expiresAt) : null,
        metadata: metadata != null && typeof metadata === 'object' ? (metadata as Record<string, unknown>) : null,
        idempotencyKey: typeof idempotencyKey === 'string' ? idempotencyKey : null,
      });

      res.status(result.created ? 201 : 200).json({
        ok: true,
        data: serializeIntent(result.intent),
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /v1/payment-intents/:id/status
   * requireScope: intent:read (global)
   * assertMerchantAccessWithScope: grant must include intent:read
   */
  router.get('/:id/status', requireScope('intent:read'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const intentId = req.params['id'];
      if (!intentId) {
        res.status(400).json(apiErrorResponse('VALIDATION_ERROR', 'id is required'));
        return;
      }

      const merchantId = resolveMerchantIdQuery(req);
      if (!merchantId) {
        res.status(400).json(apiErrorResponse('VALIDATION_ERROR', 'merchantId is required (query param or x-payment-merchant-id header)'));
        return;
      }

      // P0.3/P0.4: merchant access + grant scope check
      const denied = await assertMerchantAccessWithScope(req.auth!, merchantId, 'intent:read', accessRepo);
      if (denied) { res.status(denied.status).json(denied.body); return; }

      const result = await container.useCases.getPaymentIntentStatus.execute({
        intentId,
        merchantId,
      });

      res.json({
        ok: true,
        data: {
          intent: serializeIntent(result.intent),
          latestTransaction: result.latestTransaction
            ? serializeTransaction(result.latestTransaction)
            : null,
          isTerminal: result.isTerminal,
          requiresAction: result.requiresAction,
          canRetryPayment: result.canRetryPayment,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /v1/payment-intents/:id/refundability
   * requireScope: intent:read (global)
   * assertMerchantAccessWithScope: grant must include intent:read
   */
  router.get('/:id/refundability', requireScope('intent:read'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const intentId = req.params['id'];
      if (!intentId) {
        res.status(400).json(apiErrorResponse('VALIDATION_ERROR', 'id is required'));
        return;
      }

      const merchantId = resolveMerchantIdQuery(req);
      if (!merchantId) {
        res.status(400).json(apiErrorResponse('VALIDATION_ERROR', 'merchantId is required (query param or x-payment-merchant-id header)'));
        return;
      }

      // P0.3/P0.4: merchant access + grant scope check
      const denied = await assertMerchantAccessWithScope(req.auth!, merchantId, 'intent:read', accessRepo);
      if (denied) { res.status(denied.status).json(denied.body); return; }

      const result = await container.useCases.getRefundability.execute({
        intentId,
        merchantId,
      });

      res.json({
        ok: true,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /v1/payment-intents/:id/gateway-payments
   * requireScope: payment:create (global)
   * assertMerchantAccessWithScope: grant must include payment:create
   */
  router.post('/:id/gateway-payments', requireScope('payment:create'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const intentId = req.params['id'];
      if (!intentId) {
        res.status(400).json(apiErrorResponse('VALIDATION_ERROR', 'intent id is required'));
        return;
      }

      const body = req.body as Record<string, unknown>;
      const { provider, method, amount, providerAccountId, idempotencyKey, metadata } = body;

      const merchantId = resolveMerchantId(req, body['merchantId']);
      if (!merchantId) {
        res.status(400).json(apiErrorResponse('VALIDATION_ERROR', 'merchantId is required (body or x-payment-merchant-id header)'));
        return;
      }

      // P0.3/P0.4: merchant access + grant scope check
      const denied = await assertMerchantAccessWithScope(req.auth!, merchantId, 'payment:create', accessRepo);
      if (denied) { res.status(denied.status).json(denied.body); return; }

      if (!provider || typeof provider !== 'string') {
        res.status(400).json(apiErrorResponse('VALIDATION_ERROR', 'provider is required'));
        return;
      }
      if (!method || typeof method !== 'string') {
        res.status(400).json(apiErrorResponse('VALIDATION_ERROR', 'method is required'));
        return;
      }
      if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) {
        res.status(400).json(apiErrorResponse('VALIDATION_ERROR', 'amount must be a positive integer'));
        return;
      }

      const result = await container.useCases.createGatewayPayment.execute({
        merchantId,
        intentId,
        provider,
        method,
        amount,
        providerAccountId: typeof providerAccountId === 'string' ? providerAccountId : null,
        idempotencyKey: typeof idempotencyKey === 'string' ? idempotencyKey : null,
        metadata: metadata != null && typeof metadata === 'object' ? (metadata as Record<string, unknown>) : null,
      });

      res.status(result.idempotentReplay ? 200 : 201).json({
        ok: true,
        data: {
          transaction: serializeTransaction(result.transaction),
          intent: serializeIntent(result.intent),
          idempotentReplay: result.idempotentReplay ?? false,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /v1/payment-intents/:id/reconcile
   * requireScope: payment:reconcile (global)
   * assertMerchantAccessWithScope: grant must include payment:reconcile
   */
  router.post('/:id/reconcile', requireScope('payment:reconcile'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const intentId = req.params['id'];
      if (!intentId) {
        res.status(400).json(apiErrorResponse('VALIDATION_ERROR', 'id is required'));
        return;
      }

      const body = req.body as Record<string, unknown>;
      const merchantId = resolveMerchantId(req, body['merchantId']);
      if (!merchantId) {
        res.status(400).json(apiErrorResponse('VALIDATION_ERROR', 'merchantId is required (body or x-payment-merchant-id header)'));
        return;
      }

      // P0.3/P0.4: merchant access + grant scope check
      const denied = await assertMerchantAccessWithScope(req.auth!, merchantId, 'payment:reconcile', accessRepo);
      if (denied) { res.status(denied.status).json(denied.body); return; }

      const result = await container.useCases.reconcilePaymentIntentTotals.execute({
        merchantId,
        intentId,
      });

      res.json({
        ok: true,
        data: {
          intent: serializeIntent(result.intent),
          before: result.before,
          after: result.after,
          changed: result.changed,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

function serializeIntent(intent: {
  id: string;
  merchantId: string;
  externalPayableType: string;
  externalPayableId: string;
  currency: string;
  amountDue: number;
  amountPaid: number;
  amountRefunded: number;
  amountRemaining: number;
  status: string;
  allowPartial: boolean;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: intent.id,
    merchantId: intent.merchantId,
    externalPayableType: intent.externalPayableType,
    externalPayableId: intent.externalPayableId,
    currency: intent.currency,
    amountDue: intent.amountDue,
    amountPaid: intent.amountPaid,
    amountRefunded: intent.amountRefunded,
    amountRemaining: intent.amountRemaining,
    status: intent.status,
    allowPartial: intent.allowPartial,
    expiresAt: intent.expiresAt ?? null,
    createdAt: intent.createdAt,
    updatedAt: intent.updatedAt,
  };
}

function serializeTransaction(tx: {
  id: string;
  intentId: string;
  merchantId: string;
  provider: string;
  method: string;
  status: string;
  amount: number;
  currency: string;
  providerReference: string | null;
  providerPaymentUrl: string | null;
  providerQrString: string | null;
  failureReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: tx.id,
    intentId: tx.intentId,
    merchantId: tx.merchantId,
    provider: tx.provider,
    method: tx.method,
    status: tx.status,
    amount: tx.amount,
    currency: tx.currency,
    providerReference: tx.providerReference,
    providerPaymentUrl: tx.providerPaymentUrl,
    providerQrString: tx.providerQrString,
    failureReason: tx.failureReason,
    createdAt: tx.createdAt,
    updatedAt: tx.updatedAt,
  };
}
