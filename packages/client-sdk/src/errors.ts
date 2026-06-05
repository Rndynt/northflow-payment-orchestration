/**
 * errors — typed error classes for payment-orchestration-client-sdk.
 *
 * Thrown by client methods on non-2xx HTTP responses or transport failures.
 * No dependency on @northflow/payment-orchestration-core — self-contained for portability.
 *
 * Phase 8B: primary names are now PaymentOrchestration*. PaymentEngine* aliases are
 * deprecated and will be removed in a future major version.
 * Phase 8K: added `details` field to PaymentOrchestrationClientError for frozen error envelope.
 */

/**
 * PaymentOrchestrationClientError — thrown when the service returns a non-2xx response.
 *
 * Carries:
 * - `status`       — HTTP status code (e.g. 422, 404, 500)
 * - `code`         — machine-readable error code from the service (if available)
 * - `details`      — structured details from the service error envelope (e.g. validation fields), or null
 * - `serviceError` — raw error body from the service (safe to log, no secrets)
 */
export class PaymentOrchestrationClientError extends Error {
  public readonly status: number;
  public readonly code: string | undefined;
  public readonly details: unknown;
  public readonly serviceError: unknown;

  constructor(message: string, status: number, code?: string, details?: unknown, serviceError?: unknown) {
    super(message);
    this.name = 'PaymentOrchestrationClientError';
    this.status = status;
    this.code = code;
    this.details = details ?? null;
    this.serviceError = serviceError;
  }
}

/**
 * PaymentOrchestrationNetworkError — thrown when the HTTP request fails at network level.
 *
 * Examples: DNS failure, connection refused, timeout.
 */
export class PaymentOrchestrationNetworkError extends Error {
  public readonly cause: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'PaymentOrchestrationNetworkError';
    this.cause = cause;
  }
}

// ── Deprecated aliases — Phase 8B ─────────────────────────────────────────────

/** @deprecated Use PaymentOrchestrationClientError instead. */
export const PaymentEngineClientError = PaymentOrchestrationClientError;
/** @deprecated Use PaymentOrchestrationNetworkError instead. */
export const PaymentEngineNetworkError = PaymentOrchestrationNetworkError;
