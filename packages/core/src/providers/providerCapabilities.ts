/**
 * providerCapabilities — capability contract for standalone payment providers.
 *
 * Phase 8A: standalone definition for the payment-orchestration-core package.
 * Phase 8B: extended with optional fields to align with embedded ProviderCapabilities,
 *           enabling full round-trip through PaymentProviderCoreAdapter without data loss.
 */

/**
 * PaymentProviderCapabilities — declares what a provider can do.
 *
 * Used by use cases to validate operations before calling provider methods.
 * For example: asserting `supportsWebhook=true` before registering a webhook URL.
 *
 * Field naming convention:
 * - `supports*` — provider can perform or receive that action/event.
 * - `can*`      — provider may return that outcome from createPayment().
 *
 * Optional fields (Phase 8B additions):
 * - `supportsMultiplePartialRefund` — provider allows multiple partial refunds on one transaction.
 * - `canReturnImmediateSuccess`     — provider may settle synchronously from createPayment().
 * - `canReturnImmediateFailure`     — provider may reject synchronously from createPayment().
 */
export interface PaymentProviderCapabilities {
  supportsRefund: boolean;
  supportsCancel: boolean;
  supportsPolling: boolean;
  supportsWebhook: boolean;
  /**
   * Methods this provider accepts (e.g. ['qris', 'bank_transfer', 'ewallet']).
   * Empty array = method list not declared (use provider-specific docs).
   */
  supportedMethods: string[];
  supportsRedirect: boolean;
  supportsQr: boolean;
  supportsVa: boolean;
  supportsPaymentCode: boolean;
  supportsPartialRefund: boolean;
  /** Provider allows multiple partial refunds on the same transaction. Phase 8B optional field. */
  supportsMultiplePartialRefund?: boolean;
  /** Provider may return status='succeeded' synchronously from createPayment(). Phase 8B optional field. */
  canReturnImmediateSuccess?: boolean;
  /** Provider may return status='failed' synchronously from createPayment(). Phase 8B optional field. */
  canReturnImmediateFailure?: boolean;
}
