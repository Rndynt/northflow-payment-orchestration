/**
 * CreateGatewayPayment — initiate a payment against a payment intent via a provider.
 *
 * Phase 8D: FakeGateway is the acceptance provider.
 * Phase 8D Hardening:
 *   - Task 4: validate providerAccountId when provided; require it for non-fake providers
 *             (fake_gateway may run without a providerAccount in non-production as dev convenience).
 *   - Task 5: idempotency guard (scope: create_gateway_payment, hash from canonical request params).
 *
 * Rules:
 * - amount must be positive integer.
 * - amount must not exceed intent.amountRemaining (overpayment rejected).
 * - If provider result is 'succeeded', update intent totals immediately.
 * - If 'requires_action' or 'pending', intent stays at requires_payment.
 * - Idempotent replay returns the cached transaction+intent without calling the provider again.
 */

import { randomUUID, createHash } from 'crypto';
import type {
  PaymentMerchantRepository,
  PaymentIntentRepository,
  PaymentTransactionRepository,
  PaymentProviderAccountRepository,
  PaymentIdempotencyRepository,
} from '@northflow/payment-orchestration-core';
import type {
  PaymentProviderAccount,
  StandalonePaymentIntentDTO,
  StandalonePaymentTransactionDTO,
  StandaloneTransactionStatus,
} from '@northflow/payment-orchestration-core';
import type { ProviderRegistry } from '../../infrastructure/providers/providerRegistry.ts';
import { assertIntentPayable, assertPaymentAmountAllowed, computeIntentStatus } from './intentStatusHelper.ts';

const IDEMPOTENCY_SCOPE = 'create_gateway_payment';

function parseProviderExpiresAt(rawProviderResponse: Record<string, unknown> | null | undefined): Date | null {
  const raw = rawProviderResponse?.['expires_at'];
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((v) => stableJson(v)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((k) => `${JSON.stringify(k)}:${stableJson((value as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function computeRequestHash(input: CreateGatewayPaymentInput): string {
  const canonical = stableJson({
    merchantId: input.merchantId,
    intentId: input.intentId,
    provider: input.provider,
    method: input.method,
    amount: input.amount,
    providerAccountId: input.providerAccountId ?? null,
    metadata: input.metadata ?? null,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

export interface CreateGatewayPaymentInput {
  merchantId: string;
  intentId: string;
  provider: string;
  method: string;
  amount: number;
  providerAccountId?: string | null;
  idempotencyKey?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface CreateGatewayPaymentOutput {
  transaction: StandalonePaymentTransactionDTO;
  intent: StandalonePaymentIntentDTO;
  idempotentReplay?: boolean;
}

export class CreateGatewayPayment {
  constructor(
    private readonly merchantRepo: PaymentMerchantRepository,
    private readonly intentRepo: PaymentIntentRepository,
    private readonly transactionRepo: PaymentTransactionRepository,
    private readonly providerRegistry: ProviderRegistry,
    private readonly providerAccountRepo: PaymentProviderAccountRepository,
    private readonly idempotencyRepo: PaymentIdempotencyRepository,
    private readonly nodeEnv: string,
  ) {}

  async execute(
    input: CreateGatewayPaymentInput,
  ): Promise<CreateGatewayPaymentOutput> {
    // ── Basic validation ──────────────────────────────────────────────────────
    if (!input.merchantId || !input.intentId || !input.provider || !input.method) {
      throw Object.assign(
        new Error('merchantId, intentId, provider, and method are required'),
        { statusCode: 400, code: 'VALIDATION_ERROR' },
      );
    }
    if (!Number.isInteger(input.amount) || input.amount <= 0) {
      throw Object.assign(
        new Error('amount must be a positive integer'),
        { statusCode: 400, code: 'VALIDATION_ERROR' },
      );
    }

    // ── Merchant + idempotency hash ─────────────────────────────────────────
    const requestHash = computeRequestHash(input);

    if (input.idempotencyKey) {
      const existingPrecheck = await this.idempotencyRepo.find({
        merchantId: input.merchantId,
        scope: IDEMPOTENCY_SCOPE,
        idempotencyKey: input.idempotencyKey,
      });
      if (existingPrecheck && existingPrecheck.status !== 'processing') {
        if (existingPrecheck.status === 'failed') {
          throw Object.assign(new Error('Idempotency key previously failed. A new idempotency key is required for a retry.'), { statusCode: 409, code: 'IDEMPOTENCY_PREVIOUSLY_FAILED' });
        }
        if (existingPrecheck.requestHash !== requestHash) {
          throw Object.assign(new Error('Idempotency key has already been used with different request parameters.'), { statusCode: 409, code: 'IDEMPOTENCY_CONFLICT' });
        }
        if (existingPrecheck.status === 'completed') {
          const snapshot = existingPrecheck.responseSnapshot as Record<string, unknown>;
          return {
            transaction: snapshot['transaction'] as StandalonePaymentTransactionDTO,
            intent: snapshot['intent'] as StandalonePaymentIntentDTO,
            idempotentReplay: true,
          };
        }
      }
    }

    const merchant = await this.merchantRepo.findById(input.merchantId);
    if (!merchant) {
      throw Object.assign(
        new Error(`Merchant not found: ${input.merchantId}`),
        { statusCode: 404, code: 'MERCHANT_NOT_FOUND' },
      );
    }

    const intent = await this.intentRepo.findById(input.intentId, input.merchantId);
    if (!intent) {
      throw Object.assign(
        new Error(`Payment intent not found: ${input.intentId}`),
        { statusCode: 404, code: 'INTENT_NOT_FOUND' },
      );
    }

    assertIntentPayable(intent);
    assertPaymentAmountAllowed(intent, input.amount);

    // ── Task 4: Provider account validation ───────────────────────────────────
    let providerAccount: PaymentProviderAccount | null = null;
    if (input.providerAccountId) {
      // Provided: must exist, be active, and match the requested provider.
      const pa = await this.providerAccountRepo.findById(input.providerAccountId, input.merchantId);
      providerAccount = pa;
      if (!pa) {
        throw Object.assign(
          new Error(`Provider account not found: ${input.providerAccountId}`),
          { statusCode: 404, code: 'PROVIDER_ACCOUNT_NOT_FOUND' },
        );
      }
      if (pa.status !== 'active') {
        throw Object.assign(
          new Error(
            `Provider account is not active: ${input.providerAccountId} (status: ${pa.status})`,
          ),
          { statusCode: 422, code: 'PROVIDER_ACCOUNT_DISABLED' },
        );
      }
      if (pa.provider !== input.provider) {
        throw Object.assign(
          new Error(
            `Provider account ${input.providerAccountId} belongs to provider '${pa.provider}', not '${input.provider}'`,
          ),
          { statusCode: 422, code: 'PROVIDER_ACCOUNT_PROVIDER_MISMATCH' },
        );
      }
    } else {
      // Not provided: fake_gateway may run without one in non-production (dev convenience).
      // Any other provider, or fake_gateway in production, must supply a provider account.
      const isFakeGatewayDevMode =
        input.provider === 'fake_gateway' && this.nodeEnv !== 'production';
      if (!isFakeGatewayDevMode) {
        throw Object.assign(
          new Error(
            input.provider === 'fake_gateway'
              ? 'providerAccountId is required for fake_gateway in production'
              : `providerAccountId is required for provider '${input.provider}'`,
          ),
          { statusCode: 422, code: 'PROVIDER_ACCOUNT_REQUIRED' },
        );
      }
    }

    // ── Provider lookup ───────────────────────────────────────────────────────
    const provider = this.providerRegistry.get(input.provider);
    if (!provider) {
      throw Object.assign(
        new Error(`Provider not available: ${input.provider}`),
        { statusCode: 422, code: 'PROVIDER_NOT_AVAILABLE' },
      );
    }

    // ── Task 5: Idempotency guard ─────────────────────────────────────────────
    if (input.idempotencyKey) {
      const { key: existingKey, reserved } = this.idempotencyRepo.reserveOrGet
        ? await this.idempotencyRepo.reserveOrGet({
            id: `idem_${randomUUID()}`,
            merchantId: input.merchantId,
            scope: IDEMPOTENCY_SCOPE,
            idempotencyKey: input.idempotencyKey,
            requestHash,
          })
        : { key: await this.idempotencyRepo.find({
            merchantId: input.merchantId,
            scope: IDEMPOTENCY_SCOPE,
            idempotencyKey: input.idempotencyKey,
          }), reserved: false } as any;

      if (!reserved && existingKey) {
        if (existingKey.requestHash !== requestHash) {
          throw Object.assign(
            new Error('Idempotency key has already been used with different request parameters.'),
            { statusCode: 409, code: 'IDEMPOTENCY_CONFLICT' },
          );
        }
        if (existingKey.status === 'processing') {
          throw Object.assign(new Error('A payment with this idempotency key is already being processed.'), {
            statusCode: 409,
            code: 'IDEMPOTENCY_IN_PROGRESS',
          });
        }
        if (existingKey.status === 'completed') {
          const snapshot = existingKey.responseSnapshot as Record<string, unknown>;
          return {
            transaction: snapshot['transaction'] as StandalonePaymentTransactionDTO,
            intent: snapshot['intent'] as StandalonePaymentIntentDTO,
            idempotentReplay: true,
          };
        }
        if (existingKey.status === 'failed') {
          throw Object.assign(new Error('Idempotency key previously failed. A new idempotency key is required for a retry.'), {
            statusCode: 409,
            code: 'IDEMPOTENCY_PREVIOUSLY_FAILED',
          });
        }
      } else if (!reserved) {
        await this.idempotencyRepo.reserve({
          id: `idem_${randomUUID()}`,
          merchantId: input.merchantId,
          scope: IDEMPOTENCY_SCOPE,
          idempotencyKey: input.idempotencyKey,
          requestHash,
        });
      }
    }

    // ── Provider call ─────────────────────────────────────────────────────────
    let providerResult: Awaited<ReturnType<(typeof provider)['createPayment']>>;
    try {
      providerResult = await provider.createPayment({
        intentId: intent.id,
        amount: input.amount,
        currency: intent.currency,
        method: input.method,
        providerAccount,
        metadata: input.metadata,
      });
    } catch (providerErr) {
      // Mark idempotency key as failed so it can be retried.
      if (input.idempotencyKey) {
        await this.idempotencyRepo.markFailed({
          merchantId: input.merchantId,
          scope: IDEMPOTENCY_SCOPE,
          idempotencyKey: input.idempotencyKey,
          error: String(providerErr),
        });
      }
      throw providerErr;
    }

    // ── Create transaction record ─────────────────────────────────────────────
    const txId = `tx_${randomUUID()}`;
    const txStatus = providerResult.status as StandaloneTransactionStatus;

    const transaction = await this.transactionRepo.create({
      id: txId,
      merchantId: input.merchantId,
      intentId: intent.id,
      providerAccountId: input.providerAccountId ?? null,
      provider: input.provider,
      method: input.method,
      transactionType: 'payment',
      direction: 'incoming',
      status: txStatus === 'succeeded' && this.transactionRepo.applySucceededPayment ? 'pending' : txStatus,
      amount: input.amount,
      currency: intent.currency,
      providerReference: providerResult.providerReference,
      providerPaymentUrl: providerResult.providerPaymentUrl,
      providerQrString: providerResult.providerQrString,
      failureReason: providerResult.failureReason,
      idempotencyKey: input.idempotencyKey ?? null,
      rawProviderResponse: providerResult.rawProviderResponse,
      expiresAt: providerResult.expiresAt ?? parseProviderExpiresAt(providerResult.rawProviderResponse),
      metadata: input.metadata ?? null,
    });

    // ── Update intent if succeeded immediately ────────────────────────────────
    let updatedIntent = intent;

    if (txStatus === 'succeeded') {
      if (this.transactionRepo.applySucceededPayment) {
        const applied = await this.transactionRepo.applySucceededPayment({
          transactionId: transaction.id,
          merchantId: input.merchantId,
          intentId: intent.id,
          amount: input.amount,
        });
        updatedIntent = applied.intent;
        (transaction as any).status = applied.transaction.status;
      } else {
        const newAmountPaid = intent.amountPaid + input.amount;
        const newAmountRemaining = Math.max(0, intent.amountDue - newAmountPaid);
        const newStatus = computeIntentStatus(intent.amountDue, newAmountPaid);
        updatedIntent = await this.intentRepo.updateTotals({
          id: intent.id,
          merchantId: input.merchantId,
          amountPaid: newAmountPaid,
          amountRefunded: intent.amountRefunded,
          amountRemaining: newAmountRemaining,
        });
        updatedIntent = await this.intentRepo.updateStatus({
          id: intent.id,
          merchantId: input.merchantId,
          status: newStatus,
        });
      }
    }

    // ── Mark idempotency key completed ────────────────────────────────────────
    if (input.idempotencyKey) {
      await this.idempotencyRepo.markCompleted({
        merchantId: input.merchantId,
        scope: IDEMPOTENCY_SCOPE,
        idempotencyKey: input.idempotencyKey,
        responseSnapshot: { transaction, intent: updatedIntent },
        resourceType: 'payment_transaction',
        resourceId: transaction.id,
      });
    }

    return { transaction, intent: updatedIntent, idempotentReplay: false };
  }
}
