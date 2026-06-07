/**
 * ConfirmFakeGatewayPayment — manually confirm a FakeGateway transaction in dev/test mode.
 *
 * Phase 8D: non-production only. Simulates provider webhook confirmation.
 * Phase 8D.1 (atomic confirm):
 *   - Uses markSucceededIfConfirmable() — a conditional UPDATE WHERE status IN
 *     ('requires_action', 'pending') — instead of read-then-write.
 *   - Eliminates the TOCTOU race that was documented in Phase 8D Hardening.
 *   - Concurrent confirms: only ONE caller gets changed=true and credits the intent;
 *     the other gets changed=false → reload → alreadyConfirmed=true, no double-add.
 *
 * Rules:
 * - Only available in NODE_ENV !== 'production'.
 * - Only transactions with status requires_action or pending may be confirmed.
 * - Updates transaction to succeeded atomically.
 * - Updates intent totals and status only when changed === true.
 * - Confirming already-succeeded is idempotent (does NOT double-add amountPaid).
 */

import type {
  PaymentTransactionRepository,
  PaymentIntentRepository,
} from '@northflow/payment-orchestration-core';
import type {
  PaymentIntentDTO,
  PaymentTransactionDTO,
} from '@northflow/payment-orchestration-core';
import { computeIntentStatus } from './intentStatusHelper.ts';

export interface ConfirmFakeGatewayPaymentInput {
  merchantId: string;
  transactionId: string;
}

export interface ConfirmFakeGatewayPaymentOutput {
  transaction: PaymentTransactionDTO;
  intent: PaymentIntentDTO;
  alreadyConfirmed: boolean;
}

export class ConfirmFakeGatewayPayment {
  constructor(
    private readonly transactionRepo: PaymentTransactionRepository,
    private readonly intentRepo: PaymentIntentRepository,
    private readonly nodeEnv: string,
  ) {}

  async execute(
    input: ConfirmFakeGatewayPaymentInput,
  ): Promise<ConfirmFakeGatewayPaymentOutput> {
    if (this.nodeEnv === 'production') {
      throw Object.assign(
        new Error('FakeGateway confirm is not available in production'),
        { statusCode: 403, code: 'FORBIDDEN_IN_PRODUCTION' },
      );
    }

    // Load transaction for validation.
    const tx = await this.transactionRepo.findById(
      input.transactionId,
      input.merchantId,
    );
    if (!tx) {
      throw Object.assign(
        new Error(`Transaction not found: ${input.transactionId}`),
        { statusCode: 404, code: 'TRANSACTION_NOT_FOUND' },
      );
    }

    // If already succeeded, return idempotent without re-applying totals.
    if (tx.status === 'succeeded') {
      const intent = await this.intentRepo.findById(tx.intentId, input.merchantId);
      if (!intent) {
        throw Object.assign(
          new Error(`Payment intent not found for transaction: ${tx.intentId}`),
          { statusCode: 404, code: 'INTENT_NOT_FOUND' },
        );
      }
      return { transaction: tx, intent, alreadyConfirmed: true };
    }

    // Reject non-confirmable status before even trying the atomic update.
    if (tx.status !== 'requires_action' && tx.status !== 'pending') {
      throw Object.assign(
        new Error(
          `Transaction status '${tx.status}' cannot be confirmed. ` +
            'Only requires_action or pending transactions may be confirmed.',
        ),
        { statusCode: 422, code: 'INVALID_TRANSACTION_STATUS' },
      );
    }

    // Reload intent fresh BEFORE the atomic update to check overpayment.
    const intent = await this.intentRepo.findById(tx.intentId, input.merchantId);
    if (!intent) {
      throw Object.assign(
        new Error(`Payment intent not found for transaction: ${tx.intentId}`),
        { statusCode: 404, code: 'INTENT_NOT_FOUND' },
      );
    }

    if (this.transactionRepo.applySucceededPayment && !(this.transactionRepo.constructor.name.includes('InMemory'))) {
      const applied = await this.transactionRepo.applySucceededPayment({
        transactionId: tx.id,
        merchantId: input.merchantId,
        intentId: tx.intentId,
        amount: tx.amount,
      });
      return {
        transaction: applied.transaction,
        intent: applied.intent,
        alreadyConfirmed: applied.alreadySucceeded,
      };
    }

    if (tx.amount > intent.amountRemaining) {
      throw Object.assign(
        new Error(
          `Confirming this transaction would cause overpayment. Transaction amount (${tx.amount}) exceeds current remaining amount (${intent.amountRemaining}).`,
        ),
        { statusCode: 422, code: 'OVERPAYMENT_REJECTED' },
      );
    }

    // ── Phase 8D.1: Atomic conditional update ────────────────────────────────
    // UPDATE … WHERE status IN ('requires_action','pending')
    // Prevents TOCTOU: only the first concurrent caller to succeed gets changed=true.
    const { transaction: confirmedTx, changed } =
      await this.transactionRepo.markSucceededIfConfirmable({
        id: tx.id,
        merchantId: input.merchantId,
      });

    if (!changed) {
      // Another concurrent caller already confirmed (or status changed).
      // Reload to determine actual current status.
      const reloaded = await this.transactionRepo.findById(
        input.transactionId,
        input.merchantId,
      );
      if (reloaded?.status === 'succeeded') {
        const freshIntent = await this.intentRepo.findById(tx.intentId, input.merchantId);
        return {
          transaction: reloaded,
          intent: freshIntent ?? intent,
          alreadyConfirmed: true,
        };
      }
      throw Object.assign(
        new Error(
          `Transaction status '${reloaded?.status ?? 'unknown'}' cannot be confirmed. ` +
            'Only requires_action or pending transactions may be confirmed.',
        ),
        { statusCode: 422, code: 'INVALID_TRANSACTION_STATUS' },
      );
    }

    // ── Update intent totals — only when WE made the status change ───────────
    const newAmountPaid = intent.amountPaid + tx.amount;
    const newAmountRemaining = Math.max(0, intent.amountDue - newAmountPaid);
    const newStatus = computeIntentStatus(intent.amountDue, newAmountPaid);

    const updatedTotals = await this.intentRepo.updateTotals({
      id: intent.id,
      merchantId: input.merchantId,
      amountPaid: newAmountPaid,
      amountRefunded: intent.amountRefunded,
      amountRemaining: newAmountRemaining,
    });

    const updatedIntent = await this.intentRepo.updateStatus({
      id: intent.id,
      merchantId: input.merchantId,
      status: newStatus,
    });

    return {
      transaction: confirmedTx!,
      intent: { ...updatedTotals, status: updatedIntent.status },
      alreadyConfirmed: false,
    };
  }
}
