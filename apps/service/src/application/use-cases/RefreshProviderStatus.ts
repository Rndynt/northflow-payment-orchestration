/**
 * RefreshProviderStatus — on-demand provider status polling foundation.
 *
 * This is intentionally not a scheduler/worker. It is a service-token protected
 * use case invoked by an HTTP route or future worker. All mutations stay scoped
 * by merchantId and reuse existing transaction/intent consistency rules.
 */

import type {
  PaymentIntentRepository,
  PaymentProviderAccountRepository,
  PaymentTransactionRepository,
  StandalonePaymentIntentDTO,
  StandalonePaymentTransactionDTO,
} from '@northflow/payment-orchestration-core';
import type { ProviderRegistry } from '../../infrastructure/providers/providerRegistry.ts';
import { computeIntentStatus } from './intentStatusHelper.ts';

const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'cancelled', 'expired', 'voided', 'refunded']);

export interface RefreshProviderStatusInput {
  merchantId: string;
  transactionId: string;
}

export interface RefreshProviderStatusOutput {
  transaction: StandalonePaymentTransactionDTO;
  intent: StandalonePaymentIntentDTO | null;
  providerStatus: string;
  changed: boolean;
}

export class RefreshProviderStatus {
  constructor(
    private readonly transactionRepo: PaymentTransactionRepository,
    private readonly intentRepo: PaymentIntentRepository,
    private readonly providerAccountRepo: PaymentProviderAccountRepository,
    private readonly providerRegistry: ProviderRegistry,
  ) {}

  async execute(input: RefreshProviderStatusInput): Promise<RefreshProviderStatusOutput> {
    if (!input.merchantId || !input.transactionId) {
      throw Object.assign(new Error('merchantId and transactionId are required'), {
        statusCode: 400,
        code: 'VALIDATION_ERROR',
      });
    }

    let tx = await this.transactionRepo.findById(input.transactionId, input.merchantId);
    if (!tx) {
      throw Object.assign(new Error(`Transaction not found: ${input.transactionId}`), {
        statusCode: 404,
        code: 'TRANSACTION_NOT_FOUND',
      });
    }

    const provider = this.providerRegistry.get(tx.provider);
    if (!provider?.getPaymentStatus) {
      throw Object.assign(new Error(`Provider '${tx.provider}' does not support status polling.`), {
        statusCode: 422,
        code: 'PROVIDER_POLLING_UNSUPPORTED',
      });
    }

    const providerAccount = tx.providerAccountId
      ? await this.providerAccountRepo.findById(tx.providerAccountId, tx.merchantId)
      : null;

    const providerResult = await provider.getPaymentStatus({
      transactionId: tx.id,
      providerReference: tx.providerReference,
      providerAccount,
      rawProviderResponse: tx.rawProviderResponse,
      metadata: tx.metadata,
    });

    let intent = await this.intentRepo.findById(tx.intentId, tx.merchantId);
    let changed = false;

    if (providerResult.status === 'succeeded' && tx.status !== 'succeeded') {
      if (!TERMINAL_STATUSES.has(tx.status)) {
        if (intent && tx.amount > intent.amountRemaining) {
          throw Object.assign(
            new Error(`Overpayment rejected during status refresh: tx.amount=${tx.amount} > intent.amountRemaining=${intent.amountRemaining}`),
            { statusCode: 422, code: 'OVERPAYMENT_REJECTED' },
          );
        }

        const confirmed = await this.transactionRepo.markSucceededIfConfirmable({
          id: tx.id,
          merchantId: tx.merchantId,
        });
        if (confirmed.changed && confirmed.transaction) {
          tx = confirmed.transaction;
          changed = true;
          if (intent) {
            const newAmountPaid = intent.amountPaid + tx.amount;
            const newAmountRemaining = Math.max(0, intent.amountDue - newAmountPaid);
            await this.intentRepo.updateTotals({
              id: intent.id,
              merchantId: tx.merchantId,
              amountPaid: newAmountPaid,
              amountRefunded: intent.amountRefunded,
              amountRemaining: newAmountRemaining,
            });
            intent = await this.intentRepo.updateStatus({
              id: intent.id,
              merchantId: tx.merchantId,
              status: computeIntentStatus(intent.amountDue, newAmountPaid),
            });
          }
        } else {
          const reloaded = await this.transactionRepo.findById(tx.id, tx.merchantId);
          if (reloaded) tx = reloaded;
          intent = await this.intentRepo.findById(tx.intentId, tx.merchantId);
        }
      }
    } else if (
      (providerResult.status === 'failed' || providerResult.status === 'cancelled' || providerResult.status === 'expired')
      && !TERMINAL_STATUSES.has(tx.status)
    ) {
      tx = await this.transactionRepo.updateStatus({
        id: tx.id,
        merchantId: tx.merchantId,
        status: providerResult.status,
        failureReason: providerResult.failureReason,
        providerReference: providerResult.providerReference ?? tx.providerReference,
      });
      changed = true;
    }

    return {
      transaction: tx,
      intent,
      providerStatus: providerResult.status,
      changed,
    };
  }
}
