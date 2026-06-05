/**
 * PaymentIntent — standalone payment intent DTO contracts.
 *
 * Uses `merchantId` as the primary owner identity (not AuraPoS `tenantId`).
 * Tracks the external payable reference via `externalPayableType` / `externalPayableId`
 * instead of coupling to AuraPoS order domain.
 *
 * Standalone extraction first. Source applications integrate only after service/package
 * boundary, provider runtime, operations, and extraction simulation are stable.
 */

/**
 * Status of a standalone payment intent.
 *
 * Matches the embedded AuraPoS statuses but uses explicit string union
 * rather than importing from @pos/domain/payments/status.
 */
export type StandaloneIntentStatus =
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
 * StandalonePaymentIntentDTO — the read model returned to callers.
 *
 * Carries merchant-scoped identity (`merchantId`) and external payable references
 * (`externalPayableType`, `externalPayableId`) rather than AuraPoS-specific fields.
 */
export interface StandalonePaymentIntentDTO {
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
  status: StandaloneIntentStatus;
  allowPartial: boolean;
  expiresAt: Date | null;
  metadata: Record<string, unknown> | null;
  idempotencyKey?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * CreateStandalonePaymentIntentInput — input for creating a new payment intent.
 *
 * The caller provides the external payable reference and payment scope.
 * The payment engine assigns the `id`, timestamps, and initial status.
 */
export interface CreateStandalonePaymentIntentInput {
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
