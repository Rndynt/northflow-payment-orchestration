/**
 * PaymentIntent — payment intent DTO contracts.
 *
 * Uses `merchantId` as the primary owner identity (not legacy `tenantId`).
 * Tracks the external payable reference via `externalPayableType` / `externalPayableId`
 * instead of coupling to legacy order domain.
 */

/**
 * Status of a payment intent.
 *
 * Matches the legacy embedded statuses but uses explicit string union
 * rather than importing from a legacy payments domain.
 */
export type PaymentIntentStatus =
  | 'requires_payment'
  | 'partially_paid'
  | 'paid'
  | 'overpaid'
  | 'refunded'
  | 'voided'
  | 'expired'
  | 'cancelled'
  | 'failed';

/** @deprecated Use PaymentIntentStatus instead. */
export type StandaloneIntentStatus = PaymentIntentStatus;

/**
 * PaymentIntentDTO — the read model returned to callers.
 *
 * Carries merchant-scoped identity (`merchantId`) and external payable references
 * (`externalPayableType`, `externalPayableId`) rather than legacy-specific fields.
 */
export interface PaymentIntentDTO {
  id: string;
  merchantId: string;
  providerAccountId: string | null;
  sourceApp: string | null;
  externalTenantId: string | null;
  externalOutletId: string | null;
  externalLocationId: string | null;
  externalPayableType: string;
  externalPayableId: string;
  currency: string;
  amountDue: number;
  amountPaid: number;
  amountRefunded: number;
  amountRemaining: number;
  status: PaymentIntentStatus;
  allowPartial: boolean;
  expiresAt: Date | null;
  metadata: Record<string, unknown> | null;
  idempotencyKey?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** @deprecated Use PaymentIntentDTO instead. */
export type StandalonePaymentIntentDTO = PaymentIntentDTO;

/**
 * CreatePaymentIntentRecordInput — input for creating a new payment intent record.
 *
 * The caller provides the external payable reference and payment scope.
 * The payment engine assigns the `id`, timestamps, and initial status.
 */
export interface CreatePaymentIntentRecordInput {
  merchantId: string;
  sourceApp?: string | null;
  externalTenantId?: string | null;
  externalOutletId?: string | null;
  externalLocationId?: string | null;
  externalPayableType: string;
  externalPayableId: string;
  currency: string;
  amountDue: number;
  allowPartial?: boolean;
  expiresAt?: Date | null;
  metadata?: Record<string, unknown> | null;
  idempotencyKey?: string | null;
}

/** @deprecated Use CreatePaymentIntentRecordInput instead. */
export type CreateStandalonePaymentIntentInput = CreatePaymentIntentRecordInput;
