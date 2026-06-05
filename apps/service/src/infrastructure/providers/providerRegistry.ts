/**
 * providerRegistry — standalone payment provider registry.
 *
 * Phase 8I: registers FakeGateway for safe non-production use and Xendit sandbox only when its runtime policy is explicit.
 *
 * Rules:
 * - FakeGateway is always registered in non-production.
 * - Xendit sandbox is disabled unless explicitly enabled by environment.
 * - Standalone extraction first; source applications integrate only after service/package
 *   boundary, provider runtime, operations, and extraction simulation are stable.
 * - Never change embedded provider registry in packages/infrastructure/payments/.
 */

import type { StandalonePaymentProvider } from './StandalonePaymentProvider.ts';
import { StandaloneFakeGatewayProvider } from './StandaloneFakeGatewayProvider.ts';
import { XenditSandboxProvider } from './XenditSandboxProvider.ts';
import {
  createUnconfiguredXenditHttpClient,
  createXenditSandboxHttpClient,
  loadXenditRuntimeConfig,
} from './xenditHttpClient.ts';

export type ProviderRegistry = Map<string, StandalonePaymentProvider>;

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
  const registry = new Map<string, StandalonePaymentProvider>();

  if (nodeEnv !== 'production') {
    const fakeGateway = new StandaloneFakeGatewayProvider();
    registry.set(fakeGateway.providerCode, fakeGateway);
    console.log(
      `[payment-orchestration-service/providers] Registered provider: ${fakeGateway.providerCode} (dev/test only)`,
    );
  }

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
