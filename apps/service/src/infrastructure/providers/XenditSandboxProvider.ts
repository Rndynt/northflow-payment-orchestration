/**
 * XenditSandboxProvider — standalone sandbox-only Xendit runtime adapter.
 *
 * This adapter is intentionally isolated from the embedded AuraPoS Xendit provider.
 * It uses an injectable HTTP client and an opaque credentialsRef resolver so tests
 * never call the network and raw provider secrets are never read from DB rows.
 */

import { createHash, timingSafeEqual } from 'crypto';
import type {
  PaymentProviderAccount,
} from '@northflow/payment-orchestration-core';
import type {
  StandaloneCreatePaymentInput,
  StandaloneParsedProviderWebhook,
  StandalonePaymentProvider,
  StandaloneProviderResult,
  StandaloneProviderStatus,
  StandaloneProviderStatusInput,
  StandaloneProviderStatusResult,
  StandaloneProviderWebhookInput,
} from './StandalonePaymentProvider.ts';

export interface XenditHttpRequest {
  method: 'GET' | 'POST';
  url: string;
  headers: Record<string, string>;
  body?: Record<string, unknown>;
}

export interface XenditHttpResponse {
  status: number;
  body: Record<string, unknown>;
}

export type XenditHttpClient = (request: XenditHttpRequest) => Promise<XenditHttpResponse>;
export type CredentialResolver = (credentialsRef: string) => Promise<string | null>;

export interface XenditSandboxProviderOptions {
  httpClient: XenditHttpClient;
  resolveCredential?: CredentialResolver;
  baseUrl?: string;
  nodeEnv?: string;
}

const DEFAULT_BASE_URL = 'https://api.xendit.co';
const CALLBACK_TOKEN_HEADER = 'x-callback-token';

function mustProviderAccount(account: PaymentProviderAccount | null): PaymentProviderAccount {
  if (!account) {
    throw Object.assign(new Error('Xendit sandbox requires a provider account.'), {
      statusCode: 422,
      code: 'PROVIDER_ACCOUNT_REQUIRED',
    });
  }
  if (account.provider !== 'xendit_sandbox') {
    throw Object.assign(new Error(`Provider account is for '${account.provider}', not xendit_sandbox.`), {
      statusCode: 422,
      code: 'PROVIDER_ACCOUNT_PROVIDER_MISMATCH',
    });
  }
  if (account.environment !== 'sandbox' && account.environment !== 'test') {
    throw Object.assign(new Error('xendit_sandbox provider account must be sandbox/test only.'), {
      statusCode: 422,
      code: 'PROVIDER_ACCOUNT_ENVIRONMENT_UNSUPPORTED',
    });
  }
  return account;
}

function readString(input: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === 'string' && value.trim().length > 0) return value;
  }
  return null;
}

function mapXenditStatus(rawStatus: unknown): StandaloneProviderStatus | 'ignored' {
  const status = typeof rawStatus === 'string' ? rawStatus.toUpperCase() : '';
  switch (status) {
    case 'PAID':
    case 'SUCCEEDED':
    case 'SETTLED':
      return 'succeeded';
    case 'FAILED':
      return 'failed';
    case 'EXPIRED':
      return 'expired';
    case 'CANCELLED':
    case 'VOIDED':
      return 'cancelled';
    case 'PENDING':
      return 'requires_action';
    default:
      return 'ignored';
  }
}

function stableBody(rawBody: Buffer | Record<string, unknown>): Record<string, unknown> {
  if (!Buffer.isBuffer(rawBody)) return rawBody;
  try {
    const parsed = JSON.parse(rawBody.toString('utf8')) as unknown;
    return parsed != null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    throw Object.assign(new Error('Xendit webhook body is not valid JSON.'), {
      statusCode: 400,
      code: 'WEBHOOK_BODY_INVALID',
    });
  }
}

export class XenditSandboxProvider implements StandalonePaymentProvider {
  public readonly providerCode = 'xendit_sandbox';
  public readonly capabilities = {
    supportsRefund: false,
    supportsCancel: false,
    supportsPolling: true,
    supportsWebhook: true,
    supportedMethods: ['invoice', 'qris', 'ewallet', 'bank_transfer'],
    supportsRedirect: true,
    supportsQr: false,
    supportsVa: false,
    supportsPaymentCode: false,
    supportsPartialRefund: false,
    supportsMultiplePartialRefund: false,
    canReturnImmediateSuccess: false,
    canReturnImmediateFailure: true,
  };

  private readonly httpClient: XenditHttpClient;
  private readonly resolveCredential: CredentialResolver;
  private readonly baseUrl: string;
  private readonly nodeEnv: string;

  constructor(options: XenditSandboxProviderOptions) {
    this.httpClient = options.httpClient;
    this.resolveCredential = options.resolveCredential ?? (async (ref) => process.env[ref] ?? null);
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.nodeEnv = options.nodeEnv ?? process.env.NODE_ENV ?? 'development';
  }

  async createPayment(input: StandaloneCreatePaymentInput): Promise<StandaloneProviderResult> {
    const account = mustProviderAccount(input.providerAccount);
    const apiKey = account.credentialsRef ? await this.resolveCredential(account.credentialsRef) : null;
    if (!apiKey) {
      throw Object.assign(new Error('Xendit sandbox credentialsRef could not be resolved.'), {
        statusCode: 422,
        code: 'PROVIDER_CREDENTIALS_UNAVAILABLE',
      });
    }

    if (this.nodeEnv === 'production' && account.environment !== 'sandbox') {
      throw Object.assign(new Error('xendit_sandbox cannot run a production provider account.'), {
        statusCode: 422,
        code: 'PROVIDER_ENVIRONMENT_UNSUPPORTED',
      });
    }

    const publicConfig = account.publicConfig ?? {};
    const externalSeed = `${input.intentId}:${input.amount}:${input.currency}:${input.method}`;
    const externalId = `po_${input.intentId}_${createHash('sha256').update(externalSeed).digest('hex').slice(0, 16)}`;
    const requestBody = {
      external_id: externalId,
      amount: input.amount,
      currency: input.currency,
      description: typeof input.metadata?.['description'] === 'string'
        ? input.metadata['description']
        : `Payment intent ${input.intentId}`,
      success_redirect_url: readString(publicConfig, 'successRedirectUrl'),
      failure_redirect_url: readString(publicConfig, 'failureRedirectUrl'),
    };

    const response = await this.httpClient({
      method: 'POST',
      url: `${this.baseUrl.replace(/\/$/, '')}/v2/invoices`,
      headers: {
        authorization: `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`,
        'content-type': 'application/json',
      },
      body: requestBody,
    });

    if (response.status < 200 || response.status >= 300) {
      return {
        status: 'failed',
        providerReference: externalId,
        providerPaymentUrl: null,
        providerQrString: null,
        rawProviderResponse: sanitizeXenditResponse(response.body),
        failureReason: readString(response.body, 'message', 'error_code') ?? `XENDIT_HTTP_${response.status}`,
        expiresAt: null,
      };
    }

    const providerReference = readString(response.body, 'id') ?? externalId;
    const invoiceUrl = readString(response.body, 'invoice_url');
    const expiresAtRaw = readString(response.body, 'expiry_date', 'expires_at');

    return {
      status: mapXenditStatus(response.body['status']) === 'failed' ? 'failed' : 'requires_action',
      providerReference,
      providerPaymentUrl: invoiceUrl,
      providerQrString: null,
      rawProviderResponse: sanitizeXenditResponse({
        ...response.body,
        external_id: externalId,
      }),
      failureReason: null,
      expiresAt: expiresAtRaw ? new Date(expiresAtRaw) : null,
    };
  }

  parseWebhook(input: StandaloneProviderWebhookInput): StandaloneParsedProviderWebhook {
    const callbackToken = getHeader(input.headers, CALLBACK_TOKEN_HEADER);
    const expectedToken = process.env['PAYMENT_ORCHESTRATION_XENDIT_CALLBACK_TOKEN']?.trim() ?? '';
    const allowUnsignedDev = this.nodeEnv !== 'production' && process.env['PAYMENT_ORCHESTRATION_XENDIT_ALLOW_UNSIGNED_DEV_WEBHOOKS'] === 'true';
    if (!callbackToken) {
      throw Object.assign(new Error('Xendit webhook callback token missing.'), {
        statusCode: 401,
        code: 'WEBHOOK_SIGNATURE_MISSING',
      });
    }
    if (!expectedToken) {
      if (!allowUnsignedDev) {
        throw Object.assign(new Error('Xendit webhook callback token secret is required.'), {
          statusCode: 503,
          code: 'WEBHOOK_SECRET_REQUIRED',
        });
      }
    } else if (!safeEqual(callbackToken, expectedToken)) {
      throw Object.assign(new Error('Xendit webhook callback token verification failed.'), {
        statusCode: 401,
        code: 'WEBHOOK_SIGNATURE_INVALID',
      });
    }

    const body = stableBody(input.rawBody);
    const providerEventId = readString(body, 'id', 'event_id')
      ?? `${readString(body, 'external_id') ?? 'xendit'}:${readString(body, 'status') ?? 'unknown'}`;
    const providerReference = readString(body, 'id', 'invoice_id') ?? readString(body, 'external_id');
    const eventType = readString(body, 'event', 'event_type') ?? 'invoice.status';

    return {
      providerEventId,
      providerReference,
      eventType,
      status: mapXenditStatus(body['status']),
      rawPayload: sanitizeXenditResponse(body),
    };
  }

  async getPaymentStatus(input: StandaloneProviderStatusInput): Promise<StandaloneProviderStatusResult> {
    const account = mustProviderAccount(input.providerAccount);
    const apiKey = account.credentialsRef ? await this.resolveCredential(account.credentialsRef) : null;
    if (!apiKey) {
      throw Object.assign(new Error('Xendit sandbox credentialsRef could not be resolved.'), {
        statusCode: 422,
        code: 'PROVIDER_CREDENTIALS_UNAVAILABLE',
      });
    }
    if (!input.providerReference) {
      return {
        status: 'ignored',
        providerReference: null,
        rawProviderResponse: { reason: 'provider_reference_missing' },
        failureReason: null,
      };
    }

    const response = await this.httpClient({
      method: 'GET',
      url: `${this.baseUrl.replace(/\/$/, '')}/v2/invoices/${encodeURIComponent(input.providerReference)}`,
      headers: {
        authorization: `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`,
        accept: 'application/json',
      },
    });

    const status = response.status >= 200 && response.status < 300
      ? mapXenditStatus(response.body['status'])
      : 'failed';

    return {
      status,
      providerReference: input.providerReference,
      rawProviderResponse: sanitizeXenditResponse(response.body),
      failureReason: status === 'failed'
        ? readString(response.body, 'message', 'error_code') ?? `XENDIT_HTTP_${response.status}`
        : null,
    };
  }
}

function getHeader(headers: Record<string, string | string[] | undefined>, name: string): string | null {
  const val = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(val)) return val[0] ?? null;
  return typeof val === 'string' ? val : null;
}

function sanitizeXenditResponse(input: Record<string, unknown>): Record<string, unknown> {
  const clone: Record<string, unknown> = { ...input };
  for (const key of Object.keys(clone)) {
    if (/secret|token|api[_-]?key|authorization/i.test(key)) {
      clone[key] = '[redacted]';
    }
  }
  return clone;
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
