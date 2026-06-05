/**
 * intentStatusHelper — shared helpers for computing intent payment status.
 *
 * Used by CreateGatewayPayment and ConfirmFakeGatewayPayment.
 */

import type { StandaloneIntentStatus } from '@northflow/payment-orchestration-core';

/**
 * computeIntentStatus — derive intent status from paid/due amounts.
 *
 * - amountPaid = 0              → requires_payment
 * - 0 < amountPaid < amountDue  → partially_paid
 * - amountPaid = amountDue      → paid
 * - amountPaid > amountDue      → overpaid
 */
export function computeIntentStatus(
  amountDue: number,
  amountPaid: number,
): StandaloneIntentStatus {
  if (amountPaid <= 0) return 'requires_payment';
  if (amountPaid > amountDue) return 'overpaid';
  if (amountPaid >= amountDue) return 'paid';
  return 'partially_paid';
}
