/**
 * adminContext — S10: bootstrap context for nf-admin CLI.
 *
 * Loads environment, creates DB connection and repositories.
 *
 * Bootstrap access model:
 *   Local trusted runtime only.
 *   The CLI is intended to be executed by an operator with direct server,
 *   deployment, or CI environment access. It is not an HTTP admin API and it
 *   does not implement dashboard/session authentication.
 *
 * Security invariants:
 *   - CLI output is explicitly redacted by command/output helpers.
 *   - Raw credentials/signing material are returned only by create operations.
 *   - Provider secrets, database URLs, and protected key material are never
 *     included in audit metadata.
 */

import { loadEnv } from '../config/env.ts';
import { createPoDb } from '../infrastructure/db.ts';
import type { PoDb } from '../infrastructure/db.ts';
import { DrizzleApiClientRepository } from '../infrastructure/repositories/DrizzleApiClientRepository.ts';
import { DrizzleClientCredentialRepository } from '../infrastructure/repositories/DrizzleClientCredentialRepository.ts';
import { DrizzleClientMerchantAccessRepository } from '../infrastructure/repositories/DrizzleClientMerchantAccessRepository.ts';
import { DrizzleClientSigningKeyRepository } from '../infrastructure/repositories/DrizzleClientSigningKeyRepository.ts';
import { DrizzlePaymentMerchantRepository } from '../infrastructure/repositories/DrizzlePaymentMerchantRepository.ts';
import { DrizzlePaymentProviderAccountRepository } from '../infrastructure/repositories/DrizzlePaymentProviderAccountRepository.ts';
import { DrizzleProviderAccountMethodRepository } from '../infrastructure/repositories/DrizzleProviderAccountMethodRepository.ts';
import { DrizzleAuditLogRepository } from '../infrastructure/repositories/DrizzleAuditLogRepository.ts';
import { createProviderRegistry } from '../infrastructure/providers/providerRegistry.ts';
import type { ProviderRegistry } from '../infrastructure/providers/providerRegistry.ts';

export interface AdminContext {
  db: PoDb;
  apiClientRepo: DrizzleApiClientRepository;
  credentialRepo: DrizzleClientCredentialRepository;
  accessRepo: DrizzleClientMerchantAccessRepository;
  signingKeyRepo: DrizzleClientSigningKeyRepository;
  merchantRepo: DrizzlePaymentMerchantRepository;
  providerAccountRepo: DrizzlePaymentProviderAccountRepository;
  methodRepo: DrizzleProviderAccountMethodRepository;
  auditRepo: DrizzleAuditLogRepository;
  providerRegistry: ProviderRegistry;
  nodeEnv: string;
}

export function createAdminContext(): AdminContext {
  const config = loadEnv();

  if (!config.dbUrl) {
    console.error(
      '[nf-admin] Error: database is not configured. ' +
        'Set PAYMENT_ORCHESTRATION_DATABASE_URL or DATABASE_URL.',
    );
    process.exit(1);
  }

  const db = createPoDb(config.dbUrl);
  const providerRegistry = createProviderRegistry(config.nodeEnv, {
    xenditSandboxEnabled: config.xenditSandboxEnabled,
    xenditBaseUrl: config.xenditBaseUrl,
  });

  return {
    db,
    apiClientRepo: new DrizzleApiClientRepository(db),
    credentialRepo: new DrizzleClientCredentialRepository(db),
    accessRepo: new DrizzleClientMerchantAccessRepository(db),
    signingKeyRepo: new DrizzleClientSigningKeyRepository(db),
    merchantRepo: new DrizzlePaymentMerchantRepository(db),
    providerAccountRepo: new DrizzlePaymentProviderAccountRepository(db),
    methodRepo: new DrizzleProviderAccountMethodRepository(db),
    auditRepo: new DrizzleAuditLogRepository(db),
    providerRegistry,
    nodeEnv: config.nodeEnv,
  };
}

/**
 * assertAdminRuntimeAccess — intentionally local-only.
 *
 * This is not a token verifier. Sensitive commands are protected by deployment
 * access: the operator must already be able to run commands inside the service
 * environment. Dashboard/API authentication belongs to a future dashboard phase.
 */
export function assertAdminRuntimeAccess(): void {
  return;
}

/**
 * OFFICIAL_SCOPES — complete list of recognized Northflow authorization scopes.
 * Used for validation in grant-merchant and create-client.
 */
export const OFFICIAL_SCOPES: ReadonlySet<string> = new Set([
  'merchant:create',
  'merchant:read',
  'provider_account:create',
  'provider_account:read',
  'intent:create',
  'intent:read',
  'payment:create',
  'payment:read',
  'payment:refund',
  'payment:void',
  'payment:reconcile',
  'provider_event:reprocess',
  'payment_method:read',
  'payment_method:write',
  'payment_method:sync',
  'audit_log:read',
  'api_client:credential:create',
  'api_client:credential:read',
  'api_client:credential:revoke',
  'api_client:credential:rotate',
  'api_client:signing_key:create',
  'api_client:signing_key:read',
  'api_client:signing_key:rotate',
  'api_client:signing_key:revoke',
  '*',
]);

export function validateScopes(scopes: string[]): { valid: boolean; unknown: string[] } {
  const unknown = scopes.filter((s) => !OFFICIAL_SCOPES.has(s));
  return { valid: unknown.length === 0, unknown };
}
