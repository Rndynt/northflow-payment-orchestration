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
  StandalonePaymentIntentDTO,
  CreateStandalonePaymentIntentInput,
} from '../domain/PaymentIntent';
import type { StandalonePaymentTransactionDTO } from '../domain/PaymentTransaction';
import type { PaymentProviderAccount } from '../domain/PaymentProviderAccount';

// ── Merchant ──────────────────────────────────────────────────────────────────

export interface IPaymentMerchantRepository {
  findById(merchantId: string): Promise<PaymentMerchant | null>;
}

// ── Intent ────────────────────────────────────────────────────────────────────

export interface IStandalonePaymentIntentRepository {
  create(input: CreateStandalonePaymentIntentInput): Promise<StandalonePaymentIntentDTO>;
  findById(intentId: string, merchantId: string): Promise<StandalonePaymentIntentDTO | null>;
  findByIdempotencyKey(
    merchantId: string,
    key: string,
  ): Promise<StandalonePaymentIntentDTO | null>;
}

// ── Transaction ───────────────────────────────────────────────────────────────

export interface IStandalonePaymentTransactionRepository {
  findByIntentId(
    intentId: string,
    merchantId: string,
  ): Promise<StandalonePaymentTransactionDTO[]>;
  findByIdempotencyKey(
    merchantId: string,
    key: string,
  ): Promise<StandalonePaymentTransactionDTO | null>;
}

// ── Provider Account ──────────────────────────────────────────────────────────

export interface IPaymentProviderAccountRepository {
  findById(id: string, merchantId: string): Promise<PaymentProviderAccount | null>;
  findByMerchantAndProvider(
    merchantId: string,
    provider: string,
  ): Promise<PaymentProviderAccount | null>;
}
