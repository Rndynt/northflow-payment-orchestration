/**
 * @northflow/payment-orchestration-client-sdk — Phase 8K Public API
 *
 * Typed HTTP client for the payment-orchestration-service standalone API.
 *
 * Features:
 * - Fetch-compatible (Node 18+ / modern browsers)
 * - Typed request/response shapes aligned to service API contracts
 * - Custom header injection (service token, merchant ID, source app)
 * - merchantId auto-injection from config into POST bodies
 * - Typed error classes (PaymentOrchestrationClientError, PaymentOrchestrationNetworkError)
 *   with `details` field for structured validation errors (Phase 8K)
 * - No React dependency
 * - No AuraPoS tenant/session dependency
 * - No @northflow/payment-orchestration-core dependency (self-contained)
 *
 * Usage (S1-S5 per-client credential — recommended):
 * ```ts
 * import { PaymentOrchestrationClient } from '@northflow/payment-orchestration-client-sdk';
 *
 * const client = new PaymentOrchestrationClient({
 *   baseUrl: process.env.NORTHFLOW_BASE_URL,
 *   apiKey: process.env.NORTHFLOW_API_KEY, // nf.live.<credentialId>.<secret>
 * });
 *
 * const intent = await client.createPaymentIntent({
 *   merchantId: 'mer_abc123',
 *   sourceApp: 'transity',
 *   externalPayableType: 'booking',
 *   externalPayableId: 'booking-456',
 *   currency: 'IDR',
 *   amountDue: 100000,
 *   idempotencyKey: 'transity:tenant-1:booking-456:create-intent',
 * });
 * ```
 *
 * Legacy usage (serviceToken — deprecated, dev-only):
 * ```ts
 * const client = new PaymentOrchestrationClient({
 *   baseUrl: 'http://localhost:3001',
 *   serviceToken: process.env.PAYMENT_ORCHESTRATION_SERVICE_TOKEN,
 * });
 * ```
 */

// ── Primary exports ────────────────────────────────────────────────────────────

export { PaymentOrchestrationClient } from './client.ts';
export { PaymentOrchestrationClientError, PaymentOrchestrationNetworkError } from './errors.ts';
export type {
  PaymentOrchestrationClientConfig,
  CreatePaymentIntentRequest,
  PaymentIntentResponse,
  PaymentTransactionResponse,
  CreateGatewayPaymentRequest,
  GatewayPaymentResponse,
  PaymentIntentStatusResponse,
  RefundabilityResponse,
  RefundableTransactionResponse,
  CreateMerchantRequest,
  MerchantResponse,
  CreateProviderAccountRequest,
  ProviderAccountResponse,
  ConfirmFakeGatewayPaymentRequest,
  ConfirmFakeGatewayPaymentResponse,
  ReconcilePaymentIntentTotalsRequest,
  ReconcileTotalsSnapshot,
  ReconcilePaymentIntentTotalsResponse,
  RefundPaymentTransactionRequest,
  RefundPaymentTransactionResponse,
  VoidPaymentTransactionRequest,
  VoidPaymentTransactionResponse,
  RefreshProviderStatusRequest,
  RefreshProviderStatusResponse,
  ReadinessResponse,
  ProviderActionResponse,
} from './types.ts';

// ── Deprecated aliases (Phase 8B) — will be removed in a future major version ──

/** @deprecated Use PaymentOrchestrationClient instead. */
export { PaymentOrchestrationClient as PaymentEngineClient } from './client.ts';
/** @deprecated Use PaymentOrchestrationClientError instead. */
export { PaymentOrchestrationClientError as PaymentEngineClientError } from './errors.ts';
/** @deprecated Use PaymentOrchestrationNetworkError instead. */
export { PaymentOrchestrationNetworkError as PaymentEngineNetworkError } from './errors.ts';
/** @deprecated Use PaymentOrchestrationClientConfig instead. */
export type { PaymentOrchestrationClientConfig as PaymentEngineClientConfig } from './types.ts';
