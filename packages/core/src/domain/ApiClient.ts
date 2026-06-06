/**
 * ApiClient — S1 domain types for API client registry.
 */

export type ApiClientStatus = 'active' | 'disabled';
export type ClientCredentialStatus = 'active' | 'revoked' | 'expired';
export type ClientMerchantAccessStatus = 'active' | 'revoked';

export interface ApiClientDTO {
  id: string;
  name: string;
  sourceApp: string;
  environment: string;
  status: ApiClientStatus;
  scopes: string[];
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface ClientCredentialDTO {
  id: string;
  clientId: string;
  credentialPrefix: string;
  credentialHash: string;
  status: ClientCredentialStatus;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
  revokedAt: Date | null;
}

export interface ClientMerchantAccessDTO {
  id: string;
  clientId: string;
  merchantId: string;
  scopes: string[];
  status: ClientMerchantAccessStatus;
  createdAt: Date;
  revokedAt: Date | null;
}
