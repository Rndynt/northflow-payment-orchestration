/**
 * RefundPaymentTransaction — initiate a full or partial refund for a succeeded payment.
 *
 * Refund rules:
 * - Source transaction must be direction=incoming, status=succeeded, and refundable type.
 * - Refund amount must be > 0 and ≤ refundable amount.
 * - Idempotency key replay is scoped by merchant and must match this source transaction.
 * - Manual provider may refund offline; gateway providers must implement refundPayment().
 * - Race safety relies on the existing unique (merchant_id, idempotency_key) transaction index.
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
import { computeIntentStatusAfterRefund } from './intentStatusHelper.ts';

const REFUNDABLE_TYPES = new Set(['payment', 'deposit', 'settlement']);
const OFFLINE_REFUND_PROVIDERS = new Set(['manual']);

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
  /** The outgoing refund transaction, newly created or replayed idempotently. */
  refundTransaction: StandalonePaymentTransactionDTO;
  /** The parent intent with updated amountRefunded. */
  intent: StandalonePaymentIntentDTO;
  /** true if the provider API was called; false for manual/offline replay/refund. */
  providerRefunded: boolean;
  /** true when idempotencyKey matched a prior refund for the same source transaction. */
  idempotentReplay: boolean;
  /** Remaining refundable amount after this operation. */
  refundableRemaining?: number;
}

function isOfflineRefundProvider(providerCode: string): boolean {
  return OFFLINE_REFUND_PROVIDERS.has(providerCode);
}

function idempotencyConflict(message: string): Error {
  return Object.assign(new Error(message), { statusCode: 409, code: 'IDEMPOTENCY_CONFLICT' });
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

    if (!Number.isInteger(amount) || amount <= 0) {
      throw Object.assign(
        new Error('Refund amount must be a positive integer.'),
        { statusCode: 422, code: 'VALIDATION_ERROR' },
      );
    }

    const sourceTx = await this.transactionRepo.findById(transactionId, merchantId);
    if (!sourceTx) {
      throw Object.assign(
        new Error(`Payment transaction not found: ${transactionId}`),
        { statusCode: 404, code: 'TRANSACTION_NOT_FOUND' },
      );
    }

    const intent = await this.intentRepo.findById(sourceTx.intentId, merchantId);
    if (!intent) {
      throw Object.assign(
        new Error(`Payment intent not found: ${sourceTx.intentId}`),
        { statusCode: 404, code: 'INTENT_NOT_FOUND' },
      );
    }

    if (idempotencyKey) {
      const existing = await this.transactionRepo.findByMerchantIdempotencyKey(merchantId, idempotencyKey);
      if (existing) {
        const isSameRefund = existing.direction === 'outgoing'
          && existing.transactionType === 'refund'
          && existing.parentTransactionId === transactionId
          && existing.amount === amount
          && existing.currency === sourceTx.currency;

        if (!isSameRefund) {
          throw idempotencyConflict(
            `Idempotency key ${idempotencyKey} is already used for a different payment transaction operation.`,
          );
        }

        const alreadyRefunded = await this.transactionRepo.sumSucceededRefundsByParent(transactionId);
        return {
          refundTransaction: existing,
          intent,
          providerRefunded: false,
          idempotentReplay: true,
          refundableRemaining: Math.max(0, sourceTx.amount - alreadyRefunded),
        };
      }
    }

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

    const provider = this.providerRegistry.get(sourceTx.provider);
    if (!provider || typeof provider.refundPayment !== 'function') {
      if (!isOfflineRefundProvider(sourceTx.provider)) {
        throw Object.assign(
          new Error(`Provider ${sourceTx.provider} does not support programmatic refunds.`),
          { statusCode: 422, code: 'PROVIDER_REFUND_UNSUPPORTED' },
        );
      }
    }

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

    let providerRefunded = false;
    let refundStatus: 'succeeded' | 'failed' | 'pending' = 'succeeded';
    let refundFailureReason: string | null = null;
    let refundProviderRef: string | null = null;
    let refundRawResponse: Record<string, unknown> = {};

    if (provider && typeof provider.refundPayment === 'function') {
      let providerAccount = null;
      if (sourceTx.providerAccountId) {
        providerAccount = await this.providerAccountRepo.findById(sourceTx.providerAccountId, merchantId);
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
        await this.transactionRepo.updateStatus({
          id: refundId,
          merchantId,
          status: 'failed',
          failureReason: refundFailureReason ?? 'PROVIDER_REFUND_REJECTED',
          providerReference: refundProviderRef ?? undefined,
          rawProviderResponse: refundRawResponse,
        });
        throw Object.assign(
          new Error(`Provider rejected refund: ${refundFailureReason ?? 'unknown reason'}`),
          { statusCode: 502, code: 'PROVIDER_REFUND_FAILED' },
        );
      }
    } else {
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

    let updatedIntent = intent;
    if (refundStatus === 'succeeded' && this.transactionRepo.applySucceededRefund) {
      const applied = await this.transactionRepo.applySucceededRefund({
        refundTransactionId: refundId,
        merchantId,
        intentId: intent.id,
        amount,
        providerReference: refundProviderRef ?? undefined,
        rawProviderResponse: refundRawResponse,
      });
      refundTx = applied.refundTransaction;
      updatedIntent = applied.intent;
    } else {
      refundTx = await this.transactionRepo.updateStatus({
        id: refundId,
        merchantId,
        status: refundStatus,
        failureReason: refundFailureReason,
        providerReference: refundProviderRef ?? undefined,
        rawProviderResponse: refundRawResponse,
      });

      if (refundStatus === 'succeeded') {
        const newAmountRefunded = intent.amountRefunded + amount;
        updatedIntent = await this.intentRepo.updateTotals({
          id: intent.id,
          merchantId,
          amountPaid: intent.amountPaid,
          amountRefunded: newAmountRefunded,
          amountRemaining: intent.amountRemaining,
        });
        const newStatus = computeIntentStatusAfterRefund(updatedIntent, newAmountRefunded);
        if (newStatus !== updatedIntent.status) {
          updatedIntent = await this.intentRepo.updateStatus({ id: intent.id, merchantId, status: newStatus });
        }
      }
    }

    return {
      refundTransaction: refundTx,
      intent: updatedIntent,
      providerRefunded,
      idempotentReplay: false,
      refundableRemaining: Math.max(0, refundableAmount - (refundStatus === 'succeeded' ? amount : 0)),
    };
  }
}
