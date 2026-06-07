/**
 * client — typed HTTP client for payment-orchestration-service.
 *
 * Targets `/v1/...` paths for the standalone payment-orchestration-service.
 * Supports custom headers: Authorization: Bearer, x-nf-api-key, x-payment-merchant-id, x-source-app.
 *
 * Fetch-compatible; uses the global `fetch` API (Node 18+ / modern browsers).
 * No React dependency. No external tenant dependency.
 *
 * Phase 8A: methods implemented as real HTTP wrappers.
 * Phase 8B: class renamed to PaymentOrchestrationClient. PaymentEngineClient is a deprecated alias.
 * Phase 8D Hardening:
 *   - merchantId injected into POST bodies from config when not provided in input.
 *   - GET status/refundability: merchantId from config used via x-payment-merchant-id header.
 *   - Response types updated to rich service shapes.
 *   - confirmFakeGatewayPayment: merchantId optional, falls back to config.
 * Phase 8K:
 *   - Added refreshProviderStatus() and getReadiness() methods.
 *   - Error parsing updated for frozen nested error envelope:
 *     { ok: false, error: { code, message, details } }
 *   - PaymentOrchestrationClientError now carries `details` field.
 * Phase S6:
 *   - Added `apiKey` config field (nf.<env>.<credentialId>.<secret>).
 *   - apiKey is sent as `Authorization: Bearer <apiKey>` (primary S1-S5 auth method).
 *   - Legacy `serviceToken` still supported via x-payment-orchestration-service-token.
 *   - Auth priority: apiKey > serviceToken (legacy).
 */

import {
  hashBody,
  buildCanonicalString,
  computeSignature,
  SIGNATURE_VERSION,
  CANONICAL_ALGORITHM,
} from '@northflow/payment-orchestration-core';
import { PaymentOrchestrationClientError, PaymentOrchestrationNetworkError } from './errors.ts';
import type {
  PaymentOrchestrationClientConfig,
  PaymentOrchestrationSigningConfig,
  CreatePaymentIntentRequest,
  PaymentIntentResponse,
  CreateGatewayPaymentRequest,
  GatewayPaymentResponse,
  PaymentIntentStatusResponse,
  RefundabilityResponse,
  CreateMerchantRequest,
  MerchantResponse,
  CreateProviderAccountRequest,
  ProviderAccountResponse,
  ConfirmFakeGatewayPaymentRequest,
  ConfirmFakeGatewayPaymentResponse,
  ReconcilePaymentIntentTotalsRequest,
  ReconcilePaymentIntentTotalsResponse,
  RefundPaymentTransactionRequest,
  RefundPaymentTransactionResponse,
  VoidPaymentTransactionRequest,
  VoidPaymentTransactionResponse,
  RefreshProviderStatusRequest,
  RefreshProviderStatusResponse,
  ReadinessResponse,
  ProviderAccountMethodResponse,
  UpsertProviderAccountMethodRequest,
  UpsertProviderAccountMethodResponse,
  SyncProviderAccountMethodsResponse,
  ListProviderAccountMethodsResponse,
  PaymentIntentPaymentOptionsResponse,
  CreateSigningKeyRequest,
  CreateSigningKeyResponse,
  ListSigningKeysResponse,
  RotateSigningKeyRequest,
  RotateSigningKeyResponse,
  ClientSigningKeyResponse,
} from './types.ts';

// ── S9.4: HMAC signing helpers ────────────────────────────────────────────────
// Canonical string construction and signing are delegated to
// @northflow/payment-orchestration-core to ensure service and client use
// identical algorithms. No local reimplementation of HMAC or body hashing.

interface SigningHeaders {
  'x-nf-client-id': string;
  'x-nf-key-id': string;
  'x-nf-timestamp': string;
  'x-nf-nonce': string;
  'x-nf-signature': string;
  'x-nf-signature-version': string;
}

function generateNonce(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function buildSigningHeaders(
  signing: PaymentOrchestrationSigningConfig,
  method: string,
  path: string,
  queryStr: string,
  bodyBytes: Uint8Array | null,
): Promise<SigningHeaders> {
  const timestampMs = Date.now();
  const nonce = generateNonce();
  const bodyHashResult = hashBody(bodyBytes);
  const bodyHash = bodyHashResult instanceof Promise ? await bodyHashResult : bodyHashResult;
  const canonicalStr = buildCanonicalString({
    timestampMs,
    nonce,
    method,
    path,
    query: queryStr,
    bodyHash,
  });
  const signature = await computeSignature(signing.secret, canonicalStr);

  return {
    'x-nf-client-id': signing.clientId,
    'x-nf-key-id': signing.keyId,
    'x-nf-timestamp': String(timestampMs),
    'x-nf-nonce': nonce,
    'x-nf-signature': signature,
    'x-nf-signature-version': SIGNATURE_VERSION,
  };
}

export class PaymentOrchestrationClient {
  private readonly baseUrl: string;
  private readonly defaultHeaders: Record<string, string>;
  private readonly configMerchantId: string | undefined;
  private readonly signing: PaymentOrchestrationSigningConfig | null;

  constructor(config: PaymentOrchestrationClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.configMerchantId = config.merchantId;
    this.signing = (config.signing && config.signing.enabled !== false) ? config.signing : null;
    this.defaultHeaders = {
      'Content-Type': 'application/json',
    };
    // Auth priority: apiKey (S1-S5 per-client credential) > serviceToken (legacy).
    if (config.apiKey) {
      // Primary S1-S5 auth: Authorization: Bearer <nf.env.credentialId.secret>
      this.defaultHeaders['authorization'] = `Bearer ${config.apiKey}`;
    } else if (config.serviceToken) {
      // Legacy fallback — only when no apiKey is provided.
      this.defaultHeaders['x-payment-orchestration-service-token'] = config.serviceToken;
    }
    if (config.merchantId) {
      this.defaultHeaders['x-payment-merchant-id'] = config.merchantId;
    }
    if (config.sourceApp) {
      this.defaultHeaders['x-source-app'] = config.sourceApp;
    }
  }

  // ── Internal helpers ────────────────────────────────────────────────────────

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<T> {
    const pathWithQuery = path;
    const questionMark = path.indexOf('?');
    const purePathStr = questionMark >= 0 ? path.slice(0, questionMark) : path;
    const queryStr = questionMark >= 0 ? path.slice(questionMark) : '';

    const url = `${this.baseUrl}${pathWithQuery}`;
    const headers: Record<string, string> = { ...this.defaultHeaders, ...extraHeaders };

    let bodyBytes: Uint8Array | null = null;
    let bodyString: string | undefined;
    if (body !== undefined) {
      bodyString = JSON.stringify(body);
      bodyBytes = new TextEncoder().encode(bodyString);
    }

    // S9.4: Attach HMAC signing headers when signing is configured.
    if (this.signing) {
      const sigHeaders = await buildSigningHeaders(
        this.signing,
        method,
        purePathStr,
        queryStr,
        bodyBytes,
      );
      Object.assign(headers, sigHeaders);
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: bodyString,
      });
    } catch (err: unknown) {
      throw new PaymentOrchestrationNetworkError(
        `Network error calling payment-orchestration-service: ${String(err)}`,
        err,
      );
    }

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      // Phase 8K frozen error envelope: { ok: false, error: { code, message, details } }
      // Also handles legacy flat format: { ok: false, error: 'CODE', message: '...' }
      const errorObj = data != null && typeof data === 'object' && 'error' in data
        ? (data as Record<string, unknown>)['error']
        : null;

      let code: string | undefined;
      let message: string;
      let details: unknown = null;

      if (errorObj != null && typeof errorObj === 'object') {
        // Nested envelope (Phase 8K)
        const e = errorObj as Record<string, unknown>;
        code = typeof e['code'] === 'string' ? e['code'] : undefined;
        message = typeof e['message'] === 'string'
          ? e['message']
          : `HTTP ${response.status} from payment-orchestration-service`;
        details = e['details'] ?? null;
      } else if (typeof errorObj === 'string') {
        // Legacy flat format (backward compat)
        code = errorObj;
        message = data != null && typeof data === 'object' && 'message' in data
          ? String((data as Record<string, unknown>)['message'])
          : `HTTP ${response.status} from payment-orchestration-service`;
      } else {
        code = undefined;
        message = `HTTP ${response.status} from payment-orchestration-service`;
      }

      throw new PaymentOrchestrationClientError(message, response.status, code, details, data);
    }

    // Unwrap { ok, data } envelope if present; otherwise return data as-is.
    if (data != null && typeof data === 'object' && 'data' in data) {
      return (data as Record<string, unknown>)['data'] as T;
    }
    return data as T;
  }

  /**
   * Merge the SDK config's merchantId into a POST body when not explicitly provided.
   * Returns the enriched body object.
   */
  private injectMerchantId<T extends { merchantId?: string }>(input: T): T & { merchantId?: string } {
    if (input.merchantId || !this.configMerchantId) return input;
    return { ...input, merchantId: this.configMerchantId };
  }

  // ── Public methods ──────────────────────────────────────────────────────────

  /**
   * createPaymentIntent — create a new payment intent.
   *
   * POST /v1/payment-intents
   *
   * merchantId from input or falls back to config.merchantId.
   */
  async createPaymentIntent(
    input: CreatePaymentIntentRequest,
  ): Promise<PaymentIntentResponse> {
    return this.request<PaymentIntentResponse>(
      'POST',
      '/v1/payment-intents',
      this.injectMerchantId(input),
    );
  }

  /**
   * createGatewayPayment — create a gateway payment for an existing intent.
   *
   * POST /v1/payment-intents/:intentId/gateway-payments
   *
   * merchantId from input or falls back to config.merchantId.
   */
  async createGatewayPayment(
    intentId: string,
    input: CreateGatewayPaymentRequest,
  ): Promise<GatewayPaymentResponse> {
    return this.request<GatewayPaymentResponse>(
      'POST',
      `/v1/payment-intents/${intentId}/gateway-payments`,
      this.injectMerchantId(input),
    );
  }

  /**
   * getPaymentIntentStatus — poll the status of a payment intent.
   *
   * GET /v1/payment-intents/:intentId/status
   *
   * merchantId resolved from: options.merchantId → config.merchantId header (x-payment-merchant-id).
   */
  async getPaymentIntentStatus(
    intentId: string,
    options?: { merchantId?: string },
  ): Promise<PaymentIntentStatusResponse> {
    const merchantId = options?.merchantId ?? this.configMerchantId;
    const qs = merchantId ? `?merchantId=${encodeURIComponent(merchantId)}` : '';
    return this.request<PaymentIntentStatusResponse>(
      'GET',
      `/v1/payment-intents/${intentId}/status${qs}`,
    );
  }

  /**
   * getRefundability — check the refundable amount for a payment intent.
   *
   * GET /v1/payment-intents/:intentId/refundability
   *
   * merchantId resolved from: options.merchantId → config.merchantId header.
   */
  async getRefundability(
    intentId: string,
    options?: { merchantId?: string },
  ): Promise<RefundabilityResponse> {
    const merchantId = options?.merchantId ?? this.configMerchantId;
    const qs = merchantId ? `?merchantId=${encodeURIComponent(merchantId)}` : '';
    return this.request<RefundabilityResponse>(
      'GET',
      `/v1/payment-intents/${intentId}/refundability${qs}`,
    );
  }

  /**
   * reconcilePaymentIntentTotals — recompute intent totals from transaction state.
   *
   * POST /v1/payment-intents/:intentId/reconcile
   *
   * This is an operator/service-token protected crash-recovery endpoint, not a
   * customer-facing payment action. merchantId from input or config.merchantId.
   */
  async reconcilePaymentIntentTotals(
    intentId: string,
    input?: ReconcilePaymentIntentTotalsRequest,
  ): Promise<ReconcilePaymentIntentTotalsResponse> {
    return this.request<ReconcilePaymentIntentTotalsResponse>(
      'POST',
      `/v1/payment-intents/${intentId}/reconcile`,
      this.injectMerchantId(input ?? {}),
    );
  }

  /**
   * refundPaymentTransaction — refund a succeeded payment transaction.
   *
   * POST /v1/payment-transactions/:transactionId/refund
   *
   * merchantId from input or falls back to config.merchantId. idempotencyKey is
   * passed through in the JSON body when supplied.
   */
  async refundPaymentTransaction(
    transactionId: string,
    input: RefundPaymentTransactionRequest,
  ): Promise<RefundPaymentTransactionResponse> {
    return this.request<RefundPaymentTransactionResponse>(
      'POST',
      `/v1/payment-transactions/${transactionId}/refund`,
      this.injectMerchantId(input),
    );
  }

  /**
   * voidPaymentTransaction — cancel/void a pending or requires_action transaction.
   *
   * POST /v1/payment-transactions/:transactionId/void
   *
   * merchantId from input or falls back to config.merchantId. idempotencyKey is
   * passed through in the JSON body when supplied.
   */
  async voidPaymentTransaction(
    transactionId: string,
    input?: VoidPaymentTransactionRequest,
  ): Promise<VoidPaymentTransactionResponse> {
    return this.request<VoidPaymentTransactionResponse>(
      'POST',
      `/v1/payment-transactions/${transactionId}/void`,
      this.injectMerchantId(input ?? {}),
    );
  }

  // ── Phase 8D: merchant + provider account methods ────────────────────────────

  /**
   * createMerchant — create or return an existing merchant.
   *
   * POST /v1/merchants
   */
  async createMerchant(input: CreateMerchantRequest): Promise<MerchantResponse> {
    return this.request<MerchantResponse>('POST', '/v1/merchants', input);
  }

  /**
   * getMerchant — retrieve a merchant by ID.
   *
   * GET /v1/merchants/:id
   */
  async getMerchant(id: string): Promise<MerchantResponse> {
    return this.request<MerchantResponse>('GET', `/v1/merchants/${id}`);
  }

  /**
   * createProviderAccount — create a provider account for a merchant.
   *
   * POST /v1/merchants/:merchantId/provider-accounts
   */
  async createProviderAccount(
    merchantId: string,
    input: CreateProviderAccountRequest,
  ): Promise<ProviderAccountResponse> {
    return this.request<ProviderAccountResponse>(
      'POST',
      `/v1/merchants/${merchantId}/provider-accounts`,
      input,
    );
  }

  /**
   * getProviderAccount — retrieve a provider account.
   *
   * GET /v1/merchants/:merchantId/provider-accounts/:id
   */
  async getProviderAccount(
    merchantId: string,
    id: string,
  ): Promise<ProviderAccountResponse> {
    return this.request<ProviderAccountResponse>(
      'GET',
      `/v1/merchants/${merchantId}/provider-accounts/${id}`,
    );
  }

  /**
   * confirmFakeGatewayPayment — manually confirm a FakeGateway transaction.
   *
   * POST /v1/dev/fake-gateway/transactions/:transactionId/confirm
   *
   * ⚠ DEV/TEST ONLY. Not available in production.
   *
   * merchantId from input or falls back to config.merchantId.
   */
  async confirmFakeGatewayPayment(
    transactionId: string,
    input?: ConfirmFakeGatewayPaymentRequest,
  ): Promise<ConfirmFakeGatewayPaymentResponse> {
    return this.request<ConfirmFakeGatewayPaymentResponse>(
      'POST',
      `/v1/dev/fake-gateway/transactions/${transactionId}/confirm`,
      this.injectMerchantId(input ?? {}),
    );
  }

  // ── Phase 8K: refresh provider status + readiness ────────────────────────────

  /**
   * refreshProviderStatus — poll the payment provider for the current transaction status.
   *
   * POST /v1/payment-transactions/:transactionId/refresh-provider-status
   *
   * merchantId from input or falls back to config.merchantId.
   */
  async refreshProviderStatus(
    transactionId: string,
    input?: RefreshProviderStatusRequest,
  ): Promise<RefreshProviderStatusResponse> {
    return this.request<RefreshProviderStatusResponse>(
      'POST',
      `/v1/payment-transactions/${transactionId}/refresh-provider-status`,
      this.injectMerchantId(input ?? {}),
    );
  }

  /**
   * getReadiness — check service runtime readiness.
   *
   * GET /ready
   *
   * No auth required. Returns DB configuration state, registered providers,
   * and Xendit sandbox config. Does not expose secrets or service token.
   */
  async getReadiness(): Promise<ReadinessResponse> {
    return this.request<ReadinessResponse>('GET', '/ready');
  }

  // ── S7.5: Payment Method Options ─────────────────────────────────────────────

  /**
   * listProviderAccountMethods — list all payment methods for a specific provider account.
   *
   * GET /v1/merchants/:merchantId/provider-accounts/:providerAccountId/methods
   *
   * Required scope: payment_method:read OR provider_account:read
   */
  async listProviderAccountMethods(
    merchantId: string,
    providerAccountId: string,
  ): Promise<ProviderAccountMethodResponse[]> {
    const mid = merchantId || this.configMerchantId || '';
    return this.request<ProviderAccountMethodResponse[]>(
      'GET',
      `/v1/merchants/${encodeURIComponent(mid)}/provider-accounts/${encodeURIComponent(providerAccountId)}/methods`,
    );
  }

  /**
   * listMerchantPaymentMethods — list all active payment methods across all provider accounts for a merchant.
   *
   * GET /v1/merchants/:merchantId/payment-methods
   *
   * Required scope: payment_method:read OR provider_account:read OR intent:read
   */
  async listMerchantPaymentMethods(merchantId?: string): Promise<ProviderAccountMethodResponse[]> {
    const mid = merchantId || this.configMerchantId || '';
    return this.request<ProviderAccountMethodResponse[]>(
      'GET',
      `/v1/merchants/${encodeURIComponent(mid)}/payment-methods`,
    );
  }

  /**
   * upsertProviderAccountMethod — create or update a payment method for a provider account.
   *
   * PUT /v1/merchants/:merchantId/provider-accounts/:providerAccountId/methods/:method
   *
   * Required scope: payment_method:write OR provider_account:create
   */
  async upsertProviderAccountMethod(
    merchantId: string,
    providerAccountId: string,
    method: string,
    input: UpsertProviderAccountMethodRequest,
  ): Promise<UpsertProviderAccountMethodResponse> {
    const mid = merchantId || this.configMerchantId || '';
    return this.request<UpsertProviderAccountMethodResponse>(
      'PUT',
      `/v1/merchants/${encodeURIComponent(mid)}/provider-accounts/${encodeURIComponent(providerAccountId)}/methods/${encodeURIComponent(method)}`,
      input,
    );
  }

  /**
   * syncProviderAccountMethods — sync provider adapter capabilities into the DB for a provider account.
   *
   * POST /v1/merchants/:merchantId/provider-accounts/:providerAccountId/methods/sync
   *
   * Required scope: payment_method:sync OR provider_account:create
   *
   * Layer 1 (static capabilities from adapter) and optionally Layer 2 (live provider API call).
   * Idempotent — safe to call multiple times.
   */
  async syncProviderAccountMethods(
    merchantId: string,
    providerAccountId: string,
  ): Promise<SyncProviderAccountMethodsResponse['data']> {
    const mid = merchantId || this.configMerchantId || '';
    return this.request<SyncProviderAccountMethodsResponse['data']>(
      'POST',
      `/v1/merchants/${encodeURIComponent(mid)}/provider-accounts/${encodeURIComponent(providerAccountId)}/methods/sync`,
    );
  }

  /**
   * getPaymentIntentPaymentOptions — get available payment method options for a specific payment intent.
   *
   * GET /v1/payment-intents/:intentId/payment-options?merchantId=...
   *
   * Required scope: payment_method:read OR intent:read
   *
   * Returns options filtered by intent currency and amount.
   * Use this before calling createGatewayPayment to discover valid methods.
   */
  async getPaymentIntentPaymentOptions(
    intentId: string,
    merchantId?: string,
  ): Promise<PaymentIntentPaymentOptionsResponse['data']> {
    const mid = merchantId || this.configMerchantId || '';
    return this.request<PaymentIntentPaymentOptionsResponse['data']>(
      'GET',
      `/v1/payment-intents/${encodeURIComponent(intentId)}/payment-options${mid ? `?merchantId=${encodeURIComponent(mid)}` : ''}`,
    );
  }

  // ── S9.4: Signing Key Lifecycle ───────────────────────────────────────────────

  /**
   * createSigningKey — create a new HMAC signing key for an API client.
   *
   * POST /v1/api-clients/:clientId/signing-keys
   *
   * Required scope: api_client:signing_key:create
   *
   * Returns rawSigningSecret ONCE — store securely, never log.
   */
  async createSigningKey(
    clientId: string,
    input?: CreateSigningKeyRequest,
  ): Promise<CreateSigningKeyResponse> {
    return this.request<CreateSigningKeyResponse>(
      'POST',
      `/v1/api-clients/${encodeURIComponent(clientId)}/signing-keys`,
      input ?? {},
    );
  }

  /**
   * listSigningKeys — list all signing keys for an API client (safe view, no secrets).
   *
   * GET /v1/api-clients/:clientId/signing-keys
   *
   * Required scope: api_client:signing_key:read
   */
  async listSigningKeys(clientId: string): Promise<ClientSigningKeyResponse[]> {
    return this.request<ClientSigningKeyResponse[]>(
      'GET',
      `/v1/api-clients/${encodeURIComponent(clientId)}/signing-keys`,
    );
  }

  /**
   * rotateSigningKey — create a new signing key and optionally revoke the old one.
   *
   * POST /v1/api-clients/:clientId/signing-keys/rotate
   *
   * Required scope: api_client:signing_key:rotate
   *
   * Returns rawSigningSecret for the new key ONCE — store securely, never log.
   */
  async rotateSigningKey(
    clientId: string,
    input?: RotateSigningKeyRequest,
  ): Promise<RotateSigningKeyResponse> {
    return this.request<RotateSigningKeyResponse>(
      'POST',
      `/v1/api-clients/${encodeURIComponent(clientId)}/signing-keys/rotate`,
      input ?? {},
    );
  }

  /**
   * revokeSigningKey — revoke a signing key immediately.
   *
   * POST /v1/api-clients/:clientId/signing-keys/:signingKeyId/revoke
   *
   * Required scope: api_client:signing_key:revoke
   *
   * Revoked keys are rejected on all subsequent requests immediately.
   */
  async revokeSigningKey(
    clientId: string,
    signingKeyId: string,
  ): Promise<ClientSigningKeyResponse> {
    return this.request<ClientSigningKeyResponse>(
      'POST',
      `/v1/api-clients/${encodeURIComponent(clientId)}/signing-keys/${encodeURIComponent(signingKeyId)}/revoke`,
    );
  }
}
