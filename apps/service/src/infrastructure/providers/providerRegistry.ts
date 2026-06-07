/**
 * providerRegistry — standalone payment provider registry.
 *
 * Phase 8I: registers FakeGateway for safe non-production use and Xendit sandbox only when its runtime policy is explicit.
 * Phase 8F: added ManualProvider (always registered — handles cash/offline payments in all environments).
 *
 * Rules:
 * - ManualProvider is always registered in all environments.
 * - FakeGateway is always registered in non-production.
 * - Xendit sandbox is disabled unless explicitly enabled by environment.
 * - Source applications integrate only after service/package
 *   boundary, provider runtime, operations, and extraction simulation are stable.
 * - Never change embedded provider registry in packages/infrastructure/payments/.
 */

import type { PaymentProviderAdapter } from './PaymentProviderAdapter.ts';
import { FakeGatewayProvider } from './FakeGatewayProvider.ts';
import { ManualProvider } from './ManualProvider.ts';
import { XenditSandboxProvider } from './XenditSandboxProvider.ts';
import {
  createUnconfiguredXenditHttpClient,
  createXenditSandboxHttpClient,
  loadXenditRuntimeConfig,
} from './xenditHttpClient.ts';

export type ProviderRegistry = Map<string, PaymentProviderAdapter>;

export interface ProviderRuntimeReadiness {
  registered: boolean;
  configured?: boolean;
  enabled?: boolean;
}

export interface ProviderRegistryRuntimeOptions {
  xenditSandboxEnabled?: boolean;
  xenditBaseUrl?: string | null;
}

export function createProviderRegistry(
  nodeEnv: string,
  options: ProviderRegistryRuntimeOptions = {},
): ProviderRegistry {
  const registry = new Map<string, PaymentProviderAdapter>();

  // ── Manual provider: always registered (cash/offline payments in all envs) ──
  const manual = new ManualProvider();
  registry.set(manual.providerCode, manual);
  console.log(
    `[payment-orchestration-service/providers] Registered provider: ${manual.providerCode} (all environments)`,
  );

  // ── FakeGateway: dev/test only ────────────────────────────────────────────
  if (nodeEnv !== 'production') {
    const fakeGateway = new FakeGatewayProvider();
    registry.set(fakeGateway.providerCode, fakeGateway);
    console.log(
      `[payment-orchestration-service/providers] Registered provider: ${fakeGateway.providerCode} (dev/test only)`,
    );
  }

  // ── Xendit sandbox: enabled by explicit env config ────────────────────────
  const xenditConfig = loadXenditRuntimeConfig();
  const xenditEnabled = options.xenditSandboxEnabled ?? xenditConfig.enabled;
  const xenditHttpClient = xenditEnabled
    ? createXenditSandboxHttpClient({ enabled: true })
    : createUnconfiguredXenditHttpClient();
  const xenditSandbox = new XenditSandboxProvider({
    nodeEnv,
    httpClient: xenditHttpClient,
    baseUrl: options.xenditBaseUrl ?? xenditConfig.baseUrl ?? undefined,
  });
  registry.set(xenditSandbox.providerCode, xenditSandbox);
  console.log(
    `[payment-orchestration-service/providers] Registered provider: ${xenditSandbox.providerCode} (${xenditEnabled ? 'enabled by env' : 'http disabled until env enabled'})`,
  );

  return registry;
}

export function getProviderRuntimeReadiness(
  registry: ProviderRegistry,
  options: ProviderRegistryRuntimeOptions = {},
): Record<string, ProviderRuntimeReadiness> {
  const xenditConfig = loadXenditRuntimeConfig();
  const xenditEnabled = options.xenditSandboxEnabled ?? xenditConfig.enabled;

  return {
    manual: {
      registered: registry.has('manual'),
      configured: true,
      enabled: true,
    },
    fake_gateway: {
      registered: registry.has('fake_gateway'),
      configured: registry.has('fake_gateway'),
      enabled: registry.has('fake_gateway'),
    },
    xendit_sandbox: {
      registered: registry.has('xendit_sandbox'),
      configured: Boolean(xenditEnabled),
      enabled: Boolean(xenditEnabled),
    },
  };
}
