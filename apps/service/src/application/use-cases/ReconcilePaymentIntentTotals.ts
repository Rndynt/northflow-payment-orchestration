/**
 * ReconcilePaymentIntentTotals — reconciliation safety use case.
 *
 * Phase 8E Hardening: standalone reconciliation to fix transaction/intent total drift.
 *
 * Problem:
 *   Phase 8D.1 atomic confirm prevents double-confirm for the same transaction, but
 *   the transaction update and intent totals/status update still happen in separate
 *   steps. If the process crashes after a transaction is marked 'succeeded' but
 *   before intent totals/status are updated, the standalone DB becomes inconsistent.
 *
 * Solution:
 *   This use case recomputes intent totals from the actual transaction set and
 *   corrects any drift atomically. It is NOT a scheduled cron — it is a manual
 *   safety tool to be called explicitly (e.g., after crash recovery, or via a
 *   POST /v1/payment-intents/:id/reconcile endpoint).
 *
 * No legacy tenantId. No embedded payment runtime. No provider-level ops.
 * No refund implementation (Phase 8F+).
 */

import type {
  PaymentIntentRepository,
  PaymentTransactionRepository,
} from '@northflow/payment-orchestration-core';
import type { StandalonePaymentIntentDTO } from '@northflow/payment-orchestration-core';
import { computeIntentStatus } from './intentStatusHelper.ts';

export interface ReconcilePaymentIntentTotalsInput {
  merchantId: string;
  intentId: string;
}

export interface ReconcileIntentSnapshot {
  amountPaid: number;
  amountRefunded: number;
  amountRemaining: number;
  status: string;
}

export interface ReconcilePaymentIntentTotalsOutput {
  /** The intent after reconciliation (may be unchanged if changed=false). */
  intent: StandalonePaymentIntentDTO;
  /** Totals recorded in DB before reconciliation. */
  before: ReconcileIntentSnapshot;
  /** Recomputed totals from actual transaction state. */
  after: ReconcileIntentSnapshot;
  /** true if the intent was actually updated; false if totals were already correct. */
  changed: boolean;
}

export class ReconcilePaymentIntentTotals {
  constructor(
    private readonly intentRepo: PaymentIntentRepository,
    private readonly transactionRepo: PaymentTransactionRepository,
  ) {}

  async execute(
    input: ReconcilePaymentIntentTotalsInput,
  ): Promise<ReconcilePaymentIntentTotalsOutput> {
    const { merchantId, intentId } = input;

    // ── 1. Load intent ────────────────────────────────────────────────────────
    const intent = await this.intentRepo.findById(intentId, merchantId);
    if (!intent) {
      throw Object.assign(
        new Error(`Payment intent not found: ${intentId}`),
        { statusCode: 404, code: 'INTENT_NOT_FOUND' },
      );
    }

    // ── 2. Load all transactions for the intent ───────────────────────────────
    const transactions = await this.transactionRepo.findByIntentId(intentId, merchantId);

    // ── 3. Recompute totals from actual transaction state ─────────────────────
    //
    // amountPaid    = sum of succeeded INCOMING payments/deposits
    // amountRefunded= sum of succeeded OUTGOING refunds/reversals
    // amountRemaining = max(0, amountDue - amountPaid)
    //
    // Note: refund implementation is Phase 8F+; amountRefunded will be 0 until then.
    const amountPaid = transactions.reduce(
      (sum, tx) =>
        tx.status === 'succeeded' && tx.direction === 'incoming'
          ? sum + tx.amount
          : sum,
      0,
    );

    const amountRefunded = transactions.reduce(
      (sum, tx) =>
        tx.status === 'succeeded' && tx.direction === 'outgoing'
          ? sum + tx.amount
          : sum,
      0,
    );

    const amountRemaining = Math.max(0, intent.amountDue - amountPaid);
    const status = computeIntentStatus(intent.amountDue, amountPaid);

    // ── 4. Compare before / after ─────────────────────────────────────────────
    const before: ReconcileIntentSnapshot = {
      amountPaid: intent.amountPaid,
      amountRefunded: intent.amountRefunded,
      amountRemaining: intent.amountRemaining,
      status: intent.status,
    };

    const after: ReconcileIntentSnapshot = {
      amountPaid,
      amountRefunded,
      amountRemaining,
      status,
    };

    const changed =
      before.amountPaid !== after.amountPaid ||
      before.amountRefunded !== after.amountRefunded ||
      before.amountRemaining !== after.amountRemaining ||
      before.status !== after.status;

    // ── 5. No drift: return unchanged ─────────────────────────────────────────
    if (!changed) {
      return { intent, before, after, changed: false };
    }

    // ── 6. Drift detected: update totals then status ──────────────────────────
    let updatedIntent = await this.intentRepo.updateTotals({
      id: intentId,
      merchantId,
      amountPaid,
      amountRefunded,
      amountRemaining,
    });

    if (before.status !== after.status) {
      updatedIntent = await this.intentRepo.updateStatus({
        id: intentId,
        merchantId,
        status,
      });
    }

    return { intent: updatedIntent, before, after, changed: true };
  }
}
