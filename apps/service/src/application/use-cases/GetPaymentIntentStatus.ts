/**
 * GetPaymentIntentStatus — return the current status read model for a payment intent.
 *
 * Phase 8D use case.
 * Returns intent + latest transaction + computed read model fields.
 */

import type {
  PaymentIntentRepository,
  PaymentTransactionRepository,
} from '@northflow/payment-orchestration-core';
import type {
  StandalonePaymentIntentDTO,
  StandalonePaymentTransactionDTO,
} from '@northflow/payment-orchestration-core';

export interface GetPaymentIntentStatusInput {
  merchantId: string;
  intentId: string;
}

export interface PaymentIntentStatusOutput {
  intent: StandalonePaymentIntentDTO;
  latestTransaction: StandalonePaymentTransactionDTO | null;
  isTerminal: boolean;
  requiresAction: boolean;
  canRetryPayment: boolean;
}

const TERMINAL_INTENT_STATUSES = new Set([
  'paid',
  'overpaid',
  'refunded',
  'voided',
  'expired',
  'cancelled',
  'failed',
]);

export class GetPaymentIntentStatus {
  constructor(
    private readonly intentRepo: PaymentIntentRepository,
    private readonly transactionRepo: PaymentTransactionRepository,
  ) {}

  async execute(
    input: GetPaymentIntentStatusInput,
  ): Promise<PaymentIntentStatusOutput> {
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

    const transactions = await this.transactionRepo.findByIntentId(
      intent.id,
      input.merchantId,
    );

    const latestTransaction =
      transactions.length > 0
        ? transactions.sort(
            (a, b) =>
              new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
          )[0] ?? null
        : null;

    const isTerminal = TERMINAL_INTENT_STATUSES.has(intent.status);
    const requiresAction =
      latestTransaction?.status === 'requires_action' ||
      latestTransaction?.status === 'pending';
    const canRetryPayment =
      !isTerminal &&
      intent.amountRemaining > 0 &&
      (!latestTransaction ||
        latestTransaction.status === 'failed' ||
        latestTransaction.status === 'cancelled' ||
        latestTransaction.status === 'expired');

    return { intent, latestTransaction, isTerminal, requiresAction, canRetryPayment };
  }
}
