/**
 * repositories — Phase 8C standalone repository port interfaces.
 *
 * Full set of repository contracts for the standalone payment orchestration service.
 * Concrete implementations live in apps/payment-orchestration-service/src/infrastructure/repositories/.
 *
 * Naming: use merchantId as primary owner identity (NOT AuraPoS tenantId).
 *
 * Phase 8C: interfaces defined; skeletons in service package.
 * Phase 8D: implementations wired to real Postgres DB.
 */

import type { PaymentMerchant } from '../domain/PaymentMerchant';
import type { PaymentProviderAccount } from '../domain/PaymentProviderAccount';
import type {
  StandalonePaymentIntentDTO,
  StandaloneIntentStatus,
} from '../domain/PaymentIntent';
import type {
  StandalonePaymentTransactionDTO,
  StandaloneTransactionStatus,
} from '../domain/PaymentTransaction';
import type {
  PaymentProviderEventDTO,
  ReserveProviderEventInput,
  PaymentProviderEventProcessingStatus,
} from '../domain/PaymentProviderEvent';
import type {
  PaymentIdempotencyKeyDTO,
  ReserveIdempotencyKeyInput,
  FindIdempotencyKeyInput,
  MarkIdempotencyCompletedInput,
  MarkIdempotencyFailedInput,
} from '../domain/PaymentIdempotencyKey';

// ── Merchant ──────────────────────────────────────────────────────────────────

export interface CreatePaymentMerchantInput {
  id: string;
  name: string;
  externalRef?: string | null;
  sourceApp?: string | null;
  legalName?: string | null;
  status?: 'active' | 'suspended' | 'disabled';
  metadata?: Record<string, unknown>;
}

export interface PaymentMerchantRepository {
  findById(id: string): Promise<PaymentMerchant | null>;
  findByExternalRef(input: {
    sourceApp: string;
    externalRef: string;
  }): Promise<PaymentMerchant | null>;
  create(input: CreatePaymentMerchantInput): Promise<PaymentMerchant>;
  updateStatus(
    id: string,
    status: PaymentMerchant['status'],
  ): Promise<PaymentMerchant>;
}

// ── Provider Account ──────────────────────────────────────────────────────────

export interface CreatePaymentProviderAccountInput {
  id: string;
  merchantId: string;
  provider: string;
  environment: 'test' | 'sandbox' | 'production';
  providerAccountRef?: string | null;
  credentialsRef?: string | null;
  publicConfig?: Record<string, unknown>;
  status?: 'active' | 'disabled';
  metadata?: Record<string, unknown>;
}

export interface PaymentProviderAccountRepository {
  findById(id: string, merchantId: string): Promise<PaymentProviderAccount | null>;
  findByMerchantAndProvider(
    merchantId: string,
    provider: string,
    environment?: string,
  ): Promise<PaymentProviderAccount | null>;
  create(input: CreatePaymentProviderAccountInput): Promise<PaymentProviderAccount>;
  updateStatus(
    id: string,
    merchantId: string,
    status: PaymentProviderAccount['status'],
  ): Promise<PaymentProviderAccount>;
}

// ── Payment Intent ────────────────────────────────────────────────────────────

export interface CreatePaymentIntentDbInput {
  id: string;
  merchantId: string;
  providerAccountId?: string | null;
  sourceApp?: string | null;
  externalTenantId?: string | null;
  externalOutletId?: string | null;
  externalLocationId?: string | null;
  externalPayableType: string;
  externalPayableId: string;
  amountDue: number;
  currency?: string;
  allowPartial?: boolean;
  expiresAt?: Date | null;
  metadata?: Record<string, unknown> | null;
}

export interface UpdateIntentTotalsInput {
  id: string;
  merchantId: string;
  amountPaid: number;
  amountRefunded: number;
  amountRemaining: number;
}

export interface UpdateIntentStatusInput {
  id: string;
  merchantId: string;
  status: StandaloneIntentStatus;
}

export interface FindByExternalPayableInput {
  merchantId: string;
  externalPayableType: string;
  externalPayableId: string;
  sourceApp?: string | null;
}

export interface FindExpiredActiveIntentsInput {
  now: Date;
  limit: number;
}

export interface ApplySucceededPaymentInput {
  transactionId: string;
  merchantId: string;
  intentId: string;
  amount: number;
}

export interface ApplySucceededPaymentResult {
  transaction: StandalonePaymentTransactionDTO;
  intent: StandalonePaymentIntentDTO;
  changed: boolean;
  alreadySucceeded: boolean;
}

export interface ApplySucceededRefundInput {
  refundTransactionId: string;
  merchantId: string;
  intentId: string;
  amount: number;
  providerReference?: string | null;
  rawProviderResponse?: Record<string, unknown> | null;
}

export interface ApplySucceededRefundResult {
  refundTransaction: StandalonePaymentTransactionDTO;
  intent: StandalonePaymentIntentDTO;
}

export interface PaymentIntentRepository {
  findById(id: string, merchantId: string): Promise<StandalonePaymentIntentDTO | null>;
  findByExternalPayable(
    input: FindByExternalPayableInput,
  ): Promise<StandalonePaymentIntentDTO | null>;
  create(input: CreatePaymentIntentDbInput): Promise<StandalonePaymentIntentDTO>;
  updateTotals(input: UpdateIntentTotalsInput): Promise<StandalonePaymentIntentDTO>;
  updateStatus(input: UpdateIntentStatusInput): Promise<StandalonePaymentIntentDTO>;
  findExpiredActive?(input: FindExpiredActiveIntentsInput): Promise<StandalonePaymentIntentDTO[]>;
}

// ── Payment Transaction ───────────────────────────────────────────────────────

export interface CreatePaymentTransactionInput {
  id: string;
  merchantId: string;
  intentId: string;
  providerAccountId?: string | null;
  provider: string;
  method: string;
  transactionType: string;
  direction: 'incoming' | 'outgoing';
  status: StandaloneTransactionStatus;
  amount: number;
  currency?: string;
  parentTransactionId?: string | null;
  providerReference?: string | null;
  providerEventId?: string | null;
  providerPaymentUrl?: string | null;
  providerQrString?: string | null;
  failureReason?: string | null;
  idempotencyKey?: string | null;
  metadata?: Record<string, unknown> | null;
  rawProviderResponse?: Record<string, unknown> | null;
  expiresAt?: Date | null;
}

export interface UpdateTransactionStatusInput {
  id: string;
  merchantId: string;
  status: StandaloneTransactionStatus;
  failureReason?: string | null;
  providerReference?: string | null;
  providerEventId?: string | null;
  idempotencyKey?: string | null;
  metadata?: Record<string, unknown> | null;
  rawProviderResponse?: Record<string, unknown> | null;
}

export interface MarkSucceededIfConfirmableInput {
  id: string;
  merchantId: string;
}

export interface MarkSucceededIfConfirmableResult {
  /**
   * The transaction row after the conditional update, or null if the row was
   * not found OR if the UPDATE matched no rows (status not confirmable).
   * Callers must reload via findById when changed === false.
   */
  transaction: StandalonePaymentTransactionDTO | null;
  /**
   * true  = the row was atomically transitioned to 'succeeded'.
   * false = no update happened (row not found, or status was not confirmable).
   */
  changed: boolean;
}

export interface FindStalePendingTransactionsInput {
  now: Date;
  limit: number;
}

export interface PaymentTransactionRepository {
  /**
   * Atomically transition a confirmable incoming transaction to succeeded and
   * increment the parent intent totals/status in one DB transaction.
   */
  applySucceededPayment?(
    input: ApplySucceededPaymentInput,
  ): Promise<ApplySucceededPaymentResult>;
  /**
   * Atomically mark a refund transaction succeeded and increment parent intent
   * amountRefunded/status in one DB transaction.
   */
  applySucceededRefund?(
    input: ApplySucceededRefundInput,
  ): Promise<ApplySucceededRefundResult>;
  findById(id: string, merchantId: string): Promise<StandalonePaymentTransactionDTO | null>;
  findByIntentId(
    intentId: string,
    merchantId: string,
  ): Promise<StandalonePaymentTransactionDTO[]>;
  findByProviderReference(
    provider: string,
    providerReference: string,
  ): Promise<StandalonePaymentTransactionDTO | null>;
  findByMerchantIdempotencyKey(
    merchantId: string,
    idempotencyKey: string,
  ): Promise<StandalonePaymentTransactionDTO | null>;
  create(input: CreatePaymentTransactionInput): Promise<StandalonePaymentTransactionDTO>;
  updateStatus(
    input: UpdateTransactionStatusInput,
  ): Promise<StandalonePaymentTransactionDTO>;
  sumSucceededRefundsByParent(parentTransactionId: string): Promise<number>;
  /**
   * Atomically set status = 'succeeded' only if current status is
   * 'requires_action' or 'pending'. Uses a conditional UPDATE … WHERE
   * status IN ('requires_action','pending') so concurrent confirms cannot
   * double-credit the intent.
   *
   * Returns { changed: true, transaction: <updated> } when the row was
   * transitioned, or { changed: false, transaction: null } when the WHERE
   * clause matched nothing (row not found, or status already terminal).
   * Callers should reload via findById to check the final status when
   * changed === false.
   */
  markSucceededIfConfirmable(
    input: MarkSucceededIfConfirmableInput,
  ): Promise<MarkSucceededIfConfirmableResult>;
  findStalePendingTransactions?(
    input: FindStalePendingTransactionsInput,
  ): Promise<StandalonePaymentTransactionDTO[]>;
}

// ── Provider Event ────────────────────────────────────────────────────────────

export interface FindStalePendingInput {
  olderThanMinutes: number;
  limit?: number;
}

export interface ReserveProviderEventResult {
  event: PaymentProviderEventDTO;
  reserved: boolean;
}

export interface PaymentProviderEventRepository {
  reserveEvent(input: ReserveProviderEventInput): Promise<PaymentProviderEventDTO>;
  reserveEventOrGet?(input: ReserveProviderEventInput): Promise<ReserveProviderEventResult>;
  claimForProcessing?(eventId: string): Promise<PaymentProviderEventDTO | null>;
  findByProviderEventId(
    provider: string,
    providerEventId: string,
  ): Promise<PaymentProviderEventDTO | null>;
  assignMerchant(eventId: string, merchantId: string): Promise<void>;
  markProcessed(eventId: string): Promise<void>;
  markFailed(eventId: string, error: string): Promise<void>;
  findStalePending(input: FindStalePendingInput): Promise<PaymentProviderEventDTO[]>;
}

// ── Idempotency ───────────────────────────────────────────────────────────────

export interface ReserveIdempotencyKeyResult {
  key: PaymentIdempotencyKeyDTO;
  reserved: boolean;
}

export interface PaymentIdempotencyRepository {
  reserve(input: ReserveIdempotencyKeyInput): Promise<PaymentIdempotencyKeyDTO>;
  reserveOrGet?(input: ReserveIdempotencyKeyInput): Promise<ReserveIdempotencyKeyResult>;
  find(input: FindIdempotencyKeyInput): Promise<PaymentIdempotencyKeyDTO | null>;
  markCompleted(input: MarkIdempotencyCompletedInput): Promise<void>;
  markFailed(input: MarkIdempotencyFailedInput): Promise<void>;
}
