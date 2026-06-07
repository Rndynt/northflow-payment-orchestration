/**
 * types — request/response shapes for payment-orchestration-client-sdk.
 *
 * Self-contained; does NOT import from @northflow/payment-orchestration-core to keep
 * the SDK portable and independently versioned.
 *
 * Phase 8D Hardening: rich response shapes aligned to actual service API contracts.
 *   - GatewayPaymentResponse: { transaction, intent, idempotentReplay }
 *   - PaymentIntentStatusResponse: { intent, latestTransaction, isTerminal, requiresAction, canRetryPayment }
 *   - RefundabilityResponse: { intentId, merchantId, totalRefundable, currency, transactions }
 *   - ProviderAccountResponse: includes providerAccountRef; never credentialsRef
 *   - ConfirmFakeGatewayPaymentRequest.merchantId: optional (falls back to config.merchantId)
 * Phase 8K: added RefreshProviderStatusRequest/Response, ReadinessResponse.
 */

// ── Client Configuration ──────────────────────────────────────────────────────

export interface PaymentOrchestrationClientConfig {
  baseUrl: string;
  /**
   * S1-S5 per-client API credential in `nf.<env>.<credentialId>.<secret>` format.
   * Sent as `Authorization: Bearer <apiKey>` (primary auth method).
   * Use this instead of `serviceToken` for all new integrations.
   */
  apiKey?: string;
  /**
   * @deprecated Legacy shared service token.
   * Use `apiKey` (per-client credential) for new integrations.
   * Sent as `x-payment-orchestration-service-token` when no `apiKey` is present.
   */
  serviceToken?: string;
  /** Default merchantId injected into request bodies and headers when not explicitly provided. */
  merchantId?: string;
  sourceApp?: string;
}

/** @deprecated Use PaymentOrchestrationClientConfig instead. */
export type PaymentEngineClientConfig = PaymentOrchestrationClientConfig;

// ── Shared sub-types ──────────────────────────────────────────────────────────

/**
 * PaymentIntentResponse — serialized payment intent.
 * Matches the serializeIntent() shape returned by the service.
 */
export interface PaymentIntentResponse {
  id: string;
  merchantId: string;
  externalPayableType: string;
  externalPayableId: string;
  currency: string;
  amountDue: number;
  amountPaid: number;
  amountRefunded: number;
  amountRemaining: number;
  status: string;
  allowPartial: boolean;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * PaymentTransactionResponse — serialized payment transaction.
 * Matches the serializeTransaction() shape returned by the service.
 */
export interface PaymentTransactionResponse {
  id: string;
  intentId: string;
  merchantId: string;
  provider: string;
  method: string;
  status: string;
  amount: number;
  currency: string;
  providerReference: string | null;
  providerPaymentUrl: string | null;
  providerQrString: string | null;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Create Payment Intent ─────────────────────────────────────────────────────

/**
 * CreatePaymentIntentRequest — synced with core CreatePaymentIntentInput.
 *
 * merchantId is optional; falls back to SDK config.merchantId (injected via body
 * and x-payment-merchant-id header automatically).
 */
export interface CreatePaymentIntentRequest {
  /** Optional — falls back to SDK config.merchantId when omitted. */
  merchantId?: string;
  sourceApp?: string | null;
  externalTenantId?: string | null;
  externalOutletId?: string | null;
  externalLocationId?: string | null;
  externalPayableType: string;
  externalPayableId: string;
  currency: string;
  amountDue: number;
  allowPartial?: boolean;
  expiresAt?: string | null;
  metadata?: Record<string, unknown> | null;
  idempotencyKey?: string | null;
}

// ── Create Gateway Payment ────────────────────────────────────────────────────

export interface CreateGatewayPaymentRequest {
  /** Optional — falls back to SDK config.merchantId when omitted. */
  merchantId?: string;
  provider: string;
  method: string;
  amount: number;
  idempotencyKey?: string | null;
  providerAccountId?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * GatewayPaymentResponse — rich response matching the service shape.
 * Contains both the created transaction and the updated intent.
 */
export interface GatewayPaymentResponse {
  transaction: PaymentTransactionResponse;
  intent: PaymentIntentResponse;
  /** True when idempotencyKey matched a prior completed request (provider NOT called again). */
  idempotentReplay: boolean;
}

// ── Payment Intent Status ─────────────────────────────────────────────────────

/**
 * PaymentIntentStatusResponse — rich status read model matching the service shape.
 */
export interface PaymentIntentStatusResponse {
  intent: PaymentIntentResponse;
  latestTransaction: PaymentTransactionResponse | null;
  isTerminal: boolean;
  requiresAction: boolean;
  canRetryPayment: boolean;
}

// ── Refundability ─────────────────────────────────────────────────────────────

/**
 * RefundableTransactionResponse — per-transaction refundability breakdown.
 */
export interface RefundableTransactionResponse {
  transactionId: string;
  amount: number;
  amountAlreadyRefunded: number;
  amountRefundable: number;
  provider: string;
  method: string;
}

/**
 * RefundabilityResponse — rich response matching the service shape.
 */
export interface RefundabilityResponse {
  intentId: string;
  merchantId: string;
  totalRefundable: number;
  currency: string;
  transactions: RefundableTransactionResponse[];
}


// ── Reconcile Payment Intent Totals ──────────────────────────────────────────

export interface ReconcilePaymentIntentTotalsRequest {
  /** Optional — falls back to SDK config.merchantId when omitted. */
  merchantId?: string;
}

export interface ReconcileTotalsSnapshot {
  amountPaid: number;
  amountRefunded: number;
  amountRemaining: number;
  status: string;
}

/**
 * ReconcilePaymentIntentTotalsResponse — service-token protected crash-recovery
 * response for recomputing intent totals from transaction source of truth.
 */
export interface ReconcilePaymentIntentTotalsResponse {
  intent: PaymentIntentResponse;
  before: ReconcileTotalsSnapshot;
  after: ReconcileTotalsSnapshot;
  changed: boolean;
}
// ── Refund / Void Payment Transaction ───────────────────────────────────────

export interface RefundPaymentTransactionRequest {
  /** Optional — falls back to SDK config.merchantId when omitted. */
  merchantId?: string;
  amount: number;
  reason?: string | null;
  idempotencyKey?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface RefundPaymentTransactionResponse {
  refundTransaction: PaymentTransactionResponse;
  intent: PaymentIntentResponse;
  refundableRemaining?: number;
  providerRefunded: boolean;
  idempotentReplay: boolean;
}

export interface VoidPaymentTransactionRequest {
  /** Optional — falls back to SDK config.merchantId when omitted. */
  merchantId?: string;
  reason?: string | null;
  idempotencyKey?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface VoidPaymentTransactionResponse {
  transaction: PaymentTransactionResponse;
  intent: PaymentIntentResponse | null;
  providerCancelled: boolean;
  idempotentReplay: boolean;
}

// ── Phase 8D: Merchant ────────────────────────────────────────────────────────

export interface CreateMerchantRequest {
  id?: string;
  name: string;
  legalName?: string | null;
  sourceApp?: string | null;
  externalRef?: string | null;
  metadata?: Record<string, unknown>;
}

export interface MerchantResponse {
  id: string;
  name: string;
  legalName: string | null;
  status: string;
  metadata: Record<string, unknown>;
}

// ── Phase 8D: Provider Account ────────────────────────────────────────────────

export interface CreateProviderAccountRequest {
  id?: string;
  provider: string;
  environment: 'sandbox' | 'test' | 'production';
  /** Provider's own account identifier — safe to store and return in responses. */
  providerAccountRef?: string | null;
  /** Opaque secret-store reference — NEVER echoed in API responses. */
  credentialsRef?: string | null;
  publicConfig?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

/**
 * ProviderAccountResponse — public API shape.
 * Includes providerAccountRef; never exposes credentialsRef.
 */
export interface ProviderAccountResponse {
  id: string;
  merchantId: string;
  provider: string;
  environment: string;
  /** Provider's own account identifier. Safe to include in responses. */
  providerAccountRef: string | null;
  status: string;
  publicConfig: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

// ── Phase 8D: FakeGateway Dev Confirm ─────────────────────────────────────────

export interface ConfirmFakeGatewayPaymentRequest {
  /** Optional — falls back to SDK config.merchantId when omitted. */
  merchantId?: string;
}

export interface ConfirmFakeGatewayPaymentResponse {
  alreadyConfirmed: boolean;
  transaction: PaymentTransactionResponse;
  intent: PaymentIntentResponse;
}

// ── Phase 8K: Refresh Provider Status ────────────────────────────────────────

export interface RefreshProviderStatusRequest {
  /** Optional — falls back to SDK config.merchantId when omitted. */
  merchantId?: string;
}

/**
 * RefreshProviderStatusResponse — result of polling the payment provider
 * for the current transaction status.
 */
export interface RefreshProviderStatusResponse {
  transaction: PaymentTransactionResponse;
  intent: PaymentIntentResponse | null;
  /** Raw provider status string as returned by the provider API. */
  providerStatus: string;
  /** True if the transaction or intent status was updated during this refresh. */
  changed: boolean;
}

// ── Phase 8K: Readiness ───────────────────────────────────────────────────────

/**
 * ReadinessResponse — service runtime readiness.
 * Does not expose secrets or service token.
 */
export interface ReadinessResponse {
  ok: boolean;
  service: string;
  providers: Record<string, { registered: boolean; configured?: boolean }>;
  database: 'configured' | 'unconfigured';
  xenditSandbox?: {
    enabled: boolean;
    callbackTokenConfigured: boolean;
  };
}

// ── Legacy / deprecated ───────────────────────────────────────────────────────

/** @deprecated Not used by the service — use GatewayPaymentResponse instead. */
export interface ProviderActionResponse {
  type: string;
  descriptor: string;
  label: string;
  value: string | null;
  url: string | null;
}
