/**
 * ExpireStalePaymentTransactions — operations use case for stale standalone payments.
 *
 * Transaction-level `expiresAt` is the primary expiration policy. Intent-level
 * `expiresAt` remains a fallback for intents that do not have individually
 * expired pending/requires_action transactions.
 */

import type {
  PaymentIntentRepository,
  PaymentTransactionRepository,
  StandalonePaymentIntentDTO,
  StandalonePaymentTransactionDTO,
} from '@northflow/payment-orchestration-core';

const TERMINAL_TRANSACTION_STATUSES = new Set([
  'succeeded',
  'failed',
  'cancelled',
  'expired',
  'voided',
  'refunded',
  'reversed',
  'ignored',
]);

const EXPIRABLE_TRANSACTION_STATUSES = new Set(['pending', 'requires_action']);
const EXPIRABLE_INTENT_STATUSES = new Set(['requires_payment', 'partially_paid']);

export interface ExpireStalePaymentTransactionsInput {
  now?: Date;
  limit?: number;
}

export interface ExpiredIntentSummary {
  intentId: string;
  merchantId: string;
  expiredTransactionIds: string[];
  skippedTransactionIds: string[];
  intentStatus: StandalonePaymentIntentDTO['status'];
}

export interface ExpireStalePaymentTransactionsResult {
  expiredIntents: number;
  expiredTransactions: number;
  skippedTransactions: number;
  summaries: ExpiredIntentSummary[];
}

export class ExpireStalePaymentTransactions {
  constructor(
    private readonly intentRepo: PaymentIntentRepository,
    private readonly transactionRepo: PaymentTransactionRepository,
  ) {}

  async execute(input: ExpireStalePaymentTransactionsInput = {}): Promise<ExpireStalePaymentTransactionsResult> {
    const now = input.now ?? new Date();
    const limit = input.limit ?? 100;

    if (!this.transactionRepo.findStalePendingTransactions) {
      throw Object.assign(new Error('Payment transaction repository does not support transaction expiration queries.'), {
        statusCode: 501,
        code: 'OPERATIONS_REPOSITORY_UNSUPPORTED',
      });
    }
    if (!this.intentRepo.findExpiredActive) {
      throw Object.assign(new Error('Payment intent repository does not support stale expiration queries.'), {
        statusCode: 501,
        code: 'OPERATIONS_REPOSITORY_UNSUPPORTED',
      });
    }

    const summariesByIntent = new Map<string, ExpiredIntentSummary>();
    let expiredTransactions = 0;
    let skippedTransactions = 0;

    const ensureSummary = async (intentId: string, merchantId: string): Promise<ExpiredIntentSummary> => {
      const key = `${merchantId}:${intentId}`;
      const existing = summariesByIntent.get(key);
      if (existing) return existing;
      const intent = await this.intentRepo.findById(intentId, merchantId);
      const summary: ExpiredIntentSummary = {
        intentId,
        merchantId,
        expiredTransactionIds: [],
        skippedTransactionIds: [],
        intentStatus: intent?.status ?? 'requires_payment',
      };
      summariesByIntent.set(key, summary);
      return summary;
    };

    const expireTransaction = async (transaction: StandalonePaymentTransactionDTO): Promise<void> => {
      const summary = await ensureSummary(transaction.intentId, transaction.merchantId);
      if (TERMINAL_TRANSACTION_STATUSES.has(transaction.status) || !EXPIRABLE_TRANSACTION_STATUSES.has(transaction.status)) {
        skippedTransactions += 1;
        summary.skippedTransactionIds.push(transaction.id);
        return;
      }

      const updated = await this.transactionRepo.updateStatus({
        id: transaction.id,
        merchantId: transaction.merchantId,
        status: 'expired',
        failureReason: 'Payment transaction expired by standalone operations runner.',
      });
      if (updated.status === 'expired') {
        expiredTransactions += 1;
        summary.expiredTransactionIds.push(updated.id);
      }
    };

    // Primary policy: expire individual pending/requires_action transactions by tx.expiresAt.
    const staleTransactions = await this.transactionRepo.findStalePendingTransactions({ now, limit });
    for (const transaction of staleTransactions) {
      await expireTransaction(transaction);
    }

    // Fallback policy: expire active intents by intent.expiresAt and expire their pending txs.
    const remainingLimit = Math.max(0, limit - staleTransactions.length);
    const staleIntents = remainingLimit > 0
      ? await this.intentRepo.findExpiredActive({ now, limit: remainingLimit })
      : [];

    for (const intent of staleIntents) {
      const summary = await ensureSummary(intent.id, intent.merchantId);
      const transactions = await this.transactionRepo.findByIntentId(intent.id, intent.merchantId);
      for (const transaction of transactions) {
        await expireTransaction(transaction);
      }
      summary.intentStatus = intent.status;
    }

    // Recompute/update affected intent status safely after transaction mutations.
    for (const summary of summariesByIntent.values()) {
      const freshIntent = await this.intentRepo.findById(summary.intentId, summary.merchantId);
      if (!freshIntent) continue;
      if (EXPIRABLE_INTENT_STATUSES.has(freshIntent.status) && freshIntent.amountRemaining > 0) {
        const updatedIntent = await this.intentRepo.updateStatus({
          id: freshIntent.id,
          merchantId: freshIntent.merchantId,
          status: 'expired',
        });
        summary.intentStatus = updatedIntent.status;
      } else {
        summary.intentStatus = freshIntent.status;
      }
    }

    const summaries = Array.from(summariesByIntent.values());
    return {
      expiredIntents: summaries.filter((summary) => summary.intentStatus === 'expired').length,
      expiredTransactions,
      skippedTransactions,
      summaries,
    };
  }
}
