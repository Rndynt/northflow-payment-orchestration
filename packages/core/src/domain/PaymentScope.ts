/**
 * PaymentScope — the primary scoping/ownership model for the standalone payment engine.
 *
 * Each payment operation is scoped by a `merchantId` (the commercial entity that
 * owns the payment) rather than an application-specific ID.
 *
 * This allows the payment engine to serve multiple consumer backends
 * without coupling to any one application's auth model.
 *
 * Phase 8A introduces these concepts in contracts only.
 * The embedded legacy payment engine continues to use its own internal ID
 * during the migration period (Phase 8B–8E).
 */

/**
 * PaymentScope — the runtime scope for a payment operation.
 *
 * - `merchantId`        — the commercial owner of the payment (the Northflow merchant identity)
 * - `sourceApp`         — the application that created the payment (e.g. 'consumer-a', 'consumer-b')
 * - `externalTenantId`  — ID from the source app's own data model, if applicable
 * - `externalOutletId`  — outlet/location ID from the source app, if applicable
 * - `externalLocationId`— alias for externalOutletId (some apps use 'location')
 * - `providerAccountId` — which merchant provider account to use for this payment
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
 * createConsumerPaymentScope — compatibility helper for migrating legacy consumer backends.
 *
 * Maps a legacy consumer backend's own internal ID and outlet ID to the Northflow
 * `PaymentScope` model, where `merchantId` is the primary payment owner identity.
 *
 * ⚠️ MIGRATION NOTE: This is a temporary adapter.
 * Long-term, consumer backends should register a proper `merchantId` in Northflow
 * instead of mapping their own internal IDs here.
 *
 * Mapping:
 *   merchantId       = legacyId   (temporary: legacy internal ID doubles as merchantId)
 *   sourceApp        = sourceApp param (defaults to 'consumer-a')
 *   externalTenantId = legacyId
 *   externalOutletId = outletId
 */
export function createConsumerPaymentScope(input: {
  legacyId: string;
  outletId?: string | null;
  providerAccountId?: string | null;
  sourceApp?: string;
}): PaymentScope {
  return {
    merchantId: input.legacyId,
    sourceApp: input.sourceApp ?? 'consumer-a',
    externalTenantId: input.legacyId,
    externalOutletId: input.outletId ?? null,
    providerAccountId: input.providerAccountId ?? null,
  };
}
