/**
 * auth types — S2: per-client request auth context.
 *
 * Attached to req.auth by the auth middleware after successful credential verification.
 * Legacy mode (shared service token) sets clientId='legacy' and scopes=['*'].
 */

export interface RequestAuthContext {
  clientId: string;
  sourceApp: string;
  environment: string;
  credentialId: string;
  scopes: string[];
}

declare global {
  namespace Express {
    interface Request {
      auth?: RequestAuthContext;
    }
  }
}
