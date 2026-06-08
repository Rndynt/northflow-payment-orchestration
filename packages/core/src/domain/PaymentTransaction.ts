/**
 * PaymentTransaction — payment transaction DTO contracts.
 *
 * Represents an individual payment attempt against a PaymentIntent.
 * Scoped by `merchantId` (not legacy `tenantId`).
 */

/**
 * Status of a payment transaction.
 *
 * - `pending`         — submitted but not yet confirmed by provider
 * - `requires_action` — waiting for customer action (QR scan, redirect, VA payment)
 * - `succeeded`       — payment confirmed by provider or manual confirmation
 * - `failed`          — payment rejected by provider or timed out
 * - `cancelled`       — cancelled before settlement (void)
 */
export type PaymentTransactionStatus =
  | 'pending'
  | 'requires_action'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'expired'
  | 'voided'
  | 'refunded'
  | 'reversed'
  | 'ignored';

/**
 * PaymentTransactionDTO — the read model for a payment transaction.
 */
export interface PaymentTransactionDTO {
  id: string;
  merchantId: string;
  intentId: string;
  providerAccountId: string | null;
  provider: string;
  method: string;
  transactionType: string;
  status: PaymentTransactionStatus;
  direction: 'incoming' | 'outgoing';
  amount: number;
  currency: string;
  parentTransactionId: string | null;
  providerReference: string | null;
  providerEventId: string | null;
  providerPaymentUrl: string | null;
  providerQrString: string | null;
  failureReason: string | null;
  idempotencyKey: string | null;
  expiresAt: Date | null;
  metadata: Record<string, unknown> | null;
  rawProviderResponse: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}
