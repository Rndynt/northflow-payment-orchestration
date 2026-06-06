/**
 * StandalonePaymentProvider — provider runtime contract for payment-orchestration-service.
 *
 * This contract is intentionally local to the standalone service runtime. Core exposes
 * transport/domain contracts; concrete provider HTTP/webhook/polling adapters live here
 * so they can be extracted without importing AuraPoS embedded payment providers.
 *
 * Phase 8F (Parity): added cancelPayment / refundPayment optional methods and their
 * associated input/result types for Refund + Void operation parity with legacy AuraPoS.
 */

import type {
  PaymentProviderAccount,
  PaymentProviderCapabilities,
} from '@northflow/payment-orchestration-core';

export type StandaloneProviderStatus =
  | 'requires_action'
  | 'succeeded'
  | 'failed'
  | 'pending'
  | 'cancelled'
  | 'expired';

export interface StandaloneCreatePaymentInput {
  intentId: string;
  amount: number;
  currency: string;
  method: string;
  providerAccount: PaymentProviderAccount | null;
  metadata?: Record<string, unknown> | null;
}

export interface StandaloneProviderResult {
  status: StandaloneProviderStatus;
  providerReference: string;
  providerPaymentUrl: string | null;
  providerQrString: string | null;
  rawProviderResponse: Record<string, unknown>;
  failureReason: string | null;
  expiresAt: Date | null;
}

export interface StandaloneProviderWebhookInput {
  headers: Record<string, string | string[] | undefined>;
  rawBody: Buffer | Record<string, unknown>;
}

export interface StandaloneParsedProviderWebhook {
  providerEventId: string;
  providerReference: string | null;
  eventType: string;
  status: StandaloneProviderStatus | 'ignored';
  rawPayload: Record<string, unknown>;
}

export interface StandaloneProviderStatusInput {
  transactionId: string;
  providerReference: string | null;
  providerAccount: PaymentProviderAccount | null;
  rawProviderResponse?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
}

export interface StandaloneProviderStatusResult {
  status: StandaloneProviderStatus | 'ignored';
  providerReference: string | null;
  rawProviderResponse: Record<string, unknown>;
  failureReason: string | null;
}

// ── Phase 8F: Cancel (Void) contract ─────────────────────────────────────────

export interface StandaloneProviderCancelInput {
  transactionId: string;
  providerReference: string | null;
  providerAccount: PaymentProviderAccount | null;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface StandaloneProviderCancelResult {
  status: 'cancelled' | 'failed';
  providerReference: string | null;
  rawProviderResponse: Record<string, unknown>;
  failureReason: string | null;
}

// ── Phase 8F: Refund contract ────────────────────────────────────────────────

export interface StandaloneProviderRefundInput {
  transactionId: string;
  providerReference: string | null;
  providerAccount: PaymentProviderAccount | null;
  amount: number;
  currency: string;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface StandaloneProviderRefundResult {
  status: 'succeeded' | 'failed' | 'pending';
  providerReference: string | null;
  rawProviderResponse: Record<string, unknown>;
  failureReason: string | null;
}

// ── Provider interface ────────────────────────────────────────────────────────

export interface StandalonePaymentProvider {
  readonly providerCode: string;
  readonly capabilities: PaymentProviderCapabilities;
  createPayment(input: StandaloneCreatePaymentInput): Promise<StandaloneProviderResult>;
  parseWebhook?(input: StandaloneProviderWebhookInput): StandaloneParsedProviderWebhook;
  getPaymentStatus?(input: StandaloneProviderStatusInput): Promise<StandaloneProviderStatusResult>;
  /**
   * Cancel (void) a payment that is still in a pending/requires_action state.
   * If not implemented, only explicit offline providers such as `manual` may
   * be directly cancelled. Gateway/sandbox providers must return unsupported.
   */
  cancelPayment?(input: StandaloneProviderCancelInput): Promise<StandaloneProviderCancelResult>;
  /**
   * Refund a succeeded payment (fully or partially).
   * If not implemented, only explicit offline providers such as `manual` may
   * be refunded directly. Gateway/sandbox providers must return unsupported.
   */
  refundPayment?(input: StandaloneProviderRefundInput): Promise<StandaloneProviderRefundResult>;
}
