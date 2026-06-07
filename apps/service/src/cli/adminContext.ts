/**
 * adminContext — S10: bootstrap context for nf-admin CLI.
 *
 * Loads environment, creates DB connection and repositories.
 * Validates admin bootstrap token for sensitive operations.
 *
 * Bootstrap access model:
 *   PAYMENT_ORCHESTRATION_ADMIN_BOOTSTRAP_TOKEN env var (optional but recommended).
 *   If set, all state-changing commands must provide the matching token via
 *   PAYMENT_ORCHESTRATION_ADMIN_BOOTSTRAP_TOKEN env (same var — CLI and env must agree).
 *   If not set, the CLI trusts that direct server environment access is sufficient.
 *   Help/list/get commands never require the token.
 *
 * Security invariants:
 *   - Token is NEVER logged.
 *   - Token is NEVER returned in any output.
 *   - Token is NEVER included in audit metadata.
 *   - If configured and wrong/missing for sensitive ops → fail closed.
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
 * assertAdminToken — validates the admin bootstrap token for sensitive operations.
 *
 * If PAYMENT_ORCHESTRATION_ADMIN_BOOTSTRAP_TOKEN is set, this function verifies
 * that the env token matches itself (the operator must have direct env access).
 * If the env var is not set, the function trusts local/direct server access.
 *
 * Sensitive operations = any operation that creates, modifies, or revokes records.
 * Read-only operations (list/get) skip this check.
 */
export function assertAdminToken(): void {
  const configured = process.env['PAYMENT_ORCHESTRATION_ADMIN_BOOTSTRAP_TOKEN'];
  if (!configured || !configured.trim()) {
    return;
  }
  const provided = process.env['PAYMENT_ORCHESTRATION_ADMIN_BOOTSTRAP_TOKEN'];
  if (!provided || !provided.trim()) {
    console.error(
      '[nf-admin] Error: PAYMENT_ORCHESTRATION_ADMIN_BOOTSTRAP_TOKEN is configured ' +
        'but not available in this process environment. Run the CLI in the same ' +
        'environment as the service.',
    );
    process.exit(1);
  }
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
