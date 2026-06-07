/**
 * PaymentScope — the primary scoping/ownership model for the standalone payment engine.
 *
 * Each payment operation is scoped by a `merchantId` (the commercial entity that
 * owns the payment) rather than an application-specific tenant ID.
 *
 * This allows the payment engine to serve multiple consumer backends
 * without coupling to any one application's auth model.
 *
 * Phase 8A introduces these concepts in contracts only.
 * The embedded legacy payment engine continues to use `tenantId` internally
 * during the migration period (Phase 8B–8E).
 */

/**
 * PaymentScope — the runtime scope for a payment operation.
 *
 * - `merchantId`        — the commercial owner of the payment (maps to legacy tenantId during migration)
 * - `sourceApp`         — the application that created the payment (e.g. 'consumer-a', 'consumer-b')
 * - `externalTenantId`  — tenant ID from the source app, if applicable
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
 * createLegacyTenantPaymentScope — temporary compatibility helper for legacy tenant migration.
 *
 * Maps a legacy `tenantId`/`outletId` to the standalone `PaymentScope` model.
 * During Phase 8B–8E migration, this is the bridge between the old tenant-centric
 * model and the new merchant-centric model.
 *
 * ⚠️ MIGRATION NOTE: This is a temporary adapter.
 * Long-term, consumer backends should register a proper `merchantId` in the payment engine
 * instead of re-using `tenantId` as the merchantId.
 *
 * Mapping:
 *   merchantId      = tenantId    (temporary: tenantId doubles as merchantId)
 *   sourceApp       = sourceApp param (defaults to 'consumer-a')
 *   externalTenantId= tenantId
 *   externalOutletId= outletId
 */
export function createLegacyTenantPaymentScope(input: {
  tenantId: string;
  outletId?: string | null;
  providerAccountId?: string | null;
  sourceApp?: string;
}): PaymentScope {
  return {
    merchantId: input.tenantId,
    sourceApp: input.sourceApp ?? 'consumer-a',
    externalTenantId: input.tenantId,
    externalOutletId: input.outletId ?? null,
    providerAccountId: input.providerAccountId ?? null,
  };
}
