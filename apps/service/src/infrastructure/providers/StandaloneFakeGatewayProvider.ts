/**
 * StandaloneFakeGatewayProvider — dev/test-only simulated payment gateway.
 *
 * Isolated implementation for the standalone payment-orchestration-service.
 * Does NOT import from @pos/domain/payments — fully self-contained.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │  DO NOT use in production. No real money movement.                      │
 * │  Dev/test only. Registered only when NODE_ENV !== 'production'.         │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Scenario dispatch via input.metadata.scenario:
 *
 * | scenario           | status          | notes                             |
 * |--------------------|-----------------|-----------------------------------|
 * | qris               | requires_action | QRIS QR string returned           |
 * | redirect           | requires_action | Web redirect URL                  |
 * | va                 | requires_action | Virtual account number            |
 * | payment_code       | requires_action | Retail payment code               |
 * | immediate_success  | succeeded       | Settled immediately               |
 * | immediate_failure  | failed          | Rejected immediately              |
 * | pending_expiry     | requires_action | With expiry set                   |
 * | default / any      | requires_action | QRIS-like default behavior        |
 *
 * Phase 8F: added cancelPayment() and refundPayment() for refund/void parity tests.
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
  StandaloneProviderStatusResult,
} from './StandalonePaymentProvider.ts';

export class StandaloneFakeGatewayProvider implements StandalonePaymentProvider {
  constructor(_nodeEnv?: string) {}

  public readonly providerCode = 'fake_gateway';
  public readonly capabilities = {
    supportsRefund: true,
    supportsCancel: true,
    supportsPolling: true,
    supportsWebhook: true,
    supportedMethods: ['qris', 'card', 'va', 'retail'],
    supportsRedirect: true,
    supportsQr: true,
    supportsVa: true,
    supportsPaymentCode: true,
    supportsPartialRefund: true,
    supportsMultiplePartialRefund: true,
    canReturnImmediateSuccess: true,
    canReturnImmediateFailure: true,
  };

  async createPayment(input: StandaloneCreatePaymentInput): Promise<StandaloneProviderResult> {
    const scenario =
      (input.metadata?.['scenario'] as string | undefined) ?? 'default';
    const suffix = randomBytes(4).toString('hex');
    const ref = `fake_${input.intentId}_${suffix}`;

    switch (scenario) {
      case 'immediate_success': {
        return {
          status: 'succeeded',
          providerReference: ref,
          providerPaymentUrl: null,
          providerQrString: null,
          rawProviderResponse: { scenario, provider_reference: ref, settled: true },
          failureReason: null,
          expiresAt: null,
        };
      }

      case 'immediate_failure': {
        return {
          status: 'failed',
          providerReference: ref,
          providerPaymentUrl: null,
          providerQrString: null,
          rawProviderResponse: { scenario, provider_reference: ref, failure_code: 'INSUFFICIENT_FUNDS' },
          failureReason: 'INSUFFICIENT_FUNDS',
          expiresAt: null,
        };
      }

      case 'redirect': {
        const url = `https://fake-gateway.local/pay/${ref}`;
        return {
          status: 'requires_action',
          providerReference: ref,
          providerPaymentUrl: url,
          providerQrString: null,
          rawProviderResponse: { scenario, provider_reference: ref, redirect_url: url },
          failureReason: null,
          expiresAt: null,
        };
      }

      case 'va': {
        const vaNumber = `8800${input.amount.toString().slice(-6).padStart(6, '0')}`;
        return {
          status: 'requires_action',
          providerReference: ref,
          providerPaymentUrl: null,
          providerQrString: null,
          rawProviderResponse: { scenario, provider_reference: ref, va_number: vaNumber },
          failureReason: null,
          expiresAt: null,
        };
      }

      case 'payment_code': {
        const code = `FAKE${suffix.toUpperCase()}`;
        return {
          status: 'requires_action',
          providerReference: ref,
          providerPaymentUrl: null,
          providerQrString: null,
          rawProviderResponse: { scenario, provider_reference: ref, payment_code: code },
          failureReason: null,
          expiresAt: null,
        };
      }

      case 'pending_expiry': {
        const url = `https://fake-gateway.local/pay/${ref}`;
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
        return {
          status: 'requires_action',
          providerReference: ref,
          providerPaymentUrl: url,
          providerQrString: null,
          rawProviderResponse: { scenario, provider_reference: ref, expires_at: expiresAt.toISOString() },
          failureReason: null,
          expiresAt,
        };
      }

      case 'qris':
      default: {
        const qrString = `FAKE_QR:${ref}:${input.amount}:${input.currency}`;
        return {
          status: 'requires_action',
          providerReference: ref,
          providerPaymentUrl: null,
          providerQrString: qrString,
          rawProviderResponse: { scenario: 'qris', provider_reference: ref, qr_string: qrString },
          failureReason: null,
          expiresAt: null,
        };
      }
    }
  }

  async getPaymentStatus(input: {
    transactionId: string;
    providerReference: string | null;
    rawProviderResponse?: Record<string, unknown> | null;
    metadata?: Record<string, unknown> | null;
  }): Promise<StandaloneProviderStatusResult> {
    const raw = input.rawProviderResponse ?? {};
    const status = typeof raw['status'] === 'string'
      ? raw['status']
      : typeof raw['scenario'] === 'string' && raw['scenario'] === 'immediate_success'
        ? 'succeeded'
        : typeof raw['scenario'] === 'string' && raw['scenario'] === 'immediate_failure'
          ? 'failed'
          : 'requires_action';

    return {
      status: status === 'succeeded' || status === 'failed' || status === 'pending'
        ? status
        : 'requires_action',
      providerReference: input.providerReference,
      rawProviderResponse: {
        ...raw,
        provider_reference: input.providerReference,
        status_refresh: 'deterministic_fake_gateway_lookup',
      },
      failureReason: status === 'failed' ? 'FAKE_GATEWAY_STATUS_FAILED' : null,
    };
  }

  /**
   * Phase 8F: Cancel (void) a pending/requires_action fake payment.
   * Always returns 'cancelled' for dev/test purposes.
   */
  async cancelPayment(input: StandaloneProviderCancelInput): Promise<StandaloneProviderCancelResult> {
    const cancelRef = `fake_cancel_${input.transactionId}_${randomBytes(4).toString('hex')}`;
    return {
      status: 'cancelled',
      providerReference: cancelRef,
      rawProviderResponse: {
        provider: 'fake_gateway',
        cancel_reference: cancelRef,
        original_provider_reference: input.providerReference,
        reason: input.reason ?? null,
        cancelled: true,
      },
      failureReason: null,
    };
  }

  /**
   * Phase 8F: Refund a succeeded fake payment.
   * Always returns 'succeeded' for dev/test purposes.
   */
  async refundPayment(input: StandaloneProviderRefundInput): Promise<StandaloneProviderRefundResult> {
    const refundRef = `fake_refund_${input.transactionId}_${randomBytes(4).toString('hex')}`;
    return {
      status: 'succeeded',
      providerReference: refundRef,
      rawProviderResponse: {
        provider: 'fake_gateway',
        refund_reference: refundRef,
        original_provider_reference: input.providerReference,
        amount: input.amount,
        currency: input.currency,
        reason: input.reason ?? null,
        refunded: true,
      },
      failureReason: null,
    };
  }

  /**
   * S7.5 Layer 1: static capability catalog for FakeGateway.
   * Covers QRIS, three virtual account methods, e-wallet, and a redirect flow
   * so integration tests can exercise method filtering without mocking the provider.
   */
  getPaymentMethodCapabilities() {
    return [
      {
        provider: 'fake_gateway',
        method: 'qris',
        methodType: 'qris' as const,
        displayName: 'QRIS',
        supportedCurrencies: ['IDR'],
        minAmount: 1,
        maxAmount: 10_000_000,
        providerSpecificCode: 'QRIS',
        metadata: { fakeScenario: 'qris' },
      },
      {
        provider: 'fake_gateway',
        method: 'va_bca',
        methodType: 'virtual_account' as const,
        displayName: 'Virtual Account BCA',
        supportedCurrencies: ['IDR'],
        minAmount: 10_000,
        maxAmount: 500_000_000,
        providerSpecificCode: 'BCA',
        metadata: { fakeScenario: 'va' },
      },
      {
        provider: 'fake_gateway',
        method: 'va_mandiri',
        methodType: 'virtual_account' as const,
        displayName: 'Virtual Account Mandiri',
        supportedCurrencies: ['IDR'],
        minAmount: 10_000,
        maxAmount: 500_000_000,
        providerSpecificCode: 'MANDIRI',
        metadata: { fakeScenario: 'va' },
      },
      {
        provider: 'fake_gateway',
        method: 'va_bni',
        methodType: 'virtual_account' as const,
        displayName: 'Virtual Account BNI',
        supportedCurrencies: ['IDR'],
        minAmount: 10_000,
        maxAmount: 500_000_000,
        providerSpecificCode: 'BNI',
        metadata: { fakeScenario: 'va' },
      },
      {
        provider: 'fake_gateway',
        method: 'gopay',
        methodType: 'ewallet' as const,
        displayName: 'GoPay',
        supportedCurrencies: ['IDR'],
        minAmount: 1,
        maxAmount: 2_000_000,
        providerSpecificCode: 'GOPAY',
        metadata: { fakeScenario: 'redirect' },
      },
      {
        provider: 'fake_gateway',
        method: 'redirect',
        methodType: 'ewallet' as const,
        displayName: 'Online Payment (Redirect)',
        supportedCurrencies: ['IDR'],
        minAmount: 1,
        maxAmount: null,
        providerSpecificCode: 'REDIRECT',
        metadata: { fakeScenario: 'redirect' },
      },
    ];
  }
}
