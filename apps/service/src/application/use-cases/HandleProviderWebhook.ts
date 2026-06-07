/**
 * HandleProviderWebhook — standalone webhook ingestion use case.
 *
 * Phase 8E: wire provider webhook events to standalone payment orchestration tables.
 *
 * Flow:
 *  1. Accept provider code, headers, rawBody.
 *  2. Validate provider is supported (fake_gateway required; xendit_sandbox optional/mock).
 *  3. Parse/verify event via provider-specific handler.
 *  4. Check for duplicate by (provider, providerEventId) — idempotent if already processed.
 *  5. Reserve provider event row (or reuse existing pending/failed row).
 *  6. Resolve transaction by (provider, providerReference).
 *  7. Resolve intent from transaction.
 *  8. Assign merchantId to provider event from transaction/intent.
 *  9. Apply status mutation:
 *     - succeeded  → markSucceededIfConfirmable (atomic) → update intent totals
 *     - failed     → updateStatus if pending/requires_action
 *     - cancelled  → updateStatus if not terminal
 *     - expired    → updateStatus if not terminal
 *     - ignored    → no tx mutation
 *  10. Mark provider event processed or failed with safe error.
 *  11. Return read model.
 *
 * Security:
 *  - Does NOT trust merchantId from request headers.
 *  - Merchant resolved from providerReference → transaction → intent.
 *  - Does NOT require service token (webhook routes use provider-level verification).
 *  - No legacy tenantId anywhere in this flow.
 */

import { randomUUID } from 'crypto';
import type {
  PaymentTransactionRepository,
  PaymentIntentRepository,
  PaymentProviderEventRepository,
} from '@northflow/payment-orchestration-core';
import type {
  PaymentTransactionDTO,
  PaymentIntentDTO,
  PaymentProviderEventDTO,
} from '@northflow/payment-orchestration-core';
import type { FakeGatewayWebhookHandler } from '../../infrastructure/providers/FakeGatewayWebhookHandler.ts';
import type { ProviderRegistry } from '../../infrastructure/providers/providerRegistry.ts';
import { computeIntentStatus } from './intentStatusHelper.ts';
import { redactSensitiveRecord } from '../payment-state/redaction.ts';

const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'cancelled', 'expired', 'reversed']);

export interface HandleProviderWebhookInput {
  provider: string;
  headers: Record<string, string | string[] | undefined>;
  /** Raw body bytes (preferred for HMAC) or pre-parsed object */
  rawBody: Buffer | Record<string, unknown>;
}

export interface HandleProviderWebhookOutput {
  eventId: string;
  provider: string;
  providerReference: string | null;
  processingStatus: 'processed' | 'failed' | 'ignored';
  transaction: PaymentTransactionDTO | null;
  intent: PaymentIntentDTO | null;
  idempotentReplay: boolean;
}

export class HandleProviderWebhook {
  constructor(
    private readonly transactionRepo: PaymentTransactionRepository,
    private readonly intentRepo: PaymentIntentRepository,
    private readonly providerEventRepo: PaymentProviderEventRepository,
    private readonly fakeGatewayHandler: FakeGatewayWebhookHandler,
    private readonly providerRegistry?: ProviderRegistry,
  ) {}

  async execute(input: HandleProviderWebhookInput): Promise<HandleProviderWebhookOutput> {
    const { provider } = input;

    // ── Validate provider support and parse/verify event ─────────────────────
    const runtimeProvider = this.providerRegistry?.get(provider);
    const parsed = provider === 'fake_gateway'
      ? this.fakeGatewayHandler.parse(input.headers, input.rawBody)
      : runtimeProvider?.parseWebhook
        ? runtimeProvider.parseWebhook({ headers: input.headers, rawBody: input.rawBody })
        : null;

    if (!parsed) {
      throw Object.assign(
        new Error(
          `Webhook ingestion for provider '${provider}' is not supported by the standalone runtime.`,
        ),
        { statusCode: 400, code: 'WEBHOOK_PROVIDER_NOT_SUPPORTED' },
      );
    }

    const rawPayload = parsed.rawPayload;

    // ── Reserve provider event (race-safe where repository supports it) ─────
    let eventRow: PaymentProviderEventDTO;
    let idempotentReplay = false;
    if (this.providerEventRepo.reserveEventOrGet) {
      const reserved = await this.providerEventRepo.reserveEventOrGet({
        id: `pev_${randomUUID()}`,
        provider,
        providerEventId: parsed.providerEventId,
        providerReference: parsed.providerReference,
        eventType: parsed.eventType,
        rawHeaders: redactSensitiveRecord(input.headers) as Record<string, unknown>,
        rawBody: Buffer.isBuffer(input.rawBody) ? ({ _raw: true } as Record<string, unknown>) : (redactSensitiveRecord(rawPayload) as Record<string, unknown>),
        parsedPayload: redactSensitiveRecord(rawPayload) as Record<string, unknown>,
      });
      eventRow = reserved.event;
      if (!reserved.reserved && eventRow.processingStatus === 'processed') idempotentReplay = true;
    } else {
      const existing = await this.providerEventRepo.findByProviderEventId(provider, parsed.providerEventId);
      if (existing) {
        eventRow = existing;
        if (existing.processingStatus === 'processed') idempotentReplay = true;
      } else {
        eventRow = await this.providerEventRepo.reserveEvent({
          id: `pev_${randomUUID()}`,
          provider,
          providerEventId: parsed.providerEventId,
          providerReference: parsed.providerReference,
          eventType: parsed.eventType,
          rawHeaders: redactSensitiveRecord(input.headers) as Record<string, unknown>,
          rawBody: Buffer.isBuffer(input.rawBody) ? ({ _raw: true } as Record<string, unknown>) : (redactSensitiveRecord(rawPayload) as Record<string, unknown>),
          parsedPayload: redactSensitiveRecord(rawPayload) as Record<string, unknown>,
        });
      }
    }

    if (idempotentReplay) {
      const replayTx = parsed.providerReference
        ? await this.transactionRepo.findByProviderReference(provider, parsed.providerReference)
        : null;
      const replayIntent = replayTx ? await this.intentRepo.findById(replayTx.intentId, replayTx.merchantId) : null;
      return {
        eventId: eventRow.id,
        provider,
        providerReference: parsed.providerReference,
        processingStatus: 'processed',
        transaction: replayTx,
        intent: replayIntent,
        idempotentReplay: true,
      };
    }

    if (this.providerEventRepo.claimForProcessing) {
      const claimed = await this.providerEventRepo.claimForProcessing(eventRow.id);
      if (!claimed) {
        return {
          eventId: eventRow.id,
          provider,
          providerReference: parsed.providerReference,
          processingStatus: 'ignored',
          transaction: null,
          intent: null,
          idempotentReplay: true,
        };
      }
      eventRow = claimed;
    }

    // ── Resolve transaction by provider reference ────────────────────────────
    let tx: PaymentTransactionDTO | null = null;
    let intent: PaymentIntentDTO | null = null;

    if (parsed.providerReference) {
      tx = await this.transactionRepo.findByProviderReference(provider, parsed.providerReference);
    }

    if (!tx) {
      // Transaction not found — provider reference unknown. Mark event failed.
      await this.providerEventRepo.markFailed(
        eventRow.id,
        `Transaction not found for provider '${provider}' providerReference '${parsed.providerReference ?? '(none)'}'.`,
      );
      return {
        eventId: eventRow.id,
        provider,
        providerReference: parsed.providerReference,
        processingStatus: 'failed',
        transaction: null,
        intent: null,
        idempotentReplay: false,
      };
    }

    // Resolve intent from transaction.
    intent = await this.intentRepo.findById(tx.intentId, tx.merchantId);

    // ── Assign merchantId to event from resolved transaction ─────────────────
    if (!eventRow.merchantId) {
      await this.providerEventRepo.assignMerchant(eventRow.id, tx.merchantId);
    }

    // ── Apply status mutation ────────────────────────────────────────────────
    try {
      if (parsed.status === 'ignored') {
        // No transaction mutation for ignored events.
        await this.providerEventRepo.markProcessed(eventRow.id);
        return {
          eventId: eventRow.id,
          provider,
          providerReference: parsed.providerReference,
          processingStatus: 'ignored',
          transaction: tx,
          intent,
          idempotentReplay: false,
        };
      }

      if (parsed.status === 'succeeded') {
        // Atomic conditional update — eliminates TOCTOU race.
        if (!TERMINAL_STATUSES.has(tx.status) || tx.status === 'succeeded') {
          if (tx.status === 'succeeded') {
            // Transaction already succeeded — idempotent, do not update intent.
            await this.providerEventRepo.markProcessed(eventRow.id);
            return {
              eventId: eventRow.id,
              provider,
              providerReference: parsed.providerReference,
              processingStatus: 'processed',
              transaction: tx,
              intent,
              idempotentReplay: false,
            };
          }

          if (this.transactionRepo.applySucceededPayment) {
            const applied = await this.transactionRepo.applySucceededPayment({
              transactionId: tx.id,
              merchantId: tx.merchantId,
              intentId: tx.intentId,
              amount: tx.amount,
            });
            tx = applied.transaction;
            intent = applied.intent;
          } else {
            // Overpayment guard.
            if (intent && tx.amount > intent.amountRemaining) {
              await this.providerEventRepo.markFailed(eventRow.id, `Overpayment rejected: tx.amount=${tx.amount} > intent.amountRemaining=${intent.amountRemaining}`);
              return { eventId: eventRow.id, provider, providerReference: parsed.providerReference, processingStatus: 'failed', transaction: tx, intent, idempotentReplay: false };
            }
            const { changed, transaction: confirmedTx } = await this.transactionRepo.markSucceededIfConfirmable({ id: tx.id, merchantId: tx.merchantId });
            if (changed && confirmedTx && intent) {
              const newAmountPaid = intent.amountPaid + tx.amount;
              const newAmountRemaining = Math.max(0, intent.amountDue - newAmountPaid);
              const newStatus = computeIntentStatus(intent.amountDue, newAmountPaid);
              await this.intentRepo.updateTotals({ id: intent.id, merchantId: tx.merchantId, amountPaid: newAmountPaid, amountRefunded: intent.amountRefunded, amountRemaining: newAmountRemaining });
              intent = await this.intentRepo.updateStatus({ id: intent.id, merchantId: tx.merchantId, status: newStatus });
              tx = confirmedTx;
            }
          }
        }
        // If transaction was already in terminal status (and not succeeded), skip.

      } else if (parsed.status === 'failed' || parsed.status === 'cancelled' || parsed.status === 'expired') {
        // Mark transaction terminal if not already terminal.
        if (!TERMINAL_STATUSES.has(tx.status)) {
          tx = await this.transactionRepo.updateStatus({
            id: tx.id,
            merchantId: tx.merchantId,
            status: parsed.status,
          });
        }
        // Do NOT update intent amountPaid for non-succeeded events.
      }

      await this.providerEventRepo.markProcessed(eventRow.id);

      // Reload intent for final state.
      if (tx) {
        const freshIntent = await this.intentRepo.findById(tx.intentId, tx.merchantId);
        if (freshIntent) intent = freshIntent;
      }

      return {
        eventId: eventRow.id,
        provider,
        providerReference: parsed.providerReference,
        processingStatus: 'processed',
        transaction: tx,
        intent,
        idempotentReplay: false,
      };

    } catch (err: any) {
      // Mark event failed with safe error message (no sensitive data).
      const safeMsg = err?.message ?? String(err);
      await this.providerEventRepo.markFailed(eventRow.id, safeMsg).catch(() => undefined);
      throw err;
    }
  }
}
