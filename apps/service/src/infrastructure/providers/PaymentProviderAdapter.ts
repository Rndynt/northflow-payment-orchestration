/**
 * PaymentProviderAdapter — provider runtime contract for payment-orchestration-service.
 *
 * This contract is intentionally local to the service runtime. Core exposes
 * transport/domain contracts; concrete provider HTTP/webhook/polling adapters live here
 * so they can be extracted without importing legacy embedded payment providers.
 *
 * Phase 8F (Parity): added cancelPayment / refundPayment optional methods and their
 * associated input/result types for Refund + Void operation parity with the legacy payment engine.
 */

import type {
  PaymentProviderAccount,
  PaymentProviderCapabilities,
} from '@northflow/payment-orchestration-core';

export type ProviderPaymentStatus =
  | 'requires_action'
  | 'succeeded'
  | 'failed'
  | 'pending'
  | 'cancelled'
  | 'expired';

/** @deprecated Use ProviderPaymentStatus instead. */
export type StandaloneProviderStatus = ProviderPaymentStatus;

export interface ProviderCreatePaymentInput {
  intentId: string;
  amount: number;
  currency: string;
  method: string;
  providerAccount: PaymentProviderAccount | null;
  metadata?: Record<string, unknown> | null;
}

/** @deprecated Use ProviderCreatePaymentInput instead. */
export type StandaloneCreatePaymentInput = ProviderCreatePaymentInput;

export interface ProviderPaymentResult {
  status: ProviderPaymentStatus;
  providerReference: string;
  providerPaymentUrl: string | null;
  providerQrString: string | null;
  rawProviderResponse: Record<string, unknown>;
  failureReason: string | null;
  expiresAt: Date | null;
}

/** @deprecated Use ProviderPaymentResult instead. */
export type StandaloneProviderResult = ProviderPaymentResult;

export interface ProviderWebhookInput {
  headers: Record<string, string | string[] | undefined>;
  rawBody: Buffer | Record<string, unknown>;
}

/** @deprecated Use ProviderWebhookInput instead. */
export type StandaloneProviderWebhookInput = ProviderWebhookInput;

export interface ParsedProviderWebhook {
  providerEventId: string;
  providerReference: string | null;
  eventType: string;
  status: ProviderPaymentStatus | 'ignored';
  rawPayload: Record<string, unknown>;
}

/** @deprecated Use ParsedProviderWebhook instead. */
export type StandaloneParsedProviderWebhook = ParsedProviderWebhook;

export interface ProviderStatusInput {
  transactionId: string;
  providerReference: string | null;
  providerAccount: PaymentProviderAccount | null;
  rawProviderResponse?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
}

/** @deprecated Use ProviderStatusInput instead. */
export type StandaloneProviderStatusInput = ProviderStatusInput;

export interface ProviderStatusResult {
  status: ProviderPaymentStatus | 'ignored';
  providerReference: string | null;
  rawProviderResponse: Record<string, unknown>;
  failureReason: string | null;
}

/** @deprecated Use ProviderStatusResult instead. */
export type StandaloneProviderStatusResult = ProviderStatusResult;

// ── Cancel (Void) contract ────────────────────────────────────────────────────

export interface ProviderCancelPaymentInput {
  transactionId: string;
  providerReference: string | null;
  providerAccount: PaymentProviderAccount | null;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
}

/** @deprecated Use ProviderCancelPaymentInput instead. */
export type StandaloneProviderCancelInput = ProviderCancelPaymentInput;

export interface ProviderCancelPaymentResult {
  status: 'cancelled' | 'failed';
  providerReference: string | null;
  rawProviderResponse: Record<string, unknown>;
  failureReason: string | null;
}

/** @deprecated Use ProviderCancelPaymentResult instead. */
export type StandaloneProviderCancelResult = ProviderCancelPaymentResult;

// ── Refund contract ───────────────────────────────────────────────────────────

export interface ProviderRefundPaymentInput {
  transactionId: string;
  providerReference: string | null;
  providerAccount: PaymentProviderAccount | null;
  amount: number;
  currency: string;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
}

/** @deprecated Use ProviderRefundPaymentInput instead. */
export type StandaloneProviderRefundInput = ProviderRefundPaymentInput;

export interface ProviderRefundPaymentResult {
  status: 'succeeded' | 'failed' | 'pending';
  providerReference: string | null;
  rawProviderResponse: Record<string, unknown>;
  failureReason: string | null;
}

/** @deprecated Use ProviderRefundPaymentResult instead. */
export type StandaloneProviderRefundResult = ProviderRefundPaymentResult;

// ── S7.5: Payment method capability contract ──────────────────────────────────

import type { ProviderPaymentMethodCapability } from '@northflow/payment-orchestration-core';

// ── Provider adapter interface ────────────────────────────────────────────────

export interface PaymentProviderAdapter {
  readonly providerCode: string;
  readonly capabilities: PaymentProviderCapabilities;
  createPayment(input: ProviderCreatePaymentInput): Promise<ProviderPaymentResult>;
  parseWebhook?(input: ProviderWebhookInput): ParsedProviderWebhook;
  getPaymentStatus?(input: ProviderStatusInput): Promise<ProviderStatusResult>;
  /**
   * Cancel (void) a payment that is still in a pending/requires_action state.
   * If not implemented, only explicit offline providers such as `manual` may
   * be directly cancelled. Gateway/sandbox providers must return unsupported.
   */
  cancelPayment?(input: ProviderCancelPaymentInput): Promise<ProviderCancelPaymentResult>;
  /**
   * Refund a succeeded payment (fully or partially).
   * If not implemented, only explicit offline providers such as `manual` may
   * be refunded directly. Gateway/sandbox providers must return unsupported.
   */
  refundPayment?(input: ProviderRefundPaymentInput): Promise<ProviderRefundPaymentResult>;
  /**
   * S7.5 Layer 1: Return static adapter capability catalog.
   * Declares which payment methods this provider/adapter can support in general.
   */
  getPaymentMethodCapabilities?(): ProviderPaymentMethodCapability[];
  /**
   * S7.5 Layer 2: Optional live sync from provider API.
   * If the provider supports listing enabled payment channels for a merchant account,
   * implement this hook. Returns normalized capabilities (merged with Layer 1).
   * Must not expose provider credentials. Must be idempotent.
   */
  syncProviderAccountMethods?(providerAccount: PaymentProviderAccount): Promise<ProviderPaymentMethodCapability[]>;
}

/** @deprecated Use PaymentProviderAdapter instead. */
export type StandalonePaymentProvider = PaymentProviderAdapter;
