/**
 * health — /health, /version, and /ready endpoints for payment-orchestration-service.
 *
 * No authentication required on health checks.
 * Returns minimal operational metadata — no secrets, no internal paths, no raw env values.
 *
 * Phase S9.3: /ready supports optional token protection via PAYMENT_ORCHESTRATION_READY_TOKEN.
 *   If readyToken is configured, requests must supply x-nf-ready-token: <token>.
 *   If unset, /ready remains public (rely on reverse proxy / origin firewall for restriction).
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
   * Used by load balancers and health-check probes. Always public.
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
   *
   * If PAYMENT_ORCHESTRATION_READY_TOKEN is set, the request must supply:
   *   x-nf-ready-token: <token>
   * If the token is absent or wrong, returns 401 (no token details in the response).
   * If unset, the endpoint is public — protect it via reverse proxy / origin firewall instead.
   *
   * Security: dbUrl, serviceToken, readyToken, and provider secrets are NEVER returned.
   */
  router.get('/ready', (req: Request, res: Response) => {
    // B7: Token-protected mode
    if (config.readyToken) {
      const supplied = req.headers['x-nf-ready-token'];
      if (!supplied || supplied !== config.readyToken) {
        res.status(401).json({
          ok: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'x-nf-ready-token header is required to access this endpoint.',
            details: null,
          },
        });
        return;
      }
    }

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
   * Never exposes secrets, tokens, or environment internals.
   */
  router.get('/version', (_req: Request, res: Response) => {
    res.json({
      service: 'payment-orchestration-service',
      version: config.version,
      phase: config.phase,
      description: 'Payment Orchestration Service — hybrid extraction scaffold',
      status: 'runtime-readiness-foundation',
    });
  });

  return router;
}
