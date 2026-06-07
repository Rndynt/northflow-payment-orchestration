/**
 * PaymentMerchant — the commercial entity that owns payment accounts and intents.
 *
 * In the standalone model, `merchantId` replaces legacy `tenantId` as the primary
 * payment identity. A merchant maps to a business that processes payments through
 * the payment engine, regardless of which source application created the payment.
 *
 * Phase 8A: contract-only. No DB migration.
 */
export interface PaymentMerchant {
  id: string;
  displayName: string;
  legalName?: string | null;
  status: 'active' | 'suspended' | 'disabled' | 'closed';
  /** Optional source-app correlation retained for standalone idempotent merchant creation. */
  sourceApp?: string | null;
  /** Optional external merchant reference from the source app. */
  externalRef?: string | null;
  metadata?: Record<string, unknown>;
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * ExternalPayableRef — identifies the payable entity in the source application.
 *
 * Decouples the payment engine from any specific payable model (order, invoice, booking, etc.).
 * The source application provides these references; the payment engine stores them for
 * correlation and callback but does not validate their semantics.
 *
 * Fields:
 *   sourceApp           — identifies the application that owns the payable (e.g. 'consumer-a', 'consumer-b')
 *   externalTenantId    — tenant/org ID in the source app (nullable for single-tenant apps)
 *   externalOutletId    — outlet/location ID in the source app
 *   externalLocationId  — alias for externalOutletId
 *   externalPayableType — domain noun in the source app ('order', 'invoice', 'booking', ...)
 *   externalPayableId   — unique ID of the payable in the source app
 */
export interface ExternalPayableRef {
  sourceApp: string;
  externalTenantId?: string | null;
  externalOutletId?: string | null;
  externalLocationId?: string | null;
  externalPayableType: string;
  externalPayableId: string;
}
