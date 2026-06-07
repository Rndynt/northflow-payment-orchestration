import type { PaymentIntentStatus, PaymentIntentDTO } from '@northflow/payment-orchestration-core';

export function computeIntentStatus(amountDue: number, amountPaid: number): PaymentIntentStatus {
  if (amountPaid <= 0) return 'requires_payment';
  if (amountPaid > amountDue) return 'overpaid';
  if (amountPaid >= amountDue) return 'paid';
  return 'partially_paid';
}

export function computeIntentStatusAfterRefund(intent: PaymentIntentDTO, amountRefunded: number): PaymentIntentStatus {
  if (amountRefunded > 0 && intent.amountPaid > 0 && amountRefunded >= intent.amountPaid) return 'refunded';
  return intent.status;
}

export function assertIntentPayable(intent: PaymentIntentDTO, now: Date = new Date()): void {
  if (intent.expiresAt && intent.expiresAt.getTime() <= now.getTime()) {
    throw Object.assign(new Error('Payment intent has expired.'), { statusCode: 422, code: 'INTENT_EXPIRED' });
  }
  if (intent.status !== 'requires_payment' && intent.status !== 'partially_paid') {
    throw Object.assign(new Error(`Payment intent status '${intent.status}' is not payable.`), {
      statusCode: 422,
      code: 'INTENT_NOT_PAYABLE',
    });
  }
}

export function assertPaymentAmountAllowed(intent: PaymentIntentDTO, amount: number): void {
  if (amount > intent.amountRemaining) {
    throw Object.assign(
      new Error(`Payment amount (${amount}) exceeds remaining amount (${intent.amountRemaining}). Overpayment is not allowed.`),
      { statusCode: 422, code: 'OVERPAYMENT_REJECTED' },
    );
  }
  if (!intent.allowPartial && amount !== intent.amountRemaining) {
    throw Object.assign(
      new Error('Partial payments are not allowed for this payment intent.'),
      { statusCode: 422, code: 'PARTIAL_PAYMENT_NOT_ALLOWED' },
    );
  }
}
