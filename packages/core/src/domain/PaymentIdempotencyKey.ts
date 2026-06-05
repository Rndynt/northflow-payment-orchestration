/**
 * PaymentIdempotencyKey — standalone idempotency key DTO.
 *
 * Protects against duplicate requests for create-intent, create-payment, and refund
 * operations in the standalone payment orchestration service.
 *
 * Phase 8C: standalone domain type. Mirrors `payment_orchestration_idempotency_keys` schema.
 */

/**
 * Status of an idempotency key reservation.
 *
 * - `processing`  — request is in-flight; duplicate calls should wait/return 202
 * - `completed`   — request succeeded; replay returns the stored response snapshot
 * - `failed`      — request failed; replay may retry depending on policy
 */
export type IdempotencyKeyStatus = 'processing' | 'completed' | 'failed';

/**
 * PaymentIdempotencyKeyDTO — the read model for an idempotency key entry.
 */
export interface PaymentIdempotencyKeyDTO {
  id: string;
  merchantId: string;
  scope: string;
  idempotencyKey: string;
  requestHash: string;
  responseSnapshot: Record<string, unknown> | null;
  resourceType: string | null;
  resourceId: string | null;
  status: IdempotencyKeyStatus;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date | null;
}

/**
 * ReserveIdempotencyKeyInput — input for reserving an idempotency slot.
 */
export interface ReserveIdempotencyKeyInput {
  id: string;
  merchantId: string;
  scope: string;
  idempotencyKey: string;
  requestHash: string;
  expiresAt?: Date | null;
}

/**
 * FindIdempotencyKeyInput — input for looking up an existing key.
 */
export interface FindIdempotencyKeyInput {
  merchantId: string;
  scope: string;
  idempotencyKey: string;
}

/**
 * MarkIdempotencyCompletedInput — input for marking a key completed with response.
 */
export interface MarkIdempotencyCompletedInput {
  merchantId: string;
  scope: string;
  idempotencyKey: string;
  responseSnapshot: Record<string, unknown>;
  resourceType?: string | null;
  resourceId?: string | null;
}

/**
 * MarkIdempotencyFailedInput — input for marking a key failed.
 */
export interface MarkIdempotencyFailedInput {
  merchantId: string;
  scope: string;
  idempotencyKey: string;
  error: string;
}
