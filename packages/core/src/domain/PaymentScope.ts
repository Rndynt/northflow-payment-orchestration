/**
 * PaymentScope — the primary scoping/ownership model for the standalone payment engine.
 *
 * Each payment operation is scoped by a `merchantId` (the Northflow merchant identity).
 * This allows the payment engine to serve multiple consumer backends
 * without coupling to any one application's auth model.
 */

/**
 * PaymentScope — the runtime scope for a payment operation.
 *
 * - `merchantId`        — the Northflow merchant that owns this payment (required)
 * - `sourceApp`         — the consumer backend that created the payment (e.g. 'consumer-a')
 * - `externalTenantId`  — optional reference ID from the consumer's own data model
 * - `externalOutletId`  — optional outlet/location reference from the consumer
 * - `externalLocationId`— alias for externalOutletId (some consumers use 'location')
 * - `providerAccountId` — which provider account to use for this payment
 * - `metadata`          — arbitrary scope-level metadata
 */
export interface PaymentScope {
  merchantId: string;
  sourceApp?: string;
  externalTenantId?: string | null;
  externalOutletId?: string | null;
  externalLocationId?: string | null;
  providerAccountId?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * createPaymentScope — build a PaymentScope from structured input.
 *
 * `merchantId` is the required Northflow merchant identity.
 * `externalTenantId` and `externalOutletId` are optional references
 * from the consumer backend's own data model.
 */
export function createPaymentScope(input: {
  merchantId: string;
  sourceApp?: string;
  externalTenantId?: string | null;
  externalOutletId?: string | null;
  providerAccountId?: string | null;
}): PaymentScope {
  return {
    merchantId: input.merchantId,
    sourceApp: input.sourceApp ?? 'consumer-a',
    externalTenantId: input.externalTenantId ?? null,
    externalOutletId: input.externalOutletId ?? null,
    providerAccountId: input.providerAccountId ?? null,
  };
}
