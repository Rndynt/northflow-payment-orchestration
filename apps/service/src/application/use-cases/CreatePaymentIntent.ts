/**
 * CreatePaymentIntent — create a standalone payment intent.
 *
 * Phase 8D use case.
 * Initial status: requires_payment.
 * amountRemaining = amountDue.
 */

import { randomUUID } from 'crypto';
import type {
  PaymentMerchantRepository,
  PaymentIntentRepository,
  PaymentIdempotencyRepository,
} from '@northflow/payment-orchestration-core';
import type { StandalonePaymentIntentDTO } from '@northflow/payment-orchestration-core';

export interface CreatePaymentIntentInput {
  merchantId: string;
  providerAccountId?: string | null;
  sourceApp?: string | null;
  externalTenantId?: string | null;
  externalOutletId?: string | null;
  externalLocationId?: string | null;
  externalPayableType: string;
  externalPayableId: string;
  currency?: string;
  amountDue: number;
  allowPartial?: boolean;
  expiresAt?: Date | null;
  metadata?: Record<string, unknown> | null;
  idempotencyKey?: string | null;
}

export interface CreatePaymentIntentOutput {
  intent: StandalonePaymentIntentDTO;
  created: boolean;
}

export class CreatePaymentIntent {
  constructor(
    private readonly merchantRepo: PaymentMerchantRepository,
    private readonly intentRepo: PaymentIntentRepository,
    private readonly idempotencyRepo: PaymentIdempotencyRepository,
  ) {}

  async execute(
    input: CreatePaymentIntentInput,
  ): Promise<CreatePaymentIntentOutput> {
    if (!input.merchantId || !input.externalPayableType || !input.externalPayableId) {
      throw Object.assign(
        new Error('merchantId, externalPayableType, and externalPayableId are required'),
        { statusCode: 400, code: 'VALIDATION_ERROR' },
      );
    }
    if (!Number.isInteger(input.amountDue) || input.amountDue <= 0) {
      throw Object.assign(
        new Error('amountDue must be a positive integer'),
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

    if (input.idempotencyKey) {
      const existing = await this.idempotencyRepo.find({
        merchantId: input.merchantId,
        scope: 'create_payment_intent',
        idempotencyKey: input.idempotencyKey,
      });
      if (existing?.status === 'completed' && existing.responseSnapshot?.['intentId']) {
        const intentId = existing.responseSnapshot['intentId'] as string;
        const intent = await this.intentRepo.findById(intentId, input.merchantId);
        if (intent) {
          return { intent, created: false };
        }
      }
    }

    const intentId = `pi_${randomUUID()}`;

    if (input.idempotencyKey) {
      await this.idempotencyRepo.reserve({
        id: randomUUID(),
        merchantId: input.merchantId,
        scope: 'create_payment_intent',
        idempotencyKey: input.idempotencyKey,
        requestHash: input.idempotencyKey,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
    }

    const intent = await this.intentRepo.create({
      id: intentId,
      merchantId: input.merchantId,
      providerAccountId: input.providerAccountId ?? null,
      sourceApp: input.sourceApp ?? null,
      externalTenantId: input.externalTenantId ?? null,
      externalOutletId: input.externalOutletId ?? null,
      externalLocationId: input.externalLocationId ?? null,
      externalPayableType: input.externalPayableType,
      externalPayableId: input.externalPayableId,
      currency: input.currency ?? 'IDR',
      amountDue: input.amountDue,
      allowPartial: input.allowPartial ?? false,
      expiresAt: input.expiresAt ?? null,
      metadata: input.metadata ?? null,
    });

    if (input.idempotencyKey) {
      await this.idempotencyRepo.markCompleted({
        merchantId: input.merchantId,
        scope: 'create_payment_intent',
        idempotencyKey: input.idempotencyKey,
        responseSnapshot: { intentId },
        resourceType: 'payment_intent',
        resourceId: intentId,
      });
    }

    return { intent, created: true };
  }
}
