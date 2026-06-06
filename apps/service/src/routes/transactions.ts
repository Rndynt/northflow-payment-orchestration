/**
 * transactions — standalone payment transaction routes.
 *
 * Phase 8H: service-token protected provider status refresh endpoint.
 * Phase 8K: use frozen error envelope via apiErrorResponse().
 * Phase 8F: added POST /:id/refund and POST /:id/void for legacy parity.
 * Phase S3/S5: merchant access guard and scope checks.
 * Phase S-Hardening P0.3/P0.4: use assertMerchantAccessWithScope (fail-closed + grant scopes).
 */

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import type { ServiceContainer } from '../container.ts';
import { resolveMerchantId, apiErrorResponse } from './utils.ts';
import { requireScope } from '../middleware/requireScope.ts';
import { assertMerchantAccessWithScope } from '../middleware/merchantAccess.ts';

export function createTransactionsRouter(container: ServiceContainer): Router {
  const router = Router();
  const accessRepo = container.authRepos?.clientMerchantAccessRepo;

  /**
   * POST /v1/payment-transactions/:id/refresh-provider-status
   * requireScope: intent:read (global)
   * assertMerchantAccessWithScope: grant must include intent:read
   */
  router.post('/:id/refresh-provider-status', requireScope('intent:read'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const transactionId = req.params['id'];
      if (!transactionId) {
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
      const denied = await assertMerchantAccessWithScope(req.auth!, merchantId, 'intent:read', accessRepo);
      if (denied) { res.status(denied.status).json(denied.body); return; }

      const result = await container.useCases.refreshProviderStatus.execute({
        merchantId,
        transactionId,
      });

      res.json({
        ok: true,
        data: {
          transaction: serializeTransaction(result.transaction),
          intent: result.intent ? serializeIntent(result.intent) : null,
          providerStatus: result.providerStatus,
          changed: result.changed,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /v1/payment-transactions/:id/refund
   * requireScope: payment:refund (global)
   * assertMerchantAccessWithScope: grant must include payment:refund
   */
  router.post('/:id/refund', requireScope('payment:refund'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const transactionId = req.params['id'];
      if (!transactionId) {
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
      const denied = await assertMerchantAccessWithScope(req.auth!, merchantId, 'payment:refund', accessRepo);
      if (denied) { res.status(denied.status).json(denied.body); return; }

      const amount = body['amount'];
      if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) {
        res.status(400).json(apiErrorResponse('VALIDATION_ERROR', 'amount must be a positive integer'));
        return;
      }

      const reason = typeof body['reason'] === 'string' ? body['reason'] : null;
      const idempotencyKey = typeof body['idempotencyKey'] === 'string' ? body['idempotencyKey'] : null;

      const result = await container.useCases.refundPaymentTransaction.execute({
        merchantId,
        transactionId,
        amount,
        reason,
        idempotencyKey,
      });

      res.status(201).json({
        ok: true,
        data: {
          refundTransaction: serializeTransaction(result.refundTransaction),
          intent: serializeIntent(result.intent),
          providerRefunded: result.providerRefunded,
          idempotentReplay: result.idempotentReplay,
          refundableRemaining: result.refundableRemaining,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /v1/payment-transactions/:id/void
   * requireScope: payment:void (global)
   * assertMerchantAccessWithScope: grant must include payment:void
   */
  router.post('/:id/void', requireScope('payment:void'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const transactionId = req.params['id'];
      if (!transactionId) {
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
      const denied = await assertMerchantAccessWithScope(req.auth!, merchantId, 'payment:void', accessRepo);
      if (denied) { res.status(denied.status).json(denied.body); return; }

      const reason = typeof body['reason'] === 'string' ? body['reason'] : null;
      const idempotencyKey = typeof body['idempotencyKey'] === 'string' ? body['idempotencyKey'] : null;

      const result = await container.useCases.voidPaymentTransaction.execute({
        merchantId,
        transactionId,
        reason,
        idempotencyKey,
      });

      res.json({
        ok: true,
        data: {
          transaction: serializeTransaction(result.transaction),
          intent: result.intent ? serializeIntent(result.intent) : null,
          providerCancelled: result.providerCancelled,
          idempotentReplay: result.idempotentReplay,
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
  transactionType: string;
  direction: string;
  status: string;
  amount: number;
  currency: string;
  parentTransactionId?: string | null;
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
    transactionType: tx.transactionType,
    direction: tx.direction,
    status: tx.status,
    amount: tx.amount,
    currency: tx.currency,
    parentTransactionId: tx.parentTransactionId ?? null,
    providerReference: tx.providerReference,
    providerPaymentUrl: tx.providerPaymentUrl,
    providerQrString: tx.providerQrString,
    failureReason: tx.failureReason,
    createdAt: tx.createdAt,
    updatedAt: tx.updatedAt,
  };
}
