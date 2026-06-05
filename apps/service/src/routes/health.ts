/**
 * health — /health, /version, and /ready endpoints for payment-orchestration-service.
 *
 * No authentication required on health checks.
 * Returns minimal operational metadata — no secrets, no internal paths, no raw env values.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import type { PaymentOrchestrationServiceConfig } from '../config/env.ts';
import type { ProviderRegistry } from '../infrastructure/providers/providerRegistry.ts';
import { getProviderRuntimeReadiness } from '../infrastructure/providers/providerRegistry.ts';

export function createHealthRouter(
  config: PaymentOrchestrationServiceConfig,
  providerRegistry?: ProviderRegistry,
): Router {
  const router = Router();

  /**
   * GET /health
   * Returns 200 { ok: true, service: 'payment-orchestration-service' } when service is up.
   * Used by load balancers and health-check probes.
   */
  router.get('/health', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      service: 'payment-orchestration-service',
    });
  });

  /**
   * GET /ready
   * Returns non-secret runtime readiness for DB configuration and provider registration.
   */
  router.get('/ready', (_req: Request, res: Response) => {
    const providers = providerRegistry
      ? getProviderRuntimeReadiness(providerRegistry, {
          xenditSandboxEnabled: config.xenditSandboxEnabled,
          xenditBaseUrl: config.xenditBaseUrl,
        })
      : {};

    res.json({
      ok: Boolean(config.dbUrl),
      service: 'payment-orchestration-service',
      providers,
      database: config.dbUrl ? 'configured' : 'unconfigured',
      xenditSandbox: {
        enabled: Boolean(config.xenditSandboxEnabled),
        callbackTokenConfigured: Boolean(config.xenditCallbackTokenConfigured),
      },
    });
  });

  /**
   * GET /version
   * Returns service metadata for debugging and deployment verification.
   */
  router.get('/version', (_req: Request, res: Response) => {
    res.json({
      service: 'payment-orchestration-service',
      version: config.version,
      phase: config.phase,
      description: 'Payment Orchestration Standalone Service — hybrid extraction scaffold',
      status: 'runtime-readiness-foundation',
    });
  });

  return router;
}
