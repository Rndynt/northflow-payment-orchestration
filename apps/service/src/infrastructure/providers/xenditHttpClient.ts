/**
 * xenditHttpClient — explicit standalone Xendit sandbox runtime HTTP policy.
 *
 * Xendit sandbox network access is disabled unless
 * PAYMENT_ORCHESTRATION_XENDIT_SANDBOX_ENABLED=true. The HTTP client uses native
 * fetch when enabled and returns a stable PROVIDER_HTTP_CLIENT_UNCONFIGURED error
 * otherwise. Credentials remain env-var-name references resolved by the provider;
 * this module never persists or returns raw secrets.
 */

import type { XenditHttpClient, XenditHttpRequest } from './XenditSandboxProvider.ts';

export interface XenditRuntimeConfig {
  enabled: boolean;
  baseUrl: string | null;
  callbackTokenConfigured: boolean;
  configured: boolean;
}

export interface XenditRuntimeOptions {
  enabled?: boolean;
  baseUrl?: string | null;
  callbackToken?: string | null;
  fetchImpl?: typeof fetch;
}

export const DEFAULT_XENDIT_BASE_URL = 'https://api.xendit.co';

export function loadXenditRuntimeConfig(env: NodeJS.ProcessEnv = process.env): XenditRuntimeConfig {
  const enabled = env['PAYMENT_ORCHESTRATION_XENDIT_SANDBOX_ENABLED'] === 'true';
  const baseUrl = (env['PAYMENT_ORCHESTRATION_XENDIT_BASE_URL'] ?? DEFAULT_XENDIT_BASE_URL).trim();
  const callbackTokenConfigured = Boolean(env['PAYMENT_ORCHESTRATION_XENDIT_CALLBACK_TOKEN']?.trim());
  return {
    enabled,
    baseUrl,
    callbackTokenConfigured,
    configured: enabled && baseUrl.length > 0,
  };
}

export function createUnconfiguredXenditHttpClient(): XenditHttpClient {
  return async () => {
    throw Object.assign(
      new Error('Xendit sandbox HTTP client is not configured for this runtime.'),
      { statusCode: 503, code: 'PROVIDER_HTTP_CLIENT_UNCONFIGURED' },
    );
  };
}

export function createXenditSandboxHttpClient(options: XenditRuntimeOptions = {}): XenditHttpClient {
  const config = loadXenditRuntimeConfig();
  const enabled = options.enabled ?? config.enabled;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  if (!enabled || typeof fetchImpl !== 'function') {
    return createUnconfiguredXenditHttpClient();
  }

  return async (request: XenditHttpRequest) => {
    const response = await fetchImpl(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body ? JSON.stringify(request.body) : undefined,
    });
    const text = await response.text();
    let body: Record<string, unknown> = {};
    if (text.trim()) {
      const parsed = JSON.parse(text) as unknown;
      body = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : { value: parsed };
    }
    return { status: response.status, body };
  };
}
