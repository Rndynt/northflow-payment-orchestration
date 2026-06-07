/**
 * GetPaymentMethodOptions — S7.5: resolve valid payment options for a specific payment intent.
 *
 * Behavior:
 * 1. Load intent and enforce merchant access (intent must belong to merchant).
 * 2. List active provider account methods for the merchant.
 * 3. Filter by intent currency.
 * 4. Filter by amount remaining or amount due against method min/max.
 * 5. Exclude disabled/unsupported methods.
 * 6. Return display-ready options.
 *
 * This is the main consumer-facing endpoint — consumer apps call this before
 * creating a gateway payment to discover available options.
 */

import type { PaymentIntentRepository, ProviderAccountPaymentMethodRepository } from '@northflow/payment-orchestration-core';
import type { ProviderAccountPaymentMethod } from '@northflow/payment-orchestration-core';

export interface GetPaymentMethodOptionsInput {
  intentId: string;
  merchantId: string;
}

export interface PaymentOption {
  method: string;
  methodType: string;
  displayName: string;
  providerAccountId: string;
  provider: string;
  currency: string;
  minAmount: number | null;
  maxAmount: number | null;
  publicConfig: Record<string, unknown>;
}

export interface GetPaymentMethodOptionsOutput {
  intentId: string;
  merchantId: string;
  currency: string;
  amountRemaining: number;
  options: PaymentOption[];
}

export class GetPaymentMethodOptions {
  constructor(
    private readonly intentRepo: PaymentIntentRepository,
    private readonly methodRepo: ProviderAccountPaymentMethodRepository,
  ) {}

  async execute(input: GetPaymentMethodOptionsInput): Promise<GetPaymentMethodOptionsOutput> {
    if (!input.intentId || !input.merchantId) {
      throw Object.assign(
        new Error('intentId and merchantId are required'),
        { statusCode: 400, code: 'VALIDATION_ERROR' },
      );
    }

    const intent = await this.intentRepo.findById(input.intentId, input.merchantId);
    if (!intent) {
      throw Object.assign(
        new Error(`Payment intent not found: ${input.intentId}`),
        { statusCode: 404, code: 'INTENT_NOT_FOUND' },
      );
    }

    if (intent.merchantId !== input.merchantId) {
      throw Object.assign(
        new Error('Intent does not belong to the specified merchant'),
        { statusCode: 403, code: 'MERCHANT_ACCESS_DENIED' },
      );
    }

    const allMethods = await this.methodRepo.listByMerchant(input.merchantId);

    const amountForFilter = intent.amountRemaining > 0 ? intent.amountRemaining : intent.amountDue;

    const options: PaymentOption[] = [];
    for (const m of allMethods) {
      // Filter: only active methods
      if (m.status !== 'active') continue;

      // Filter: currency must match intent
      if (m.currency !== intent.currency) continue;

      // Filter: amount must satisfy min/max when configured
      if (m.minAmount !== null && amountForFilter < m.minAmount) continue;
      if (m.maxAmount !== null && amountForFilter > m.maxAmount) continue;

      options.push({
        method: m.method,
        methodType: m.methodType,
        displayName: m.displayName,
        providerAccountId: m.providerAccountId,
        provider: m.provider,
        currency: m.currency,
        minAmount: m.minAmount,
        maxAmount: m.maxAmount,
        publicConfig: m.publicConfig,
      });
    }

    // Sort by sortOrder
    options.sort((a, b) => {
      const mA = allMethods.find((m) => m.method === a.method && m.providerAccountId === a.providerAccountId);
      const mB = allMethods.find((m) => m.method === b.method && m.providerAccountId === b.providerAccountId);
      return (mA?.sortOrder ?? 0) - (mB?.sortOrder ?? 0);
    });

    return {
      intentId: intent.id,
      merchantId: intent.merchantId,
      currency: intent.currency,
      amountRemaining: intent.amountRemaining,
      options,
    };
  }
}
