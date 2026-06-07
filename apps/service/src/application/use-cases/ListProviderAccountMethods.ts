/**
 * ListProviderAccountMethods — S7.5: list payment methods for a merchant or provider account.
 *
 * Two modes:
 * 1. listByProviderAccount — all methods for a specific provider account (validates it belongs to merchant)
 * 2. listByMerchant — all active methods across all active provider accounts for a merchant
 */

import type { PaymentProviderAccountRepository, ProviderAccountPaymentMethodRepository } from '@northflow/payment-orchestration-core';
import type { ProviderAccountPaymentMethod } from '@northflow/payment-orchestration-core';

export interface ListByProviderAccountInput {
  merchantId: string;
  providerAccountId: string;
}

export interface ListByMerchantInput {
  merchantId: string;
}

export class ListProviderAccountMethods {
  constructor(
    private readonly providerAccountRepo: PaymentProviderAccountRepository,
    private readonly methodRepo: ProviderAccountPaymentMethodRepository,
  ) {}

  async listByProviderAccount(input: ListByProviderAccountInput): Promise<ProviderAccountPaymentMethod[]> {
    if (!input.merchantId || !input.providerAccountId) {
      throw Object.assign(
        new Error('merchantId and providerAccountId are required'),
        { statusCode: 400, code: 'VALIDATION_ERROR' },
      );
    }

    // Validate provider account belongs to merchant
    const pa = await this.providerAccountRepo.findById(input.providerAccountId, input.merchantId);
    if (!pa) {
      throw Object.assign(
        new Error(`Provider account not found: ${input.providerAccountId}`),
        { statusCode: 404, code: 'PROVIDER_ACCOUNT_NOT_FOUND' },
      );
    }

    return this.methodRepo.listByProviderAccount(input.providerAccountId);
  }

  async listByMerchant(input: ListByMerchantInput): Promise<ProviderAccountPaymentMethod[]> {
    if (!input.merchantId) {
      throw Object.assign(
        new Error('merchantId is required'),
        { statusCode: 400, code: 'VALIDATION_ERROR' },
      );
    }

    const methods = await this.methodRepo.listByMerchant(input.merchantId);
    // Return only active methods across all provider accounts
    return methods.filter((m) => m.status === 'active');
  }
}
