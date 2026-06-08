/**
 * PaymentIntent — payment intent DTO contracts.
 *
 * Uses `merchantId` as the primary owner identity.
 * Tracks the external payable reference via `externalPayableType` / `externalPayableId`
 * instead of coupling to a source application's payable domain.
 */

/**
 * Status of a payment intent.
 *
 * Defines the Northflow-owned status union as explicit string literals.
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

/**
 * PaymentIntentDTO — the read model returned to callers.
 *
 * Carries merchant-scoped identity (`merchantId`) and external payable references
 * (`externalPayableType`, `externalPayableId`) plus consumer application fields.
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
