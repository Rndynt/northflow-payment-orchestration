/**
 * CreateProviderAccount — create a provider account for a merchant.
 *
 * Phase 8D use case.
 * FakeGateway allows no credentialsRef.
 * Xendit sandbox config allowed but not called in Phase 8D.
 */

import { randomUUID } from 'crypto';
import type {
  PaymentMerchantRepository,
  PaymentProviderAccountRepository,
} from '@northflow/payment-orchestration-core';
import type { PaymentProviderAccount } from '@northflow/payment-orchestration-core';

export interface CreateProviderAccountInput {
  merchantId: string;
  id?: string;
  provider: string;
  environment: 'sandbox' | 'test' | 'production';
  providerAccountRef?: string | null;
  credentialsRef?: string | null;
  publicConfig?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface CreateProviderAccountOutput {
  providerAccount: PaymentProviderAccount;
}

export class CreateProviderAccount {
  constructor(
    private readonly merchantRepo: PaymentMerchantRepository,
    private readonly providerAccountRepo: PaymentProviderAccountRepository,
  ) {}

  async execute(
    input: CreateProviderAccountInput,
  ): Promise<CreateProviderAccountOutput> {
    if (!input.merchantId || !input.provider) {
      throw Object.assign(
        new Error('merchantId and provider are required'),
        { statusCode: 400, code: 'VALIDATION_ERROR' },
      );
    }

    const merchant = await this.merchantRepo.findById(input.merchantId);
    if (!merchant) {
      throw Object.assign(
        new Error(`Merchant not found: ${input.merchantId}`),
        { statusCode: 404, code: 'MERCHANT_NOT_FOUND' },
      );
    }

    const id = input.id ?? `pa_${randomUUID()}`;
    const providerAccount = await this.providerAccountRepo.create({
      id,
      merchantId: input.merchantId,
      provider: input.provider,
      environment: input.environment,
      providerAccountRef: input.providerAccountRef ?? null,
      credentialsRef: input.credentialsRef ?? null,
      publicConfig: input.publicConfig ?? {},
      status: 'active',
      metadata: input.metadata ?? {},
    });

    return { providerAccount };
  }
}
