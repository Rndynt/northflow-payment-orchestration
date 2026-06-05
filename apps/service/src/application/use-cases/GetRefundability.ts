/**
 * GetRefundability — compute the refundable amount for a payment intent.
 *
 * Phase 8D use case. No provider-level refund call.
 *
 * A transaction is refundable if:
 * - direction: incoming
 * - transactionType: payment | deposit | settlement
 * - status: succeeded
 *
 * Refundable amount = sum(refundable source txns) - sum(succeeded outgoing refunds)
 */

import type {
  PaymentIntentRepository,
  PaymentTransactionRepository,
} from '@northflow/payment-orchestration-core';
import type { StandalonePaymentTransactionDTO } from '@northflow/payment-orchestration-core';

export interface GetRefundabilityInput {
  merchantId: string;
  intentId: string;
}

export interface RefundableTransaction {
  transactionId: string;
  amount: number;
  amountAlreadyRefunded: number;
  amountRefundable: number;
  provider: string;
  method: string;
}

export interface RefundabilityOutput {
  intentId: string;
  merchantId: string;
  totalRefundable: number;
  currency: string;
  transactions: RefundableTransaction[];
}

const REFUNDABLE_TYPES = new Set(['payment', 'deposit', 'settlement']);

export class GetRefundability {
  constructor(
    private readonly intentRepo: PaymentIntentRepository,
    private readonly transactionRepo: PaymentTransactionRepository,
  ) {}

  async execute(input: GetRefundabilityInput): Promise<RefundabilityOutput> {
    const intent = await this.intentRepo.findById(
      input.intentId,
      input.merchantId,
    );
    if (!intent) {
      throw Object.assign(
        new Error(`Payment intent not found: ${input.intentId}`),
        { statusCode: 404, code: 'INTENT_NOT_FOUND' },
      );
    }

    const allTransactions = await this.transactionRepo.findByIntentId(
      intent.id,
      input.merchantId,
    );

    const sourceTxns: StandalonePaymentTransactionDTO[] = allTransactions.filter(
      (tx) =>
        tx.direction === 'incoming' &&
        REFUNDABLE_TYPES.has(tx.transactionType) &&
        tx.status === 'succeeded',
    );

    const refundableItems: RefundableTransaction[] = [];
    let totalRefundable = 0;

    for (const tx of sourceTxns) {
      const alreadyRefunded =
        await this.transactionRepo.sumSucceededRefundsByParent(tx.id);
      const refundable = Math.max(0, tx.amount - alreadyRefunded);
      refundableItems.push({
        transactionId: tx.id,
        amount: tx.amount,
        amountAlreadyRefunded: alreadyRefunded,
        amountRefundable: refundable,
        provider: tx.provider,
        method: tx.method,
      });
      totalRefundable += refundable;
    }

    return {
      intentId: intent.id,
      merchantId: intent.merchantId,
      totalRefundable,
      currency: intent.currency,
      transactions: refundableItems,
    };
  }
}
