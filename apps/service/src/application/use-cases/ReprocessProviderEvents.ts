/**
 * ReprocessProviderEvents — safe provider-event retry/reprocess.
 *
 * Replays only previously verified stored parsedPayload. It does not rebuild or
 * reverify provider signatures, and it skips already processed events so payment
 * amountPaid cannot be double-credited by duplicate reprocess attempts.
 */

import type {
  PaymentIntentRepository,
  PaymentProviderEventRepository,
  PaymentTransactionRepository,
  PaymentIntentDTO,
  PaymentTransactionDTO,
} from '@northflow/payment-orchestration-core';
import type { ParsedProviderWebhook } from '../../infrastructure/providers/PaymentProviderAdapter.ts';
import { computeIntentStatus } from './intentStatusHelper.ts';

const SUPPORTED_REPROCESS_PROVIDERS = new Set(['fake_gateway', 'xendit_sandbox']);
const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'cancelled', 'expired', 'reversed']);

export interface ReprocessProviderEventsInput {
  olderThanMinutes?: number;
  limit?: number;
}

export interface ReprocessProviderEventsResult {
  processed: number;
  skipped: number;
  failed: number;
  details: Array<{
    eventId: string;
    status: 'processed' | 'skipped' | 'failed';
    reason?: string;
  }>;
}

export class ReprocessProviderEvents {
  constructor(
    private readonly providerEventRepo: PaymentProviderEventRepository,
    private readonly transactionRepo?: PaymentTransactionRepository,
    private readonly intentRepo?: PaymentIntentRepository,
  ) {}

  async execute(input: ReprocessProviderEventsInput = {}): Promise<ReprocessProviderEventsResult> {
    const events = await this.providerEventRepo.findStalePending({
      olderThanMinutes: input.olderThanMinutes ?? 5,
      limit: input.limit ?? 100,
    });

    const result: ReprocessProviderEventsResult = {
      processed: 0,
      skipped: 0,
      failed: 0,
      details: [],
    };

    for (const event of events) {
      if (event.processingStatus === 'processed') {
        result.skipped += 1;
        result.details.push({
          eventId: event.id,
          status: 'skipped',
          reason: 'Event is already processed; double-apply is not allowed.',
        });
        continue;
      }

      if (!SUPPORTED_REPROCESS_PROVIDERS.has(event.provider)) {
        result.skipped += 1;
        result.details.push({
          eventId: event.id,
          status: 'skipped',
          reason: `Provider '${event.provider}' has no safe reprocess adapter.`,
        });
        continue;
      }

      if (!event.parsedPayload) {
        result.skipped += 1;
        result.details.push({
          eventId: event.id,
          status: 'skipped',
          reason: 'Stored event has no parsed payload that can be safely replayed.',
        });
        continue;
      }

      if (!this.transactionRepo || !this.intentRepo) {
        result.skipped += 1;
        result.details.push({
          eventId: event.id,
          status: 'skipped',
          reason: 'Reprocess dependencies are not wired.',
        });
        continue;
      }

      try {
        await this.replayParsedEvent({
          id: event.id,
          provider: event.provider,
          providerReference: event.providerReference,
          parsedPayload: event.parsedPayload,
        });
        await this.providerEventRepo.markProcessed(event.id);
        result.processed += 1;
        result.details.push({ eventId: event.id, status: 'processed' });
      } catch (err: any) {
        const safeMessage = err?.message ?? String(err);
        await this.providerEventRepo.markFailed(event.id, safeMessage).catch(() => undefined);
        result.failed += 1;
        result.details.push({ eventId: event.id, status: 'failed', reason: safeMessage });
      }
    }

    return result;
  }

  private async replayParsedEvent(input: {
    id: string;
    provider: string;
    providerReference: string | null;
    parsedPayload: Record<string, unknown>;
  }): Promise<void> {
    const parsed = this.coerceParsedPayload(input.providerReference, input.parsedPayload);
    if (parsed.status === 'ignored') return;
    if (!parsed.providerReference) {
      throw new Error('Stored parsed payload does not include providerReference.');
    }

    let tx = await this.transactionRepo!.findByProviderReference(input.provider, parsed.providerReference);
    if (!tx) {
      throw new Error(`Transaction not found for provider '${input.provider}' providerReference '${parsed.providerReference}'.`);
    }

    let intent = await this.intentRepo!.findById(tx.intentId, tx.merchantId);

    if (parsed.status === 'succeeded') {
      await this.applySucceeded(tx, intent);
      return;
    }

    if (parsed.status === 'failed' || parsed.status === 'cancelled' || parsed.status === 'expired') {
      if (!TERMINAL_STATUSES.has(tx.status)) {
        await this.transactionRepo!.updateStatus({
          id: tx.id,
          merchantId: tx.merchantId,
          status: parsed.status,
        });
      }
    }
  }

  private coerceParsedPayload(
    fallbackProviderReference: string | null,
    payload: Record<string, unknown>,
  ): ParsedProviderWebhook {
    const providerEventId = String(payload['providerEventId'] ?? payload['event_id'] ?? payload['id'] ?? '');
    const eventType = String(payload['eventType'] ?? payload['event_type'] ?? payload['type'] ?? 'payment.updated');
    const status = String(payload['status'] ?? 'ignored') as ParsedProviderWebhook['status'];
    const providerReference = payload['providerReference'] ?? payload['provider_reference'] ?? payload['provider_ref'] ?? fallbackProviderReference;
    return {
      providerEventId,
      providerReference: typeof providerReference === 'string' ? providerReference : null,
      eventType,
      status,
      rawPayload: payload,
    };
  }

  private async applySucceeded(
    tx: PaymentTransactionDTO,
    intent: PaymentIntentDTO | null,
  ): Promise<void> {
    if (tx.status === 'succeeded') return;
    if (TERMINAL_STATUSES.has(tx.status)) return;
    if (intent && tx.amount > intent.amountRemaining) {
      throw new Error(`Overpayment rejected: tx.amount=${tx.amount} > intent.amountRemaining=${intent.amountRemaining}`);
    }

    const { changed, transaction: confirmedTx } = await this.transactionRepo!.markSucceededIfConfirmable({
      id: tx.id,
      merchantId: tx.merchantId,
    });

    if (changed && confirmedTx && intent) {
      const newAmountPaid = intent.amountPaid + tx.amount;
      const newAmountRemaining = Math.max(0, intent.amountDue - newAmountPaid);
      const newStatus = computeIntentStatus(intent.amountDue, newAmountPaid);
      await this.intentRepo!.updateTotals({
        id: intent.id,
        merchantId: tx.merchantId,
        amountPaid: newAmountPaid,
        amountRefunded: intent.amountRefunded,
        amountRemaining: newAmountRemaining,
      });
      await this.intentRepo!.updateStatus({
        id: intent.id,
        merchantId: tx.merchantId,
        status: newStatus,
      });
    }
  }
}
