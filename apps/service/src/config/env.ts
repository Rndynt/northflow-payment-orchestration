/**
 * env — Payment Orchestration Service configuration loader.
 *
 * Reads only from environment variables. No hard-coded defaults for secrets.
 * No AuraPoS tenant/session dependencies.
 *
 * Port resolution order:
 *   PAYMENT_ORCHESTRATION_SERVICE_PORT → PAYMENT_ENGINE_SERVICE_PORT (alias) → PORT → 5100 (default)
 *   (Intentionally avoids 5000 which is reserved for apps/api)
 *
 * Token resolution order (prefer new name, keep legacy alias for backwards compat):
 *   PAYMENT_ORCHESTRATION_SERVICE_TOKEN → PAYMENT_ENGINE_SERVICE_TOKEN (alias)
 *
 * DB URL resolution order:
 *   PAYMENT_ORCHESTRATION_DATABASE_URL → DATABASE_URL
 *
 * Xendit sandbox runtime policy:
 *   PAYMENT_ORCHESTRATION_XENDIT_SANDBOX_ENABLED must be 'true' to allow HTTP.
 *   PAYMENT_ORCHESTRATION_XENDIT_BASE_URL defaults to https://api.xendit.co.
 *   PAYMENT_ORCHESTRATION_XENDIT_CALLBACK_TOKEN is reported only as configured/unconfigured.
 *
 * Phase 8K: version bumped to 0.3.0, phase updated to '8K'.
 * Phase S9.2: rate limit configuration added.
 * Phase S9.3: network-level service protection — CORS, trusted proxy, body limit, ready token.
 */

export interface PaymentOrchestrationServiceConfig {
  port: number;
  nodeEnv: string;
  serviceToken: string;
  dbUrl: string;
  version: string;
  phase: string;
  xenditSandboxEnabled?: boolean;
  xenditBaseUrl?: string;
  xenditCallbackTokenConfigured?: boolean;
  legacyServiceTokenEnabled: boolean;
  // S9.2: Rate limit configuration
  rateLimitEnabled: boolean;
  rateLimitClientGlobalPerMinute: number;
  rateLimitClientRoutePerMinute: number;
  rateLimitAuthFailurePerMinute: number;
  // S9.3: Network-level service protection (optional — safe defaults for test containers)
  corsEnabled?: boolean;
  corsAllowedOrigins?: string[];
  trustProxy?: boolean | string;
  jsonBodyLimit?: string;
  readyToken?: string; // NEVER logged, NEVER returned in any response
}

export function loadEnv(): PaymentOrchestrationServiceConfig {
  const port = parseInt(
    process.env['PAYMENT_ORCHESTRATION_SERVICE_PORT'] ??
      process.env['PAYMENT_ENGINE_SERVICE_PORT'] ??
      process.env['PORT'] ??
      '5100',
    10,
  );
  const nodeEnv = process.env['NODE_ENV'] ?? 'development';
  const serviceToken =
    process.env['PAYMENT_ORCHESTRATION_SERVICE_TOKEN'] ??
    process.env['PAYMENT_ENGINE_SERVICE_TOKEN'] ??
    '';
  const dbUrl = (
    process.env['PAYMENT_ORCHESTRATION_DATABASE_URL'] ??
    process.env['DATABASE_URL'] ??
    ''
  ).trim();
  const version = '0.3.0';
  const phase = 'S9';
  const xenditSandboxEnabled = process.env['PAYMENT_ORCHESTRATION_XENDIT_SANDBOX_ENABLED'] === 'true';
  const xenditBaseUrl = (process.env['PAYMENT_ORCHESTRATION_XENDIT_BASE_URL'] ?? 'https://api.xendit.co').trim();
  const xenditCallbackTokenConfigured = Boolean(process.env['PAYMENT_ORCHESTRATION_XENDIT_CALLBACK_TOKEN']?.trim());

  // S2: Legacy shared service token compatibility.
  // Production default: disabled. Development default: enabled (backward-compat with dashboard).
  const legacyServiceTokenEnabled = nodeEnv === 'production'
    ? process.env['PAYMENT_ORCHESTRATION_LEGACY_SERVICE_TOKEN_ENABLED'] === 'true'
    : (process.env['PAYMENT_ORCHESTRATION_LEGACY_SERVICE_TOKEN_ENABLED'] ?? 'true') !== 'false';

  // S9.2: Rate limit configuration.
  // Enabled by default in all environments. Disable explicitly for tests/dev if needed.
  const rateLimitEnabled = process.env['PAYMENT_ORCHESTRATION_RATE_LIMIT_ENABLED'] !== 'false';
  const rateLimitClientGlobalPerMinute = parseInt(
    process.env['PAYMENT_ORCHESTRATION_RATE_LIMIT_CLIENT_GLOBAL_PER_MINUTE'] ?? '600',
    10,
  );
  const rateLimitClientRoutePerMinute = parseInt(
    process.env['PAYMENT_ORCHESTRATION_RATE_LIMIT_CLIENT_ROUTE_PER_MINUTE'] ?? '120',
    10,
  );
  const rateLimitAuthFailurePerMinute = parseInt(
    process.env['PAYMENT_ORCHESTRATION_RATE_LIMIT_AUTH_FAILURE_PER_MINUTE'] ?? '30',
    10,
  );

  // S9.3: CORS — disabled by default. Production must not use wildcard origins.
  const corsEnabled = process.env['PAYMENT_ORCHESTRATION_CORS_ENABLED'] === 'true';
  const corsAllowedOrigins = (process.env['PAYMENT_ORCHESTRATION_CORS_ALLOWED_ORIGINS'] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  // S9.3: Trusted proxy — disabled by default. Enable behind Cloudflare/Nginx origin firewall only.
  const trustProxyRaw = (process.env['PAYMENT_ORCHESTRATION_TRUST_PROXY'] ?? 'false').trim();
  const trustProxy: boolean | string =
    trustProxyRaw === 'true' ? true : trustProxyRaw === 'false' ? false : trustProxyRaw;

  // S9.3: JSON body size limit.
  const jsonBodyLimit = (process.env['PAYMENT_ORCHESTRATION_JSON_BODY_LIMIT'] ?? '256kb').trim();

  // S9.3: Ready endpoint token. If set, /ready requires x-nf-ready-token header.
  // This value is NEVER logged and NEVER returned in any API response.
  const readyToken = (process.env['PAYMENT_ORCHESTRATION_READY_TOKEN'] ?? '').trim();

  return {
    port,
    nodeEnv,
    serviceToken,
    dbUrl,
    version,
    phase,
    xenditSandboxEnabled,
    xenditBaseUrl,
    xenditCallbackTokenConfigured,
    legacyServiceTokenEnabled,
    rateLimitEnabled,
    rateLimitClientGlobalPerMinute,
    rateLimitClientRoutePerMinute,
    rateLimitAuthFailurePerMinute,
    corsEnabled,
    corsAllowedOrigins,
    trustProxy,
    jsonBodyLimit,
    readyToken,
  };
}
