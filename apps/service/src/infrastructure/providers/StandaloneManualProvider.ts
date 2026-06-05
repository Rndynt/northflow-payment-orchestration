/**
 * StandaloneManualProvider — manual/cash payment provider for payment-orchestration-service.
 *
 * Equivalent of the legacy AuraPoS ManualProvider. Handles cash, bank transfer, and
 * any payment channel that does not require a third-party gateway API call.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │  No network calls. No credentials. No provider account required.        │
 * │  All operations succeed instantly (recorded directly in the DB).        │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Capabilities:
 * - createPayment   → always returns 'succeeded' immediately
 * - cancelPayment   → always returns 'cancelled' immediately
 * - refundPayment   → always returns 'succeeded' immediately (offline/cash refund)
 *
 * Phase 8F: initial implementation for legacy payment parity migration.
 */

import { randomBytes } from 'crypto';
import type {
  StandaloneCreatePaymentInput,
  StandalonePaymentProvider,
  StandaloneProviderCancelInput,
  StandaloneProviderCancelResult,
  StandaloneProviderRefundInput,
  StandaloneProviderRefundResult,
  StandaloneProviderResult,
} from './StandalonePaymentProvider.ts';

export class StandaloneManualProvider implements StandalonePaymentProvider {
  public readonly providerCode = 'manual';
  public readonly capabilities = {
    supportsRefund: true,
    supportsCancel: true,
    supportsPolling: false,
    supportsWebhook: false,
    supportedMethods: ['cash', 'bank_transfer', 'manual'],
    supportsRedirect: false,
    supportsQr: false,
    supportsVa: false,
    supportsPaymentCode: false,
    supportsPartialRefund: true,
    supportsMultiplePartialRefund: true,
    canReturnImmediateSuccess: true,
    canReturnImmediateFailure: false,
  };

  async createPayment(input: StandaloneCreatePaymentInput): Promise<StandaloneProviderResult> {
    const ref = `manual_${input.intentId}_${randomBytes(4).toString('hex')}`;
    return {
      status: 'succeeded',
      providerReference: ref,
      providerPaymentUrl: null,
      providerQrString: null,
      rawProviderResponse: {
        provider: 'manual',
        provider_reference: ref,
        method: input.method,
        amount: input.amount,
        currency: input.currency,
        settled: true,
      },
      failureReason: null,
      expiresAt: null,
    };
  }

  async cancelPayment(input: StandaloneProviderCancelInput): Promise<StandaloneProviderCancelResult> {
    return {
      status: 'cancelled',
      providerReference: input.providerReference,
      rawProviderResponse: {
        provider: 'manual',
        transaction_id: input.transactionId,
        provider_reference: input.providerReference,
        reason: input.reason ?? null,
        cancelled: true,
      },
      failureReason: null,
    };
  }

  async refundPayment(input: StandaloneProviderRefundInput): Promise<StandaloneProviderRefundResult> {
    const refundRef = `manual_refund_${input.transactionId}_${randomBytes(4).toString('hex')}`;
    return {
      status: 'succeeded',
      providerReference: refundRef,
      rawProviderResponse: {
        provider: 'manual',
        refund_reference: refundRef,
        original_transaction_id: input.transactionId,
        original_provider_reference: input.providerReference,
        amount: input.amount,
        currency: input.currency,
        reason: input.reason ?? null,
        refunded: true,
      },
      failureReason: null,
    };
  }
}
