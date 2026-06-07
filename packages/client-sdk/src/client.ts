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
  const bodyHash = hashBody(bodyBytes);
  const canonicalStr = buildCanonicalString({
    timestampMs,
    nonce,
    method,
    path,
    query: queryStr,
    bodyHash,
  });
  const signature = computeSignature(signing.secret, canonicalStr);

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
        const eo = errorObj as Record<string, unknown>;
        code = typeof eo['code'] === 'string' ? eo['code'] : undefined;
        message = typeof eo['message'] === 'string'
          ? eo['message'] as string
          : `HTTP ${response.status}`;
        details = eo['details'] ?? null;
      } else {
        code = typeof errorObj === 'string' ? errorObj : undefined;
        message = data != null && typeof data === 'object' && 'message' in data
          ? String((data as any).message)
          : `HTTP ${response.status}`;
      }

      throw new PaymentOrchestrationClientError(message, {
        status: response.status,
        code,
        details,
        responseBody: data,
      });
    }

    return data as T;
  }

  // ── Payment Intent ──────────────────────────────────────────────────────────

  async createPaymentIntent(input: CreatePaymentIntentRequest): Promise<PaymentIntentResponse> {
    return this.request<PaymentIntentResponse>('POST', '/v1/payment-intents', this.withMerchantId(input));
  }

  async getPaymentIntentStatus(intentId: string, merchantId?: string): Promise<PaymentIntentStatusResponse> {
    return this.request<PaymentIntentStatusResponse>('GET', `/v1/payment-intents/${encodeURIComponent(intentId)}/status`, undefined, this.merchantHeader(merchantId));
  }

  async getRefundability(intentId: string, merchantId?: string): Promise<RefundabilityResponse> {
    return this.request<RefundabilityResponse>('GET', `/v1/payment-intents/${encodeURIComponent(intentId)}/refundability`, undefined, this.merchantHeader(merchantId));
  }

  async createGatewayPayment(intentId: string, input: CreateGatewayPaymentRequest): Promise<GatewayPaymentResponse> {
    return this.request<GatewayPaymentResponse>('POST', `/v1/payment-intents/${encodeURIComponent(intentId)}/gateway-payments`, this.withMerchantId(input));
  }

  async refreshProviderStatus(intentId: string, transactionId: string, input: RefreshProviderStatusRequest): Promise<RefreshProviderStatusResponse> {
    return this.request<RefreshProviderStatusResponse>('POST', `/v1/payment-intents/${encodeURIComponent(intentId)}/transactions/${encodeURIComponent(transactionId)}/refresh-status`, this.withMerchantId(input));
  }

  async getPaymentOptions(intentId: string, merchantId?: string): Promise<PaymentIntentPaymentOptionsResponse> {
    return this.request<PaymentIntentPaymentOptionsResponse>('GET', `/v1/payment-intents/${encodeURIComponent(intentId)}/payment-options`, undefined, this.merchantHeader(merchantId));
  }

  // ── Payment Operations ──────────────────────────────────────────────────────

  async refundTransaction(intentId: string, transactionId: string, input: RefundPaymentTransactionRequest): Promise<RefundPaymentTransactionResponse> {
    return this.request<RefundPaymentTransactionResponse>('POST', `/v1/payment-intents/${encodeURIComponent(intentId)}/transactions/${encodeURIComponent(transactionId)}/refund`, this.withMerchantId(input));
  }

  async voidTransaction(intentId: string, transactionId: string, input: VoidPaymentTransactionRequest): Promise<VoidPaymentTransactionResponse> {
    return this.request<VoidPaymentTransactionResponse>('POST', `/v1/payment-intents/${encodeURIComponent(intentId)}/transactions/${encodeURIComponent(transactionId)}/void`, this.withMerchantId(input));
  }

  async reconcilePaymentIntentTotals(intentId: string, input: ReconcilePaymentIntentTotalsRequest): Promise<ReconcilePaymentIntentTotalsResponse> {
    return this.request<ReconcilePaymentIntentTotalsResponse>('POST', `/v1/payment-intents/${encodeURIComponent(intentId)}/reconcile-totals`, this.withMerchantId(input));
  }

  // ── Merchant / Provider Admin ───────────────────────────────────────────────

  async createMerchant(input: CreateMerchantRequest): Promise<MerchantResponse> {
    return this.request<MerchantResponse>('POST', '/v1/merchants', input);
  }

  async createProviderAccount(input: CreateProviderAccountRequest): Promise<ProviderAccountResponse> {
    return this.request<ProviderAccountResponse>('POST', '/v1/provider-accounts', this.withMerchantId(input));
  }

  async listProviderAccountMethods(providerAccountId: string, merchantId?: string): Promise<ListProviderAccountMethodsResponse> {
    return this.request<ListProviderAccountMethodsResponse>('GET', `/v1/provider-accounts/${encodeURIComponent(providerAccountId)}/methods`, undefined, this.merchantHeader(merchantId));
  }

  async upsertProviderAccountMethod(providerAccountId: string, input: UpsertProviderAccountMethodRequest): Promise<UpsertProviderAccountMethodResponse> {
    return this.request<UpsertProviderAccountMethodResponse>('PUT', `/v1/provider-accounts/${encodeURIComponent(providerAccountId)}/methods/${encodeURIComponent(input.method)}`, this.withMerchantId(input));
  }

  async deleteProviderAccountMethod(providerAccountId: string, method: string, merchantId?: string): Promise<{ ok: true }> {
    return this.request<{ ok: true }>('DELETE', `/v1/provider-accounts/${encodeURIComponent(providerAccountId)}/methods/${encodeURIComponent(method)}`, undefined, this.merchantHeader(merchantId));
  }

  async syncProviderAccountMethods(providerAccountId: string, merchantId?: string): Promise<SyncProviderAccountMethodsResponse> {
    return this.request<SyncProviderAccountMethodsResponse>('POST', `/v1/provider-accounts/${encodeURIComponent(providerAccountId)}/methods/sync`, undefined, this.merchantHeader(merchantId));
  }

  // ── Signing Key Admin ───────────────────────────────────────────────────────

  async createSigningKey(input: CreateSigningKeyRequest): Promise<CreateSigningKeyResponse> {
    return this.request<CreateSigningKeyResponse>('POST', '/v1/signing-keys', input);
  }

  async listSigningKeys(clientId: string): Promise<ListSigningKeysResponse> {
    return this.request<ListSigningKeysResponse>('GET', `/v1/signing-keys?clientId=${encodeURIComponent(clientId)}`);
  }

  async rotateSigningKey(keyId: string, input: RotateSigningKeyRequest): Promise<RotateSigningKeyResponse> {
    return this.request<RotateSigningKeyResponse>('POST', `/v1/signing-keys/${encodeURIComponent(keyId)}/rotate`, input);
  }

  async revokeSigningKey(keyId: string): Promise<ClientSigningKeyResponse> {
    return this.request<ClientSigningKeyResponse>('POST', `/v1/signing-keys/${encodeURIComponent(keyId)}/revoke`);
  }

  // ── Dev/Test ────────────────────────────────────────────────────────────────

  async confirmFakeGatewayPayment(input: ConfirmFakeGatewayPaymentRequest): Promise<ConfirmFakeGatewayPaymentResponse> {
    return this.request<ConfirmFakeGatewayPaymentResponse>('POST', '/v1/dev/fake-gateway/confirm', this.withMerchantId(input));
  }

  async getReadiness(): Promise<ReadinessResponse> {
    return this.request<ReadinessResponse>('GET', '/ready');
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private withMerchantId<T extends Record<string, unknown>>(input: T): T {
    if (input['merchantId'] || !this.configMerchantId) return input;
    return { ...input, merchantId: this.configMerchantId };
  }

  private merchantHeader(merchantId?: string): Record<string, string> | undefined {
    const id = merchantId ?? this.configMerchantId;
    return id ? { 'x-payment-merchant-id': id } : undefined;
  }
}

/** @deprecated Use PaymentOrchestrationClient instead. */
export const PaymentEngineClient = PaymentOrchestrationClient;
