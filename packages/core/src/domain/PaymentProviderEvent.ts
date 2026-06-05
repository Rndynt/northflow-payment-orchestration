/**
 * PaymentProviderEvent — standalone provider webhook/event DTO.
 *
 * Represents a raw event received from a payment provider (e.g. Xendit webhook).
 * Merchant identity may be initially null; it is resolved after the provider reference
 * is matched to an existing transaction/intent.
 *
 * Phase 8C: standalone domain type. Mirrors `payment_orchestration_provider_events` schema.
 */

/**
 * Processing status of a provider event.
 *
 * - `pending`     — received, not yet processed
 * - `processing`  — currently being handled by a worker
 * - `processed`   — successfully handled
 * - `failed`      — processing failed (see lastError)
 * - `ignored`     — received but intentionally not acted on (duplicate, irrelevant)
 */
export type PaymentProviderEventProcessingStatus =
  | 'pending'
  | 'processing'
  | 'processed'
  | 'failed'
  | 'ignored';

/**
 * PaymentProviderEventDTO — the read model for a provider webhook/event.
 *
 * `merchantId` may be null at initial receipt; it is backfilled once the
 * providerReference is resolved to a known intent/transaction.
 */
export interface PaymentProviderEventDTO {
  id: string;
  merchantId: string | null;
  provider: string;
  providerEventId: string;
  providerReference: string | null;
  eventType: string;
  processingStatus: PaymentProviderEventProcessingStatus;
  processingAttempts: number;
  lastError: string | null;
  rawHeaders: Record<string, unknown>;
  rawBody: Record<string, unknown> | null;
  parsedPayload: Record<string, unknown> | null;
  receivedAt: Date;
  processedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * ReserveProviderEventInput — input for reserving a new provider event (dedup guard).
 */
export interface ReserveProviderEventInput {
  id: string;
  provider: string;
  providerEventId: string;
  providerReference?: string | null;
  eventType: string;
  rawHeaders: Record<string, unknown>;
  rawBody: Record<string, unknown> | null;
  /** Parsed provider payload, stored only after provider verification/parsing succeeds. */
  parsedPayload?: Record<string, unknown> | null;
}
