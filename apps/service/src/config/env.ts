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
  const phase = '8K';
  const xenditSandboxEnabled = process.env['PAYMENT_ORCHESTRATION_XENDIT_SANDBOX_ENABLED'] === 'true';
  const xenditBaseUrl = (process.env['PAYMENT_ORCHESTRATION_XENDIT_BASE_URL'] ?? 'https://api.xendit.co').trim();
  const xenditCallbackTokenConfigured = Boolean(process.env['PAYMENT_ORCHESTRATION_XENDIT_CALLBACK_TOKEN']?.trim());

  // S2: Legacy shared service token compatibility.
  // Production default: disabled. Development default: enabled (backward-compat with dashboard).
  const legacyServiceTokenEnabled = nodeEnv === 'production'
    ? process.env['PAYMENT_ORCHESTRATION_LEGACY_SERVICE_TOKEN_ENABLED'] === 'true'
    : (process.env['PAYMENT_ORCHESTRATION_LEGACY_SERVICE_TOKEN_ENABLED'] ?? 'true') !== 'false';

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
  };
}
