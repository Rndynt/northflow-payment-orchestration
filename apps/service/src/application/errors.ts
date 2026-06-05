/**
 * errors — stable public error-code normalization for standalone operations.
 *
 * Keeps provider/runtime errors from leaking implementation details while preserving
 * stable codes for callers, readiness checks, and worker summaries.
 *
 * Phase 8K: all public error codes frozen. Add new codes to PAYMENT_ORCHESTRATION_ERROR_CODES
 * and KNOWN_CODES together — never orphan a code in one list only.
 */

export const PAYMENT_ORCHESTRATION_ERROR_CODES = [
  // Validation
  'VALIDATION_ERROR',
  // Resource not found
  'MERCHANT_NOT_FOUND',
  'INTENT_NOT_FOUND',
  'TRANSACTION_NOT_FOUND',
  'PROVIDER_ACCOUNT_NOT_FOUND',
  // Provider account errors
  'PROVIDER_ACCOUNT_REQUIRED',
  'PROVIDER_ACCOUNT_DISABLED',
  'PROVIDER_ACCOUNT_PROVIDER_MISMATCH',
  // Provider runtime errors
  'PROVIDER_NOT_AVAILABLE',
  'PROVIDER_HTTP_CLIENT_UNCONFIGURED',
  'PROVIDER_CREDENTIALS_UNAVAILABLE',
  // Webhook errors
  'WEBHOOK_PROVIDER_NOT_SUPPORTED',
  'WEBHOOK_SIGNATURE_INVALID',
  'WEBHOOK_SIGNATURE_MISSING',
  'WEBHOOK_BODY_INVALID',
  'WEBHOOK_SECRET_REQUIRED',
  // Payment flow errors
  'OVERPAYMENT_REJECTED',
  // Idempotency errors
  'IDEMPOTENCY_IN_PROGRESS',
  'IDEMPOTENCY_CONFLICT',
  'IDEMPOTENCY_PREVIOUSLY_FAILED',
  // Operations / repository
  'OPERATIONS_REPOSITORY_UNSUPPORTED',
  // Forbidden (production-only guard)
  'FORBIDDEN_IN_PRODUCTION',
] as const;

export type PaymentOrchestrationErrorCode =
  | typeof PAYMENT_ORCHESTRATION_ERROR_CODES[number]
  | 'PROVIDER_ACCOUNT_ENVIRONMENT_UNSUPPORTED'
  | 'PROVIDER_ENVIRONMENT_UNSUPPORTED'
  | 'NOT_FOUND'
  | 'INTERNAL_ERROR';

const KNOWN_CODES = new Set<string>([
  ...PAYMENT_ORCHESTRATION_ERROR_CODES,
  'PROVIDER_ACCOUNT_ENVIRONMENT_UNSUPPORTED',
  'PROVIDER_ENVIRONMENT_UNSUPPORTED',
  'NOT_FOUND',
]);

export interface NormalizedPaymentOrchestrationError {
  code: PaymentOrchestrationErrorCode;
  message: string;
  statusCode: number;
}

export function normalizePaymentOrchestrationError(error: unknown): NormalizedPaymentOrchestrationError {
  const maybe = error as { code?: unknown; message?: unknown; statusCode?: unknown; status?: unknown } | null;
  const rawCode = typeof maybe?.code === 'string' ? maybe.code : null;
  const code = (rawCode && KNOWN_CODES.has(rawCode) ? rawCode : 'INTERNAL_ERROR') as PaymentOrchestrationErrorCode;
  const statusCode = typeof maybe?.statusCode === 'number'
    ? maybe.statusCode
    : typeof maybe?.status === 'number'
      ? maybe.status
      : code === 'INTERNAL_ERROR'
        ? 500
        : 400;
  const message = typeof maybe?.message === 'string' && maybe.message.trim().length > 0
    ? maybe.message
    : 'Payment orchestration error.';

  return { code, message, statusCode };
}
