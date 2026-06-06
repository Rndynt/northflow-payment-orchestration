/**
 * merchantAccess — S3/P0.3/P0.4: merchant ownership guard + per-grant scope enforcement.
 *
 * assertMerchantAccessWithScope:
 *   Validates that the authenticated client has:
 *     1. An active access grant to the given merchant.
 *     2. The required scope on that grant.
 *   Returns null on allow; { status, body } on deny.
 *
 * Bypass rules:
 *   - Legacy clients (clientId='legacy') bypass all checks.
 *   - System source app (sourceApp='internal') bypasses all checks.
 *   - All other clients are fully enforced.
 *
 * P0.3 — Fail closed:
 *   When accessRepo is missing and the client is not legacy/internal,
 *   the request is rejected with 503 SERVICE_MISCONFIGURED.
 *   Normal API clients must never bypass merchant access validation.
 *
 * P0.4 — Grant scopes:
 *   Both the client's global scopes and the merchant grant scopes must
 *   allow the required scope. '*' on either layer means all scopes for
 *   that layer only. The route still applies requireScope() for the global
 *   layer check; this helper enforces the grant layer.
 *
 * assertSourceApp:
 *   Prevents sourceApp spoofing by ensuring payload.sourceApp matches
 *   the authenticated client's sourceApp. Fills in sourceApp if absent.
 */

import type { ClientMerchantAccessRepository } from '@northflow/payment-orchestration-core';
import type { RequestAuthContext } from '../types/auth.ts';
import { apiErrorResponse } from '../routes/utils.ts';

export type MerchantAccessDenied = {
  status: number;
  body: ReturnType<typeof apiErrorResponse>;
};

function scopeAllowed(scopes: string[], required: string): boolean {
  return scopes.includes('*') || scopes.includes(required);
}

/**
 * assertMerchantAccessWithScope — combined access + grant scope guard.
 *
 * Replaces the old assertMerchantAccess in all merchant-scoped route handlers.
 * The route should still use requireScope() middleware for the global client scope check.
 *
 * Returns null if the request is permitted; returns { status, body } if denied.
 */
export async function assertMerchantAccessWithScope(
  auth: RequestAuthContext,
  merchantId: string,
  requiredScope: string,
  accessRepo: ClientMerchantAccessRepository | undefined,
): Promise<MerchantAccessDenied | null> {
  // Legacy and internal system clients bypass all grant checks
  if (auth.clientId === 'legacy' || auth.sourceApp === 'internal') return null;

  // P0.3: fail closed — normal clients cannot proceed without the access repo
  if (!accessRepo) {
    return {
      status: 503,
      body: apiErrorResponse(
        'SERVICE_MISCONFIGURED',
        'Merchant access authorization service is unavailable.',
      ),
    };
  }

  const grant = await accessRepo.findByClientAndMerchant(auth.clientId, merchantId);

  if (!grant || grant.status !== 'active') {
    return {
      status: 403,
      body: apiErrorResponse('MERCHANT_ACCESS_DENIED', 'Access to this merchant is not permitted.'),
    };
  }

  // P0.4: enforce grant-level scope (global client scope is enforced by requireScope middleware)
  if (!scopeAllowed(grant.scopes, requiredScope)) {
    return {
      status: 403,
      body: apiErrorResponse(
        'SCOPE_DENIED',
        `Merchant access grant does not include the required scope: ${requiredScope}`,
      ),
    };
  }

  return null;
}

/**
 * assertSourceApp — S4: prevent sourceApp spoofing.
 *
 * Returns null if OK; returns a 403 error body if mismatched.
 * Mutates payload to fill in sourceApp when absent.
 */
export function assertSourceApp(
  auth: RequestAuthContext,
  payload: Record<string, unknown>,
): ReturnType<typeof apiErrorResponse> | null {
  if (auth.clientId === 'legacy' || auth.sourceApp === 'internal') return null;

  const claimed = payload['sourceApp'];
  if (claimed === undefined || claimed === null) {
    payload['sourceApp'] = auth.sourceApp;
    return null;
  }
  if (typeof claimed === 'string' && claimed !== auth.sourceApp) {
    return apiErrorResponse(
      'SOURCE_APP_MISMATCH',
      `sourceApp mismatch: expected '${auth.sourceApp}', got '${claimed}'.`,
    );
  }
  return null;
}
