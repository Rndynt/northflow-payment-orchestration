/**
 * RefundPaymentTransaction — initiate a full or partial refund for a succeeded payment.
 *
 * Phase 8F: legacy AuraPoS refund parity migration to standalone northflow service.
 *
 * Refund rules:
 * - Source transaction must be direction=incoming, status=succeeded, and a refundable type
 *   (payment | deposit | settlement).
 * - Refund amount must be > 0 and ≤ refundable amount (original amount minus any prior refunds).
 * - A child refund transaction (direction=outgoing, transactionType=refund) is created.
 * - If the provider implements refundPayment(), it is called and the result status is used.
 * - If the provider does NOT implement refundPayment() (e.g. manual/cash), the refund is
 *   recorded as succeeded immediately (offline/cash refund behaviour).
 * - On success, the parent intent's amountRefunded total is updated.
 *
 * No AuraPoS tenantId. No embedded payment runtime. Uses merchantId throughout.
 */

import { randomUUID } from 'crypto';
import type {
  PaymentIntentRepository,
  PaymentTransactionRepository,
  PaymentProviderAccountRepository,
  StandalonePaymentTransactionDTO,
  StandalonePaymentIntentDTO,
} from '@northflow/payment-orchestration-core';
import type { ProviderRegistry } from '../../infrastructure/providers/providerRegistry.ts';

const REFUNDABLE_TYPES = new Set(['payment', 'deposit', 'settlement']);

export interface RefundPaymentTransactionInput {
  merchantId: string;
  /** ID of the original payment transaction to refund. */
  transactionId: string;
  /** Amount to refund in the currency's smallest unit (e.g. IDR cents). Must be > 0. */
  amount: number;
  /** Optional human-readable reason (stored in metadata). */
  reason?: string | null;
  /** Caller-supplied idempotency key (stored on the refund transaction). */
  idempotencyKey?: string | null;
}

export interface RefundPaymentTransactionOutput {
  /** The newly created outgoing refund transaction. */
  refundTransaction: StandalonePaymentTransactionDTO;
  /** The parent intent with updated amountRefunded. */
  intent: StandalonePaymentIntentDTO;
  /** true if the provider API was called; false if recorded as manual/offline refund. */
  providerRefunded: boolean;
}

export class RefundPaymentTransaction {
  constructor(
    private readonly transactionRepo: PaymentTransactionRepository,
    private readonly intentRepo: PaymentIntentRepository,
    private readonly providerAccountRepo: PaymentProviderAccountRepository,
    private readonly providerRegistry: ProviderRegistry,
  ) {}

  async execute(input: RefundPaymentTransactionInput): Promise<RefundPaymentTransactionOutput> {
    const { merchantId, transactionId, amount, reason, idempotencyKey } = input;

    // ── 1. Validate amount ────────────────────────────────────────────────────
    if (!Number.isInteger(amount) || amount <= 0) {
      throw Object.assign(
        new Error('Refund amount must be a positive integer.'),
        { statusCode: 422, code: 'VALIDATION_ERROR' },
      );
    }

    // ── 2. Load the source transaction ────────────────────────────────────────
    const sourceTx = await this.transactionRepo.findById(transactionId, merchantId);
    if (!sourceTx) {
      throw Object.assign(
        new Error(`Payment transaction not found: ${transactionId}`),
        { statusCode: 404, code: 'TRANSACTION_NOT_FOUND' },
      );
    }

    // ── 3. Validate refundability ─────────────────────────────────────────────
    if (
      sourceTx.direction !== 'incoming' ||
      sourceTx.status !== 'succeeded' ||
      !REFUNDABLE_TYPES.has(sourceTx.transactionType)
    ) {
      throw Object.assign(
        new Error(
          `Transaction ${transactionId} is not refundable. ` +
          `Required: direction=incoming, status=succeeded, type in [${[...REFUNDABLE_TYPES].join(',')}]. ` +
          `Got: direction=${sourceTx.direction}, status=${sourceTx.status}, type=${sourceTx.transactionType}.`,
        ),
        { statusCode: 422, code: 'TRANSACTION_NOT_REFUNDABLE' },
      );
    }

    // ── 4. Check refundable amount ────────────────────────────────────────────
    const alreadyRefunded = await this.transactionRepo.sumSucceededRefundsByParent(transactionId);
    const refundableAmount = Math.max(0, sourceTx.amount - alreadyRefunded);
    if (amount > refundableAmount) {
      throw Object.assign(
        new Error(
          `Refund amount ${amount} exceeds refundable amount ${refundableAmount} ` +
          `(original: ${sourceTx.amount}, already refunded: ${alreadyRefunded}).`,
        ),
        { statusCode: 422, code: 'REFUND_EXCEEDS_REFUNDABLE' },
      );
    }

    // ── 5. Load intent ────────────────────────────────────────────────────────
    const intent = await this.intentRepo.findById(sourceTx.intentId, merchantId);
    if (!intent) {
      throw Object.assign(
        new Error(`Payment intent not found: ${sourceTx.intentId}`),
        { statusCode: 404, code: 'INTENT_NOT_FOUND' },
      );
    }

    // ── 6. Create refund transaction as 'pending' ─────────────────────────────
    const refundId = randomUUID();
    let refundTx = await this.transactionRepo.create({
      id: refundId,
      merchantId,
      intentId: sourceTx.intentId,
      providerAccountId: sourceTx.providerAccountId ?? null,
      provider: sourceTx.provider,
      method: sourceTx.method,
      transactionType: 'refund',
      direction: 'outgoing',
      status: 'pending',
      amount,
      currency: sourceTx.currency,
      parentTransactionId: transactionId,
      idempotencyKey: idempotencyKey ?? null,
      metadata: { reason: reason ?? null, refund_of: transactionId },
      rawProviderResponse: null,
    });

    // ── 7. Attempt provider refund ────────────────────────────────────────────
    const provider = this.providerRegistry.get(sourceTx.provider);
    let providerRefunded = false;
    let refundStatus: 'succeeded' | 'failed' | 'pending' = 'succeeded';
    let refundFailureReason: string | null = null;
    let refundProviderRef: string | null = null;
    let refundRawResponse: Record<string, unknown> = {};

    if (provider && typeof provider.refundPayment === 'function') {
      // Load provider account for credentials if linked
      let providerAccount = null;
      if (sourceTx.providerAccountId) {
        providerAccount = await this.providerAccountRepo.findById(
          sourceTx.providerAccountId,
          merchantId,
        );
      }

      const providerResult = await provider.refundPayment({
        transactionId,
        providerReference: sourceTx.providerReference,
        providerAccount,
        amount,
        currency: sourceTx.currency,
        reason: reason ?? null,
        metadata: { refund_transaction_id: refundId },
      });

      providerRefunded = true;
      refundStatus = providerResult.status;
      refundFailureReason = providerResult.failureReason;
      refundProviderRef = providerResult.providerReference;
      refundRawResponse = providerResult.rawProviderResponse;

      if (refundStatus === 'failed') {
        // Update refund transaction to failed
        refundTx = await this.transactionRepo.updateStatus({
          id: refundId,
          merchantId,
          status: 'failed',
          failureReason: refundFailureReason ?? 'PROVIDER_REFUND_REJECTED',
          providerReference: refundProviderRef ?? undefined,
        });
        throw Object.assign(
          new Error(`Provider rejected refund: ${refundFailureReason ?? 'unknown reason'}`),
          { statusCode: 502, code: 'PROVIDER_REFUND_FAILED' },
        );
      }
    } else {
      // No provider refundPayment → manual/offline refund, record as succeeded
      refundStatus = 'succeeded';
      refundRawResponse = {
        provider: sourceTx.provider,
        manual_refund: true,
        original_transaction_id: transactionId,
        amount,
        currency: sourceTx.currency,
        reason: reason ?? null,
      };
    }

    // ── 8. Update refund transaction to final status ──────────────────────────
    if (refundStatus !== 'pending') {
      refundTx = await this.transactionRepo.updateStatus({
        id: refundId,
        merchantId,
        status: refundStatus,
        failureReason: refundFailureReason ?? null,
        providerReference: refundProviderRef ?? undefined,
      });
    }

    // ── 9. Update intent amountRefunded (only if succeeded) ──────────────────
    let updatedIntent = intent;
    if (refundStatus === 'succeeded') {
      const newAmountRefunded = intent.amountRefunded + amount;
      updatedIntent = await this.intentRepo.updateTotals({
        id: intent.id,
        merchantId,
        amountPaid: intent.amountPaid,
        amountRefunded: newAmountRefunded,
        amountRemaining: intent.amountRemaining,
      });
    }

    return {
      refundTransaction: refundTx,
      intent: updatedIntent,
      providerRefunded,
    };
  }
}
