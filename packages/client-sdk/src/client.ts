import {
  hashBody,
  buildCanonicalString,
  computeSignature,
  SIGNATURE_VERSION,
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
    this.signing = config.signing && config.signing.enabled !== false ? config.signing : null;
    this.defaultHeaders = { 'Content-Type': 'application/json' };

    if (config.apiKey) {
      this.defaultHeaders['authorization'] = `Bearer ${config.apiKey}`;
    }
    if (config.merchantId) this.defaultHeaders['x-payment-merchant-id'] = config.merchantId;
    if (config.sourceApp) this.defaultHeaders['x-source-app'] = config.sourceApp;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<T> {
    const questionMark = path.indexOf('?');
    const purePathStr = questionMark >= 0 ? path.slice(0, questionMark) : path;
    const queryStr = questionMark >= 0 ? path.slice(questionMark) : '';
    const headers: Record<string, string> = { ...this.defaultHeaders, ...extraHeaders };

    let bodyBytes: Uint8Array | null = null;
    let bodyString: string | undefined;
    if (body !== undefined) {
      bodyString = JSON.stringify(body);
      bodyBytes = new TextEncoder().encode(bodyString);
    }

    if (this.signing) {
      Object.assign(
        headers,
        await buildSigningHeaders(this.signing, method, purePathStr, queryStr, bodyBytes),
      );
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, { method, headers, body: bodyString });
    } catch (err: unknown) {
      throw new PaymentOrchestrationNetworkError(
        `Network error calling payment-orchestration-service: ${String(err)}`,
        err,
      );
    }

    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const errorObj = data != null && typeof data === 'object' && 'error' in data
        ? (data as Record<string, unknown>)['error']
        : null;

      let code: string | undefined;
      let message: string;
      let details: unknown = null;

      if (errorObj != null && typeof errorObj === 'object') {
        const eo = errorObj as Record<string, unknown>;
        code = typeof eo['code'] === 'string' ? eo['code'] : undefined;
        message = typeof eo['message'] === 'string' ? eo['message'] : `HTTP ${response.status}`;
        details = eo['details'] ?? null;
      } else {
        code = typeof errorObj === 'string' ? errorObj : undefined;
        message = data != null && typeof data === 'object' && 'message' in data
          ? String((data as Record<string, unknown>)['message'])
          : `HTTP ${response.status}`;
      }

      throw new PaymentOrchestrationClientError(message, {
        status: response.status,
        code,
        details,
        responseBody: data,
      });
    }

    const envelope = data as { ok?: unknown; data?: unknown } | null;
    const unwrapped =
      envelope != null &&
      typeof envelope === 'object' &&
      envelope.ok === true &&
      'data' in envelope
        ? envelope.data
        : data;
    return unwrapped as T;
  }

  async createPaymentIntent(input: CreatePaymentIntentRequest): Promise<PaymentIntentResponse> {
    return this.request<PaymentIntentResponse>('POST', '/v1/payment-intents', this.withMerchantId(input));
  }

  async getPaymentIntentStatus(intentId: string, merchantIdOrOpts?: string | { merchantId?: string }): Promise<PaymentIntentStatusResponse> {
    return this.request<PaymentIntentStatusResponse>('GET', `/v1/payment-intents/${encodeURIComponent(intentId)}/status`, undefined, this.merchantHeader(this.resolveMerchantId(merchantIdOrOpts)));
  }

  async getRefundability(intentId: string, merchantIdOrOpts?: string | { merchantId?: string }): Promise<RefundabilityResponse> {
    return this.request<RefundabilityResponse>('GET', `/v1/payment-intents/${encodeURIComponent(intentId)}/refundability`, undefined, this.merchantHeader(this.resolveMerchantId(merchantIdOrOpts)));
  }

  async createGatewayPayment(intentId: string, input: CreateGatewayPaymentRequest): Promise<GatewayPaymentResponse> {
    return this.request<GatewayPaymentResponse>('POST', `/v1/payment-intents/${encodeURIComponent(intentId)}/gateway-payments`, this.withMerchantId(input));
  }

  async refreshProviderStatus(transactionId: string, input?: RefreshProviderStatusRequest): Promise<RefreshProviderStatusResponse> {
    return this.request<RefreshProviderStatusResponse>(
      'POST',
      `/v1/payment-transactions/${encodeURIComponent(transactionId)}/refresh-provider-status`,
      this.withMerchantId(input ?? {}),
    );
  }

  async getPaymentOptions(intentId: string, merchantIdOrOpts?: string | { merchantId?: string }): Promise<PaymentIntentPaymentOptionsResponse> {
    return this.request<PaymentIntentPaymentOptionsResponse>('GET', `/v1/payment-intents/${encodeURIComponent(intentId)}/payment-options`, undefined, this.merchantHeader(this.resolveMerchantId(merchantIdOrOpts)));
  }

  async refundPaymentTransaction(transactionId: string, input: RefundPaymentTransactionRequest): Promise<RefundPaymentTransactionResponse> {
    return this.request<RefundPaymentTransactionResponse>(
      'POST',
      `/v1/payment-transactions/${encodeURIComponent(transactionId)}/refund`,
      this.withMerchantId(input),
    );
  }

  async voidPaymentTransaction(transactionId: string, input: VoidPaymentTransactionRequest): Promise<VoidPaymentTransactionResponse> {
    return this.request<VoidPaymentTransactionResponse>(
      'POST',
      `/v1/payment-transactions/${encodeURIComponent(transactionId)}/void`,
      this.withMerchantId(input),
    );
  }

  async reconcilePaymentIntentTotals(intentId: string, input?: ReconcilePaymentIntentTotalsRequest): Promise<ReconcilePaymentIntentTotalsResponse> {
    return this.request<ReconcilePaymentIntentTotalsResponse>(
      'POST',
      `/v1/payment-intents/${encodeURIComponent(intentId)}/reconcile`,
      this.withMerchantId(input ?? {}),
    );
  }

  async createMerchant(input: CreateMerchantRequest): Promise<MerchantResponse> {
    return this.request<MerchantResponse>('POST', '/v1/merchants', input);
  }

  async getMerchant(merchantId: string, merchantIdHeader?: string): Promise<MerchantResponse> {
    return this.request<MerchantResponse>(
      'GET',
      `/v1/merchants/${encodeURIComponent(merchantId)}`,
      undefined,
      this.merchantHeader(merchantIdHeader),
    );
  }

  async getProviderAccount(merchantId: string, providerAccountId: string, merchantIdHeader?: string): Promise<ProviderAccountResponse> {
    return this.request<ProviderAccountResponse>(
      'GET',
      `/v1/merchants/${encodeURIComponent(merchantId)}/provider-accounts/${encodeURIComponent(providerAccountId)}`,
      undefined,
      this.merchantHeader(merchantIdHeader),
    );
  }

  async createProviderAccount(merchantId: string, input: CreateProviderAccountRequest): Promise<ProviderAccountResponse> {
    return this.request<ProviderAccountResponse>(
      'POST',
      `/v1/merchants/${encodeURIComponent(merchantId)}/provider-accounts`,
      { ...input, merchantId },
    );
  }

  async listProviderAccountMethods(merchantId: string, providerAccountId: string): Promise<ListProviderAccountMethodsResponse> {
    return this.request<ListProviderAccountMethodsResponse>('GET', `/v1/merchants/${encodeURIComponent(merchantId)}/provider-accounts/${encodeURIComponent(providerAccountId)}/methods`, undefined, this.merchantHeader(merchantId));
  }

  async upsertProviderAccountMethod(merchantId: string, providerAccountId: string, input: UpsertProviderAccountMethodRequest): Promise<UpsertProviderAccountMethodResponse> {
    return this.request<UpsertProviderAccountMethodResponse>('PUT', `/v1/merchants/${encodeURIComponent(merchantId)}/provider-accounts/${encodeURIComponent(providerAccountId)}/methods/${encodeURIComponent(input.method)}`, input, this.merchantHeader(merchantId));
  }

  async deleteProviderAccountMethod(merchantId: string, providerAccountId: string, method: string): Promise<{ ok: true }> {
    return this.request<{ ok: true }>('DELETE', `/v1/merchants/${encodeURIComponent(merchantId)}/provider-accounts/${encodeURIComponent(providerAccountId)}/methods/${encodeURIComponent(method)}`, undefined, this.merchantHeader(merchantId));
  }

  async syncProviderAccountMethods(merchantId: string, providerAccountId: string): Promise<SyncProviderAccountMethodsResponse> {
    return this.request<SyncProviderAccountMethodsResponse>('POST', `/v1/merchants/${encodeURIComponent(merchantId)}/provider-accounts/${encodeURIComponent(providerAccountId)}/methods/sync`, undefined, this.merchantHeader(merchantId));
  }

  async createSigningKey(clientId: string, input?: CreateSigningKeyRequest): Promise<CreateSigningKeyResponse> {
    return this.request<CreateSigningKeyResponse>('POST', `/v1/api-clients/${encodeURIComponent(clientId)}/signing-keys`, input ?? {});
  }

  async listSigningKeys(clientId: string): Promise<ListSigningKeysResponse> {
    return this.request<ListSigningKeysResponse>('GET', `/v1/api-clients/${encodeURIComponent(clientId)}/signing-keys`);
  }

  async rotateSigningKey(clientId: string, input: RotateSigningKeyRequest): Promise<RotateSigningKeyResponse> {
    return this.request<RotateSigningKeyResponse>('POST', `/v1/api-clients/${encodeURIComponent(clientId)}/signing-keys/rotate`, input);
  }

  async revokeSigningKey(clientId: string, signingKeyId: string): Promise<ClientSigningKeyResponse> {
    return this.request<ClientSigningKeyResponse>('POST', `/v1/api-clients/${encodeURIComponent(clientId)}/signing-keys/${encodeURIComponent(signingKeyId)}/revoke`);
  }

  async confirmFakeGatewayPayment(input: ConfirmFakeGatewayPaymentRequest): Promise<ConfirmFakeGatewayPaymentResponse> {
    return this.request<ConfirmFakeGatewayPaymentResponse>('POST', '/v1/dev/fake-gateway/confirm', this.withMerchantId(input));
  }

  async getReadiness(): Promise<ReadinessResponse> {
    return this.request<ReadinessResponse>('GET', '/ready');
  }

  private withMerchantId<T extends object>(input: T): T {
    const currentMerchantId = (input as { merchantId?: unknown }).merchantId;
    if (currentMerchantId || !this.configMerchantId) return input;
    return { ...input, merchantId: this.configMerchantId } as T;
  }

  private merchantHeader(merchantId?: string): Record<string, string> | undefined {
    const id = merchantId ?? this.configMerchantId;
    return id ? { 'x-payment-merchant-id': id } : undefined;
  }

  private resolveMerchantId(arg?: string | { merchantId?: string }): string | undefined {
    if (!arg) return undefined;
    if (typeof arg === 'string') return arg;
    return arg.merchantId;
  }
}
