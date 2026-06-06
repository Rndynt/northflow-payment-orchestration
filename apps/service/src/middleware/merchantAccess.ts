/**
 * merchantAccess — S3: merchant ownership guard helpers.
 *
 * assertMerchantAccess: call inline inside route handlers after merchantId is resolved.
 *
 * Rules:
 *   - Legacy clients (clientId='legacy') bypass the check.
 *   - System source app ('internal') bypasses the check.
 *   - All other clients must have an active ClientMerchantAccess grant.
 *
 * Returns null if access is granted, or an error response object if denied.
 * The caller must check the return value and call res.status(403).json(denied) if non-null.
 */

import type { ClientMerchantAccessRepository } from '@northflow/payment-orchestration-core';
import type { RequestAuthContext } from '../types/auth.ts';
import { apiErrorResponse } from '../routes/utils.ts';

export async function assertMerchantAccess(
  auth: RequestAuthContext,
  merchantId: string,
  accessRepo: ClientMerchantAccessRepository | undefined,
): Promise<ReturnType<typeof apiErrorResponse> | null> {
  if (!accessRepo) return null;
  if (auth.clientId === 'legacy' || auth.sourceApp === 'internal') return null;

  const grant = await accessRepo.findByClientAndMerchant(auth.clientId, merchantId);
  if (!grant || grant.status !== 'active') {
    return apiErrorResponse('MERCHANT_ACCESS_DENIED', 'Access to this merchant is not permitted.');
  }
  return null;
}

/**
 * assertSourceApp — S4: prevent caller source app spoofing.
 *
 * If req.auth has a sourceApp and the payload includes a different sourceApp, deny.
 * Returns null if OK, error response if mismatch.
 * Also fills in `sourceApp` on the payload object if missing (mutates).
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
    return apiErrorResponse('SOURCE_APP_MISMATCH', `sourceApp mismatch: expected '${auth.sourceApp}', got '${claimed}'.`);
  }
  return null;
}
