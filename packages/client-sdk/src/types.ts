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

/**
 * S9.4: Signing configuration for HMAC signed requests.
 * When enabled, the SDK signs every protected request automatically.
 */
export interface PaymentOrchestrationSigningConfig {
  /** API client ID (same as used for bearer auth). */
  clientId: string;
  /** Key ID or key prefix as returned from the signing key creation response. */
  keyId: string;
  /** Raw signing secret as returned ONCE from create/rotate. Never log or store persistently. */
  secret: string;
  /** If false, signing is disabled even when this config is present. Default: true. */
  enabled?: boolean;
}

export interface PaymentOrchestrationClientConfig {
  baseUrl: string;
  /**
   * S1-S5 per-client API credential in `nf.<env>.<credentialId>.<secret>` format.
   * Sent as `Authorization: Bearer <apiKey>` (public SDK auth method).
   */
  apiKey?: string;
  /** Default merchantId injected into request bodies and headers when not explicitly provided. */
  merchantId?: string;
  sourceApp?: string;
  /**
   * S9.4: Optional HMAC signing configuration.
   * When provided and enabled, every protected request is signed automatically.
   * Signing and bearer auth are independent — you can use both simultaneously or
   * use signing alone (when the service is in required mode).
   */
  signing?: PaymentOrchestrationSigningConfig;
}

// ── S9.4: Signing Key Lifecycle ───────────────────────────────────────────────

export interface ClientSigningKeyResponse {
  id: string;
  clientId: string;
  keyPrefix: string;
  status: 'active' | 'revoked' | 'expired';
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
  metadata: Record<string, unknown>;
}

export interface CreateSigningKeyRequest {
  expiresAt?: string | null;
}

export interface CreateSigningKeyResponse extends ClientSigningKeyResponse {
  rawSigningSecret: string;
}

export interface ListSigningKeysResponse {
  keys: ClientSigningKeyResponse[];
}

export interface RotateSigningKeyRequest {
  revokeOldKeyId?: string | null;
  expiresAt?: string | null;
}

export interface RotateSigningKeyResponse {
  newSigningKey: ClientSigningKeyResponse & { rawSigningSecret: string };
  revokedSigningKey: ClientSigningKeyResponse | null;
}

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

// ── S7.5: Payment Method Options ─────────────────────────────────────────────

export type PaymentMethodStatus = 'active' | 'disabled' | 'unsupported';
export type PaymentMethodType = 'qris' | 'virtual_account' | 'ewallet' | 'card' | 'retail_outlet' | 'manual' | 'other';

export interface ProviderAccountMethodResponse {
  id: string;
  merchantId: string;
  providerAccountId: string;
  provider: string;
  method: string;
  methodType: PaymentMethodType;
  providerMethodCode: string | null;
  displayName: string;
  status: PaymentMethodStatus;
  currency: string;
  minAmount: number | null;
  maxAmount: number | null;
  sortOrder: number;
  publicConfig: Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertProviderAccountMethodRequest {
  method: string;
  methodType?: PaymentMethodType;
  providerMethodCode?: string | null;
  displayName?: string;
  status?: PaymentMethodStatus;
  currency?: string;
  minAmount?: number | null;
  maxAmount?: number | null;
  sortOrder?: number;
  publicConfig?: Record<string, unknown>;
  providerMetadata?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

/**
 * UpsertProviderAccountMethodResponse — unwrapped shape after SDK `{ ok, data }` unwrap.
 * Service returns `{ ok: true, data: { ...method, created } }`.
 * `created` is true when the method was newly created, false when updated.
 */
export interface UpsertProviderAccountMethodResponse extends ProviderAccountMethodResponse {
  created: boolean;
}

/**
 * SyncProviderAccountMethodsResponse — unwrapped shape after SDK `{ ok, data }` unwrap.
 * Service returns `{ ok: true, data: { methods, syncedCount, skippedCount, message } }`.
 */
export interface SyncProviderAccountMethodsResponse {
  methods: ProviderAccountMethodResponse[];
  syncedCount: number;
  skippedCount: number;
  message: string;
}

/**
 * ListProviderAccountMethodsResponse — unwrapped shape after SDK `{ ok, data }` unwrap.
 * Service returns `{ ok: true, data: ProviderAccountMethodResponse[] }`.
 * The unwrapped value is the array directly.
 */
export type ListProviderAccountMethodsResponse = ProviderAccountMethodResponse[];

export interface PaymentOptionItem {
  method: string;
  methodType: PaymentMethodType;
  displayName: string;
  providerAccountId: string;
  provider: string;
  currency: string;
  minAmount: number | null;
  maxAmount: number | null;
  publicConfig: Record<string, unknown>;
}

/**
 * PaymentIntentPaymentOptionsResponse — unwrapped shape after SDK `{ ok, data }` unwrap.
 * Service returns `{ ok: true, data: { intentId, merchantId, currency, amountRemaining, options } }`.
 */
export interface PaymentIntentPaymentOptionsResponse {
  intentId: string;
  merchantId: string;
  currency: string;
  amountRemaining: number;
  options: PaymentOptionItem[];
}

// ── Provider action response ─────────────────────────────────────────────────

/** Shape for provider action descriptors returned by gateway payment responses. */
export interface ProviderActionResponse {
  type: string;
  descriptor: string;
  label: string;
  value: string | null;
  url: string | null;
}

// ── S10.3: Merchant outbound webhook types ────────────────────────────────────

export type MerchantWebhookEventType =
  | 'payment_intent.requires_payment'
  | 'payment_intent.partially_paid'
  | 'payment_intent.paid'
  | 'payment_intent.failed'
  | 'payment_intent.expired'
  | 'payment_intent.cancelled'
  | 'payment_intent.refunded'
  | 'payment_intent.voided'
  | 'payment_transaction.requires_action'
  | 'payment_transaction.succeeded'
  | 'payment_transaction.failed'
  | 'payment_transaction.cancelled'
  | 'payment_transaction.refunded'
  | 'payment_transaction.voided';

export type MerchantWebhookEndpointStatus = 'active' | 'disabled';
export type MerchantWebhookDeliveryStatus = 'queued' | 'delivering' | 'succeeded' | 'failed' | 'dead';

export interface MerchantWebhookEndpointResponse {
  id: string;
  merchantId: string;
  url: string;
  status: MerchantWebhookEndpointStatus;
  subscribedEvents: MerchantWebhookEventType[];
  /** Prefix of the raw secret (safe to store/display). Never the raw secret. */
  secretPrefix: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  disabledAt: string | null;
}

export interface CreateMerchantWebhookEndpointRequest {
  url: string;
  subscribedEvents?: MerchantWebhookEventType[];
  metadata?: Record<string, unknown> | null;
}

/** Returned only once on create or rotate. Store rawSecret in a backend secret manager. */
export interface CreateMerchantWebhookEndpointResponse {
  endpoint: MerchantWebhookEndpointResponse;
  /** Raw secret returned ONCE. Never echoed again. */
  rawSecret: string;
}

export interface ListMerchantWebhookEndpointsResponse {
  endpoints: MerchantWebhookEndpointResponse[];
}

export interface RotateMerchantWebhookEndpointSecretResponse {
  endpoint: MerchantWebhookEndpointResponse;
  /** New raw secret returned ONCE. Never echoed again. */
  rawSecret: string;
}

export interface MerchantWebhookDeliveryResponse {
  id: string;
  eventId: string;
  endpointId: string;
  merchantId: string;
  status: MerchantWebhookDeliveryStatus;
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: string;
  lastAttemptAt: string | null;
  lastResponseStatus: number | null;
  lastResponseBodyTruncated: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  deliveredAt: string | null;
}

export interface ListMerchantWebhookDeliveriesResponse {
  deliveries: MerchantWebhookDeliveryResponse[];
}

export interface ReplayMerchantWebhookRequest {
  /** Replay a specific delivery by ID. */
  deliveryId?: string | null;
  /** Replay all active endpoints for an event by ID. */
  eventId?: string | null;
}

export interface ReplayMerchantWebhookResponse {
  /** Present when replaying by deliveryId. */
  delivery?: MerchantWebhookDeliveryResponse;
  /** Present when replaying by eventId. */
  deliveries?: MerchantWebhookDeliveryResponse[];
}
