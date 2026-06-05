/**
 * VoidPaymentTransaction — cancel (void) a pending or requires_action payment transaction.
 *
 * Phase 8F: legacy AuraPoS void parity migration to standalone northflow service.
 *
 * Void rules:
 * - Source transaction must be direction=incoming, status in [pending, requires_action].
 * - If the provider implements cancelPayment(), it is called and the result is used.
 * - If the provider does NOT implement cancelPayment() (e.g. manual/cash), the transaction
 *   is marked 'cancelled' immediately without a provider API call.
 * - On success, the transaction status is set to 'cancelled'.
 * - Intent totals are NOT changed: the transaction was never succeeded, so amountPaid
 *   was never incremented for this transaction.
 *
 * No AuraPoS tenantId. No embedded payment runtime. Uses merchantId throughout.
 */

import type {
  PaymentIntentRepository,
  PaymentTransactionRepository,
  PaymentProviderAccountRepository,
  StandalonePaymentTransactionDTO,
  StandalonePaymentIntentDTO,
} from '@northflow/payment-orchestration-core';
import type { ProviderRegistry } from '../../infrastructure/providers/providerRegistry.ts';

const VOIDABLE_STATUSES = new Set(['pending', 'requires_action']);

export interface VoidPaymentTransactionInput {
  merchantId: string;
  /** ID of the payment transaction to void (cancel). */
  transactionId: string;
  /** Optional human-readable reason (stored in metadata). */
  reason?: string | null;
}

export interface VoidPaymentTransactionOutput {
  /** The transaction after being cancelled. */
  transaction: StandalonePaymentTransactionDTO;
  /** The parent intent (unchanged — totals not affected by void). */
  intent: StandalonePaymentIntentDTO | null;
  /** true if the provider API was called; false if voided directly (manual/no provider cancel). */
  providerCancelled: boolean;
}

export class VoidPaymentTransaction {
  constructor(
    private readonly transactionRepo: PaymentTransactionRepository,
    private readonly intentRepo: PaymentIntentRepository,
    private readonly providerAccountRepo: PaymentProviderAccountRepository,
    private readonly providerRegistry: ProviderRegistry,
  ) {}

  async execute(input: VoidPaymentTransactionInput): Promise<VoidPaymentTransactionOutput> {
    const { merchantId, transactionId, reason } = input;

    // ── 1. Load the transaction ───────────────────────────────────────────────
    const tx = await this.transactionRepo.findById(transactionId, merchantId);
    if (!tx) {
      throw Object.assign(
        new Error(`Payment transaction not found: ${transactionId}`),
        { statusCode: 404, code: 'TRANSACTION_NOT_FOUND' },
      );
    }

    // ── 2. Validate voidability ───────────────────────────────────────────────
    if (!VOIDABLE_STATUSES.has(tx.status) || tx.direction !== 'incoming') {
      throw Object.assign(
        new Error(
          `Transaction ${transactionId} cannot be voided. ` +
          `Required: direction=incoming, status in [${[...VOIDABLE_STATUSES].join(',')}]. ` +
          `Got: direction=${tx.direction}, status=${tx.status}.`,
        ),
        { statusCode: 422, code: 'TRANSACTION_NOT_VOIDABLE' },
      );
    }

    // ── 3. Attempt provider cancel ────────────────────────────────────────────
    const provider = this.providerRegistry.get(tx.provider);
    let providerCancelled = false;
    let cancelFailureReason: string | null = null;

    if (provider && typeof provider.cancelPayment === 'function') {
      let providerAccount = null;
      if (tx.providerAccountId) {
        providerAccount = await this.providerAccountRepo.findById(
          tx.providerAccountId,
          merchantId,
        );
      }

      const cancelResult = await provider.cancelPayment({
        transactionId,
        providerReference: tx.providerReference,
        providerAccount,
        reason: reason ?? null,
        metadata: { void_reason: reason ?? null },
      });

      providerCancelled = true;

      if (cancelResult.status === 'failed') {
        cancelFailureReason = cancelResult.failureReason;
        const failedTx = await this.transactionRepo.updateStatus({
          id: transactionId,
          merchantId,
          status: 'failed',
          failureReason: cancelFailureReason ?? 'PROVIDER_CANCEL_REJECTED',
        });
        throw Object.assign(
          new Error(`Provider rejected cancellation: ${cancelFailureReason ?? 'unknown reason'}`),
          { statusCode: 502, code: 'PROVIDER_CANCEL_FAILED' },
        );
      }
    }

    // ── 4. Mark transaction as cancelled ─────────────────────────────────────
    const cancelledTx = await this.transactionRepo.updateStatus({
      id: transactionId,
      merchantId,
      status: 'cancelled',
      failureReason: null,
    });

    // ── 5. Load intent (for response only — totals not changed) ───────────────
    let intent: StandalonePaymentIntentDTO | null = null;
    try {
      intent = await this.intentRepo.findById(tx.intentId, merchantId);
    } catch {
      // Non-fatal: intent metadata is informational in void response
    }

    return {
      transaction: cancelledTx,
      intent,
      providerCancelled,
    };
  }
}
