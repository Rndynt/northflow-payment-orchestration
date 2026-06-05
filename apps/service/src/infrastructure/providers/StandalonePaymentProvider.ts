/**
 * StandalonePaymentProvider — provider runtime contract for payment-orchestration-service.
 *
 * This contract is intentionally local to the standalone service runtime. Core exposes
 * transport/domain contracts; concrete provider HTTP/webhook/polling adapters live here
 * so they can be extracted without importing AuraPoS embedded payment providers.
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

export interface StandalonePaymentProvider {
  readonly providerCode: string;
  readonly capabilities: PaymentProviderCapabilities;
  createPayment(input: StandaloneCreatePaymentInput): Promise<StandaloneProviderResult>;
  parseWebhook?(input: StandaloneProviderWebhookInput): StandaloneParsedProviderWebhook;
  getPaymentStatus?(input: StandaloneProviderStatusInput): Promise<StandaloneProviderStatusResult>;
}
