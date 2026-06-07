/**
 * UpsertProviderAccountMethod — S7.5: create or update a payment method for a provider account.
 *
 * Used for internal/service configuration and by admin/dashboard UI.
 * Validates that the provider account belongs to the merchant before upsert.
 */

import { randomUUID } from 'crypto';
import type { PaymentProviderAccountRepository, ProviderAccountPaymentMethodRepository, UpsertProviderAccountMethodInput } from '@northflow/payment-orchestration-core';
import type { ProviderAccountPaymentMethod, ProviderAccountPaymentMethodType } from '@northflow/payment-orchestration-core';

export interface UpsertProviderAccountMethodUseCaseInput {
  merchantId: string;
  providerAccountId: string;
  method: string;
  methodType?: ProviderAccountPaymentMethodType;
  providerMethodCode?: string | null;
  displayName?: string;
  status?: 'active' | 'disabled' | 'unsupported';
  currency?: string;
  minAmount?: number | null;
  maxAmount?: number | null;
  sortOrder?: number;
  publicConfig?: Record<string, unknown>;
  providerMetadata?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface UpsertProviderAccountMethodOutput {
  method: ProviderAccountPaymentMethod;
  created: boolean;
}

export class UpsertProviderAccountMethod {
  constructor(
    private readonly providerAccountRepo: PaymentProviderAccountRepository,
    private readonly methodRepo: ProviderAccountPaymentMethodRepository,
  ) {}

  async execute(input: UpsertProviderAccountMethodUseCaseInput): Promise<UpsertProviderAccountMethodOutput> {
    if (!input.merchantId || !input.providerAccountId || !input.method) {
      throw Object.assign(
        new Error('merchantId, providerAccountId, and method are required'),
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

    const existing = await this.methodRepo.findByProviderAccountAndMethod(
      input.providerAccountId,
      input.method,
    );

    const upsertInput: UpsertProviderAccountMethodInput = {
      id: existing?.id ?? `pam_${randomUUID()}`,
      merchantId: input.merchantId,
      providerAccountId: input.providerAccountId,
      provider: pa.provider,
      method: input.method,
      methodType: input.methodType ?? 'other',
      providerMethodCode: input.providerMethodCode ?? null,
      displayName: input.displayName ?? input.method,
      status: input.status ?? existing?.status ?? 'active',
      currency: input.currency ?? existing?.currency ?? 'IDR',
      minAmount: input.minAmount ?? existing?.minAmount ?? null,
      maxAmount: input.maxAmount ?? existing?.maxAmount ?? null,
      sortOrder: input.sortOrder ?? existing?.sortOrder ?? 0,
      publicConfig: input.publicConfig ?? existing?.publicConfig ?? {},
      providerMetadata: input.providerMetadata ?? existing?.providerMetadata ?? {},
      metadata: input.metadata ?? existing?.metadata ?? {},
    };

    const method = await this.methodRepo.upsert(upsertInput);
    return { method, created: !existing };
  }
}
