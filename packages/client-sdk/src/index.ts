/**
 * @northflow/payment-orchestration-client-sdk — Phase 8K Public API
 *
 * Typed HTTP client for the payment-orchestration-service standalone API.
 *
 * Features:
 * - Fetch-compatible (Node 18+ / modern browsers)
 * - Typed request/response shapes aligned to service API contracts
 * - Custom header injection (API key, merchant ID, source app)
 * - merchantId auto-injection from config into POST bodies
 * - Typed error classes (PaymentOrchestrationClientError, PaymentOrchestrationNetworkError)
 *   with `details` field for structured validation errors (Phase 8K)
 * - No React dependency
 * - No external tenant/session dependency
 * - Uses @northflow/payment-orchestration-core canonical request helpers for request signing
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
 *   sourceApp: 'checkout-backend',
 *   externalPayableType: 'order',
 *   externalPayableId: 'order_456',
 *   currency: 'IDR',
 *   amountDue: 100000,
 *   idempotencyKey: 'order:order_456:create-intent',
 * });
 * ```
 *
 * Optional request signing:
 * ```ts
 * const client = new PaymentOrchestrationClient({
 *   baseUrl: process.env.NORTHFLOW_BASE_URL,
 *   apiKey: process.env.NORTHFLOW_API_KEY,
 *   signing: { clientId, keyId, secret },
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
  // S7.5: Payment Method Options
  PaymentMethodStatus,
  PaymentMethodType,
  ProviderAccountMethodResponse,
  UpsertProviderAccountMethodRequest,
  UpsertProviderAccountMethodResponse,
  SyncProviderAccountMethodsResponse,
  ListProviderAccountMethodsResponse,
  PaymentOptionItem,
  PaymentIntentPaymentOptionsResponse,
} from './types.ts';
