/**
 * VoidPaymentTransaction — cancel (void) a pending or requires_action payment transaction.
 *
 * Void rules:
 * - Source transaction must be direction=incoming, status in [pending, requires_action].
 * - Idempotency key replay succeeds only when it matches the stored cancelled transaction.
 * - Manual provider may cancel offline; gateway providers must implement cancelPayment().
 * - Intent totals are not changed because voidable transactions have not succeeded.
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
const OFFLINE_CANCEL_PROVIDERS = new Set(['manual']);

export interface VoidPaymentTransactionInput {
  merchantId: string;
  /** ID of the payment transaction to void (cancel). */
  transactionId: string;
  /** Optional human-readable reason (stored in metadata). */
  reason?: string | null;
  /** Caller-supplied idempotency key persisted on the voided transaction. */
  idempotencyKey?: string | null;
}

export interface VoidPaymentTransactionOutput {
  /** The transaction after being cancelled, or replayed if already cancelled with the same key. */
  transaction: StandalonePaymentTransactionDTO;
  /** The parent intent (unchanged — totals not affected by void). */
  intent: StandalonePaymentIntentDTO | null;
  /** true if the provider API was called; false for manual/offline replay/cancel. */
  providerCancelled: boolean;
  /** true when idempotencyKey matched the existing cancelled transaction. */
  idempotentReplay: boolean;
}

function isOfflineCancelProvider(providerCode: string): boolean {
  return OFFLINE_CANCEL_PROVIDERS.has(providerCode);
}

function transitionError(transactionId: string, tx: StandalonePaymentTransactionDTO): Error {
  return Object.assign(
    new Error(
      `Transaction ${transactionId} cannot be voided. ` +
      `Required: direction=incoming, status in [${[...VOIDABLE_STATUSES].join(',')}]. ` +
      `Got: direction=${tx.direction}, status=${tx.status}.`,
    ),
    { statusCode: 422, code: 'TRANSACTION_NOT_VOIDABLE' },
  );
}

export class VoidPaymentTransaction {
  constructor(
    private readonly transactionRepo: PaymentTransactionRepository,
    private readonly intentRepo: PaymentIntentRepository,
    private readonly providerAccountRepo: PaymentProviderAccountRepository,
    private readonly providerRegistry: ProviderRegistry,
  ) {}

  async execute(input: VoidPaymentTransactionInput): Promise<VoidPaymentTransactionOutput> {
    const { merchantId, transactionId, reason, idempotencyKey } = input;

    const tx = await this.transactionRepo.findById(transactionId, merchantId);
    if (!tx) {
      throw Object.assign(
        new Error(`Payment transaction not found: ${transactionId}`),
        { statusCode: 404, code: 'TRANSACTION_NOT_FOUND' },
      );
    }

    if (idempotencyKey) {
      const existing = await this.transactionRepo.findByMerchantIdempotencyKey(merchantId, idempotencyKey);
      if (existing && existing.id !== transactionId) {
        throw Object.assign(
          new Error(`Idempotency key ${idempotencyKey} is already used for a different payment transaction operation.`),
          { statusCode: 409, code: 'IDEMPOTENCY_CONFLICT' },
        );
      }
    }

    if (tx.status === 'cancelled' || tx.status === 'voided') {
      if (idempotencyKey && tx.idempotencyKey === idempotencyKey) {
        return {
          transaction: tx,
          intent: await this.loadIntent(tx, merchantId),
          providerCancelled: false,
          idempotentReplay: true,
        };
      }
      throw transitionError(transactionId, tx);
    }

    if (!VOIDABLE_STATUSES.has(tx.status) || tx.direction !== 'incoming') {
      throw transitionError(transactionId, tx);
    }

    const provider = this.providerRegistry.get(tx.provider);
    if (!provider || typeof provider.cancelPayment !== 'function') {
      if (!isOfflineCancelProvider(tx.provider)) {
        throw Object.assign(
          new Error(`Provider ${tx.provider} does not support programmatic cancellation.`),
          { statusCode: 422, code: 'PROVIDER_CANCEL_UNSUPPORTED' },
        );
      }
    }

    let providerCancelled = false;
    let cancelFailureReason: string | null = null;
    let cancelProviderReference: string | null | undefined;
    let cancelRawResponse: Record<string, unknown> | null = null;

    if (provider && typeof provider.cancelPayment === 'function') {
      let providerAccount = null;
      if (tx.providerAccountId) {
        providerAccount = await this.providerAccountRepo.findById(tx.providerAccountId, merchantId);
      }

      const cancelResult = await provider.cancelPayment({
        transactionId,
        providerReference: tx.providerReference,
        providerAccount,
        reason: reason ?? null,
        metadata: { void_reason: reason ?? null, idempotency_key: idempotencyKey ?? null },
      });

      providerCancelled = true;
      cancelProviderReference = cancelResult.providerReference ?? undefined;
      cancelRawResponse = cancelResult.rawProviderResponse;

      if (cancelResult.status === 'failed') {
        cancelFailureReason = cancelResult.failureReason;
        await this.transactionRepo.updateStatus({
          id: transactionId,
          merchantId,
          status: 'failed',
          failureReason: cancelFailureReason ?? 'PROVIDER_CANCEL_REJECTED',
          providerReference: cancelProviderReference,
          rawProviderResponse: cancelRawResponse,
        });
        throw Object.assign(
          new Error(`Provider rejected cancellation: ${cancelFailureReason ?? 'unknown reason'}`),
          { statusCode: 502, code: 'PROVIDER_CANCEL_FAILED' },
        );
      }
    } else {
      cancelRawResponse = {
        provider: tx.provider,
        manual_cancel: true,
        transaction_id: transactionId,
        reason: reason ?? null,
      };
    }

    const cancelledTx = await this.transactionRepo.updateStatus({
      id: transactionId,
      merchantId,
      status: 'cancelled',
      failureReason: null,
      providerReference: cancelProviderReference,
      idempotencyKey: idempotencyKey ?? undefined,
      metadata: {
        ...(tx.metadata ?? {}),
        void_reason: reason ?? null,
        void_idempotency_key: idempotencyKey ?? null,
      },
      rawProviderResponse: cancelRawResponse,
    });

    return {
      transaction: cancelledTx,
      intent: await this.loadIntent(tx, merchantId),
      providerCancelled,
      idempotentReplay: false,
    };
  }

  private async loadIntent(
    tx: StandalonePaymentTransactionDTO,
    merchantId: string,
  ): Promise<StandalonePaymentIntentDTO | null> {
    try {
      return await this.intentRepo.findById(tx.intentId, merchantId);
    } catch {
      return null;
    }
  }
}
