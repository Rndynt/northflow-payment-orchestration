/**
 * ports — abstract repository interfaces for the standalone payment engine.
 *
 * "Ports" in hexagonal architecture define the boundaries between the
 * core domain/application logic and the infrastructure (DB, secrets, etc.).
 * Concrete implementations live in payment-orchestration-service infrastructure layer.
 *
 * Phase 8A: interface definitions only.
 * Phase 8C: implementations wired to a real Postgres DB in payment-orchestration-service.
 */

import type { PaymentMerchant } from '../domain/PaymentMerchant';
import type {
  PaymentIntentDTO,
  CreatePaymentIntentRecordInput,
} from '../domain/PaymentIntent';
import type { PaymentTransactionDTO } from '../domain/PaymentTransaction';
import type { PaymentProviderAccount } from '../domain/PaymentProviderAccount';

// ── Merchant ──────────────────────────────────────────────────────────────────

export interface IPaymentMerchantRepository {
  findById(merchantId: string): Promise<PaymentMerchant | null>;
}

// ── Intent ────────────────────────────────────────────────────────────────────

export interface PaymentIntentRepositoryPort {
  create(input: CreatePaymentIntentRecordInput): Promise<PaymentIntentDTO>;
  findById(intentId: string, merchantId: string): Promise<PaymentIntentDTO | null>;
  findByIdempotencyKey(
    merchantId: string,
    key: string,
  ): Promise<PaymentIntentDTO | null>;
}

/** @deprecated Use PaymentIntentRepositoryPort instead. */
export type IStandalonePaymentIntentRepository = PaymentIntentRepositoryPort;

// ── Transaction ───────────────────────────────────────────────────────────────

export interface PaymentTransactionRepositoryPort {
  findByIntentId(
    intentId: string,
    merchantId: string,
  ): Promise<PaymentTransactionDTO[]>;
  findByIdempotencyKey(
    merchantId: string,
    key: string,
  ): Promise<PaymentTransactionDTO | null>;
}

/** @deprecated Use PaymentTransactionRepositoryPort instead. */
export type IStandalonePaymentTransactionRepository = PaymentTransactionRepositoryPort;

// ── Provider Account ──────────────────────────────────────────────────────────

export interface IPaymentProviderAccountRepository {
  findById(id: string, merchantId: string): Promise<PaymentProviderAccount | null>;
  findByMerchantAndProvider(
    merchantId: string,
    provider: string,
  ): Promise<PaymentProviderAccount | null>;
}
