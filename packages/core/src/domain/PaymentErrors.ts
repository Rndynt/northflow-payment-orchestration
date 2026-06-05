/**
 * PaymentErrors — standalone payment engine error types.
 *
 * These are framework-agnostic and safe to use from any context:
 * apps, tests, service workers, and Node.js services.
 *
 * Designed for Phase 8A+. Not tied to AuraPoS tenantId or Express.
 */

/**
 * Canonical error codes for the standalone payment engine.
 *
 * Mapped to HTTP status codes at the transport layer:
 *   UNAUTHORIZED           → 401
 *   INTENT_NOT_FOUND       → 404
 *   MERCHANT_NOT_FOUND     → 404
 *   TRANSACTION_NOT_FOUND  → 404
 *   INTENT_NOT_PAYABLE     → 422
 *   INTENT_EXPIRED         → 422
 *   AMOUNT_EXCEEDS_REMAINING → 422
 *   INVALID_AMOUNT         → 422
 *   UNSUPPORTED_PROVIDER   → 422
 *   PROVIDER_NOT_CONFIGURED→ 422
 *   TRANSACTION_NOT_REVERSIBLE → 422
 *   DUPLICATE_IDEMPOTENCY_KEY → 409
 *   PROVIDER_ERROR         → 502
 *   INTERNAL_ERROR         → 500
 */
export type PaymentEngineErrorCode =
  | 'INTENT_NOT_FOUND'
  | 'INTENT_NOT_PAYABLE'
  | 'INTENT_EXPIRED'
  | 'AMOUNT_EXCEEDS_REMAINING'
  | 'INVALID_AMOUNT'
  | 'UNSUPPORTED_PROVIDER'
  | 'PROVIDER_ERROR'
  | 'PROVIDER_NOT_CONFIGURED'
  | 'TRANSACTION_NOT_FOUND'
  | 'TRANSACTION_NOT_REVERSIBLE'
  | 'DUPLICATE_IDEMPOTENCY_KEY'
  | 'MERCHANT_NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'INTERNAL_ERROR';

/**
 * PaymentEngineError — typed error thrown by payment engine use cases.
 *
 * Carries a machine-readable `code` for programmatic handling and an
 * optional `details` bag for structured debugging context.
 *
 * Never include credentials, secrets, or raw provider error bodies in `details`.
 */
export class PaymentEngineError extends Error {
  public readonly code: PaymentEngineErrorCode;
  public readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    code: PaymentEngineErrorCode,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'PaymentEngineError';
    this.code = code;
    this.details = details;
  }
}
