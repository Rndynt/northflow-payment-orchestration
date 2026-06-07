/**
 * ProviderAccountPaymentMethod — domain types for S7.5 Payment Method Options.
 *
 * Represents a payment method that is enabled for a specific merchant provider account.
 * This is NOT a global provider catalog — it is a per-merchant-provider-account config.
 *
 * Hierarchy:
 *   provider capability  = what the adapter can support in general
 *   provider account method = what this merchant/provider account is allowed to use (this entity)
 *   payment option = what is valid for a specific intent amount/currency/status
 */

export type ProviderAccountPaymentMethodStatus = 'active' | 'disabled' | 'unsupported';

export type ProviderAccountPaymentMethodType =
  | 'qris'
  | 'virtual_account'
  | 'ewallet'
  | 'card'
  | 'retail_outlet'
  | 'manual'
  | 'other';

export interface ProviderAccountPaymentMethod {
  id: string;
  merchantId: string;
  providerAccountId: string;
  provider: string;
  method: string;
  methodType: ProviderAccountPaymentMethodType;
  providerMethodCode: string | null;
  displayName: string;
  status: ProviderAccountPaymentMethodStatus;
  currency: string;
  minAmount: number | null;
  maxAmount: number | null;
  sortOrder: number;
  publicConfig: Record<string, unknown>;
  providerMetadata: Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * ProviderPaymentMethodCapability — what a provider adapter declares it can support.
 *
 * Used by Layer 1 (adapter static capabilities) and Layer 2 (provider sync hook).
 * Not stored in DB directly — used to populate po_provider_account_methods via sync.
 */
export interface ProviderPaymentMethodCapability {
  provider: string;
  method: string;
  methodType: ProviderAccountPaymentMethodType;
  displayName: string;
  supportedCurrencies: string[];
  minAmount?: number | null;
  maxAmount?: number | null;
  requiresProviderAccountConfig?: boolean;
  providerSpecificCode?: string | null;
  metadata?: Record<string, unknown>;
}
