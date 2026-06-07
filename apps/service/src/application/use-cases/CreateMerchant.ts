/**
 * CreateMerchant — create or return an existing standalone merchant.
 *
 * Phase 8D use case. No external tenant dependency.
 * If sourceApp + externalRef already exists, returns existing merchant (idempotent).
 */

import { randomUUID } from 'crypto';
import type { PaymentMerchantRepository } from '@northflow/payment-orchestration-core';
import type { PaymentMerchant } from '@northflow/payment-orchestration-core';

export interface CreateMerchantInput {
  id?: string;
  name: string;
  legalName?: string | null;
  sourceApp?: string | null;
  externalRef?: string | null;
  metadata?: Record<string, unknown>;
}

export interface CreateMerchantOutput {
  merchant: PaymentMerchant;
  created: boolean;
}

export class CreateMerchant {
  constructor(private readonly merchantRepo: PaymentMerchantRepository) {}

  async execute(input: CreateMerchantInput): Promise<CreateMerchantOutput> {
    if (!input.name || !input.name.trim()) {
      throw Object.assign(new Error('Merchant name is required'), {
        statusCode: 400,
        code: 'VALIDATION_ERROR',
      });
    }

    if (input.sourceApp && input.externalRef) {
      const existing = await this.merchantRepo.findByExternalRef({
        sourceApp: input.sourceApp,
        externalRef: input.externalRef,
      });
      if (existing) {
        return { merchant: existing, created: false };
      }
    }

    const id = input.id ?? `merchant_${randomUUID()}`;
    const merchant = await this.merchantRepo.create({
      id,
      name: input.name.trim(),
      legalName: input.legalName ?? null,
      sourceApp: input.sourceApp ?? null,
      externalRef: input.externalRef ?? null,
      status: 'active',
      metadata: input.metadata ?? {},
    });

    return { merchant, created: true };
  }
}
