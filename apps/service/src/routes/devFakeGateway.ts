/**
 * devFakeGateway — POST /v1/dev/fake-gateway/transactions/:transactionId/confirm
 *
 * Phase 8D: dev/test-only route to manually confirm a FakeGateway transaction.
 * Phase 8D Hardening (Task 2): merchantId resolution with x-payment-merchant-id header fallback.
 *
 * ⚠ DISABLED IN PRODUCTION. This route does not exist in production builds.
 * Used to test the standalone service flow before real provider webhook wiring.
 */

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import type { ServiceContainer } from '../container.ts';
import { resolveMerchantId } from './utils.ts';

export function createDevFakeGatewayRouter(container: ServiceContainer): Router {
  const router = Router();

  /**
   * POST /v1/dev/fake-gateway/transactions/:transactionId/confirm
   *
   * Body: { merchantId?: string }
   * merchantId falls back to x-payment-merchant-id header when not in body.
   */
  router.post(
    '/transactions/:transactionId/confirm',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const transactionId = req.params['transactionId'];
        const body = req.body as Record<string, unknown>;

        if (!transactionId) {
          res.status(400).json({ ok: false, error: 'VALIDATION_ERROR', message: 'transactionId is required' });
          return;
        }

        const merchantId = resolveMerchantId(req, body['merchantId']);
        if (!merchantId) {
          res.status(400).json({ ok: false, error: 'VALIDATION_ERROR', message: 'merchantId is required (body or x-payment-merchant-id header)' });
          return;
        }

        const result = await container.useCases.confirmFakeGatewayPayment.execute({
          merchantId,
          transactionId,
        });

        res.json({
          ok: true,
          alreadyConfirmed: result.alreadyConfirmed,
          data: {
            transaction: serializeTransaction(result.transaction),
            intent: serializeIntent(result.intent),
          },
        });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
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

function serializeIntent(intent: {
  id: string;
  merchantId: string;
  status: string;
  amountDue: number;
  amountPaid: number;
  amountRefunded: number;
  amountRemaining: number;
  currency: string;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: intent.id,
    merchantId: intent.merchantId,
    status: intent.status,
    amountDue: intent.amountDue,
    amountPaid: intent.amountPaid,
    amountRefunded: intent.amountRefunded,
    amountRemaining: intent.amountRemaining,
    currency: intent.currency,
    expiresAt: intent.expiresAt ?? null,
    createdAt: intent.createdAt,
    updatedAt: intent.updatedAt,
  };
}
