/**
 * transactions — standalone payment transaction routes.
 *
 * Phase 8H: service-token protected provider status refresh endpoint.
 * Phase 8K: use frozen error envelope via apiErrorResponse().
 * Phase 8F: added POST /:id/refund and POST /:id/void for legacy parity.
 */

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import type { ServiceContainer } from '../container.ts';
import { resolveMerchantId, apiErrorResponse } from './utils.ts';

export function createTransactionsRouter(container: ServiceContainer): Router {
  const router = Router();

  /**
   * POST /v1/payment-transactions/:id/refresh-provider-status
   */
  router.post('/:id/refresh-provider-status', async (req: Request, res: Response, next: NextFunction) => {
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
   *
   * Refund a succeeded payment transaction (full or partial).
   *
   * Body:
   *   merchantId    string  — owner merchant (or x-payment-merchant-id header)
   *   amount        number  — refund amount in smallest currency unit (must be > 0)
   *   reason        string? — optional human-readable reason
   *   idempotencyKey string? — optional caller-supplied idempotency key
   */
  router.post('/:id/refund', async (req: Request, res: Response, next: NextFunction) => {
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
   *
   * Void (cancel) a pending or requires_action payment transaction.
   *
   * Body:
   *   merchantId  string  — owner merchant (or x-payment-merchant-id header)
   *   reason      string? — optional human-readable reason
   *   idempotencyKey string? — optional caller idempotency key
   */
  router.post('/:id/void', async (req: Request, res: Response, next: NextFunction) => {
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
