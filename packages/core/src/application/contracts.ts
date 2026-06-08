/**
 * contracts — input/output contracts for payment engine use cases.
 *
 * Framework-agnostic. No Express, no React, no external payable app deps.
 * These are the shapes that transport adapters (HTTP, gRPC, workers) translate
 * to and from.
 *
 * Phase 8A: contract-only definitions.
 * Phase 8B+: use cases will accept and return these types.
 */

import type { PaymentProviderAction } from '../providers/providerActions';
import type { PaymentIntentStatus } from './domain';

// ── Create Gateway Payment ────────────────────────────────────────────────────

export interface CreateGatewayPaymentInput {
  merchantId: string;
  paymentIntentId: string;
  provider: string;
  method: string;
  amount: number;
  idempotencyKey?: string | null;
  providerAccountId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface CreateGatewayPaymentOutput {
  transactionId: string;
  status: 'pending' | 'requires_action' | 'succeeded' | 'failed';
  providerReference: string | null;
  providerPaymentUrl: string | null;
  providerQrString: string | null;
  providerActions: PaymentProviderAction[];
  immediateSuccess: boolean;
  idempotentReplay: boolean;
}

// ── Payment Intent Status ─────────────────────────────────────────────────────

export interface GetPaymentIntentStatusInput {
  merchantId: string;
  intentId: string;
}

export interface PaymentIntentStatusOutput {
  intentId: string;
  status: PaymentIntentStatus;
  amountDue: number;
  amountPaid: number;
  amountRemaining: number;
  isTerminal: boolean;
  requiresAction: boolean;
  canRetryPayment: boolean;
}

// ── Refundability ─────────────────────────────────────────────────────────────

export interface GetRefundabilityInput {
  merchantId: string;
  intentId: string;
}

export interface RefundabilityOutput {
  canRefund: boolean;
  refundableAmount: number;
  reason: string | null;
}

// ── Create Payment Intent ─────────────────────────────────────────────────────

export interface CreatePaymentIntentInput {
  merchantId: string;
  sourceApp?: string | null;
  externalTenantId?: string | null;
  externalOutletId?: string | null;
  externalPayableType: string;
  externalPayableId: string;
  currency: string;
  amountDue: number;
  allowPartial?: boolean;
  expiresAt?: Date | null;
  metadata?: Record<string, unknown> | null;
  idempotencyKey?: string | null;
}
