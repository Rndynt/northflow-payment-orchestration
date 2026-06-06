/**
 * @northflow/payment-orchestration-core — Phase 8C Public API
 *
 * Framework-agnostic payment orchestration contracts:
 * - Domain types (merchantId-centric, not tenantId-centric)
 * - Application input/output contracts
 * - Provider interfaces
 * - Port (repository) interfaces
 * - Error types
 *
 * No Express. No React. No AuraPoS session middleware. No POS order deps.
 * No direct environment variable reads.
 *
 * Consumers:
 *   - apps/payment-orchestration-service  (Phase 8D+)
 *   - future external services
 *   - tests
 *   - apps/api (Phase 8E+ via client SDK)
 */

// ── Domain ────────────────────────────────────────────────────────────────────

export type { PaymentScope } from './domain/PaymentScope';
export { createAuraPosPaymentScope } from './domain/PaymentScope';

export type { PaymentMerchant, ExternalPayableRef } from './domain/PaymentMerchant';

export type {
  PaymentProviderAccount,
  PaymentProviderAccountEnvironment,
  PaymentProviderAccountStatus,
} from './domain/PaymentProviderAccount';

export type {
  StandalonePaymentIntentDTO,
  CreateStandalonePaymentIntentInput,
  StandaloneIntentStatus,
} from './domain/PaymentIntent';

export type {
  StandalonePaymentTransactionDTO,
  StandaloneTransactionStatus,
} from './domain/PaymentTransaction';

export type {
  PaymentProviderEventDTO,
  PaymentProviderEventProcessingStatus,
  ReserveProviderEventInput,
} from './domain/PaymentProviderEvent';

export type {
  PaymentIdempotencyKeyDTO,
  IdempotencyKeyStatus,
  ReserveIdempotencyKeyInput,
  FindIdempotencyKeyInput,
  MarkIdempotencyCompletedInput,
  MarkIdempotencyFailedInput,
} from './domain/PaymentIdempotencyKey';

export { PaymentEngineError } from './domain/PaymentErrors';
export type { PaymentEngineErrorCode } from './domain/PaymentErrors';

// ── Application Contracts ─────────────────────────────────────────────────────

export type {
  CreateGatewayPaymentInput,
  CreateGatewayPaymentOutput,
  GetPaymentIntentStatusInput,
  PaymentIntentStatusOutput,
  GetRefundabilityInput,
  RefundabilityOutput,
  CreatePaymentIntentInput,
} from './application/contracts';

// ── Port Interfaces (Phase 8A legacy — superseded by repositories.ts) ─────────

export type {
  IPaymentMerchantRepository,
  IStandalonePaymentIntentRepository,
  IStandalonePaymentTransactionRepository,
  IPaymentProviderAccountRepository,
} from './application/ports';

// ── Repository Interfaces (Phase 8C — full standalone boundary) ───────────────

export type {
  PaymentMerchantRepository,
  CreatePaymentMerchantInput,
  PaymentProviderAccountRepository,
  CreatePaymentProviderAccountInput,
  PaymentIntentRepository,
  ApplySucceededPaymentInput,
  ApplySucceededPaymentResult,
  ApplySucceededRefundInput,
  ApplySucceededRefundResult,
  CreatePaymentIntentDbInput,
  UpdateIntentTotalsInput,
  UpdateIntentStatusInput,
  FindByExternalPayableInput,
  PaymentTransactionRepository,
  CreatePaymentTransactionInput,
  UpdateTransactionStatusInput,
  MarkSucceededIfConfirmableInput,
  MarkSucceededIfConfirmableResult,
  PaymentProviderEventRepository,
  ReserveProviderEventResult,
  FindStalePendingInput,
  PaymentIdempotencyRepository,
  ReserveIdempotencyKeyResult,
} from './application/repositories';

// ── Provider Action Types ─────────────────────────────────────────────────────

export type {
  PaymentProviderAction,
  PaymentProviderActionType,
  PaymentProviderActionDescriptor,
} from './providers/providerActions';

export type { PaymentProviderCapabilities } from './providers/providerCapabilities';

// ── S1: API Client Registry ───────────────────────────────────────────────────

export type {
  ApiClientDTO,
  ClientCredentialDTO,
  ClientMerchantAccessDTO,
  ApiClientStatus,
  ClientCredentialStatus,
  ClientMerchantAccessStatus,
} from './domain/ApiClient';

export type {
  ApiClientRepository,
  CreateApiClientInput,
  ClientCredentialRepository,
  CreateClientCredentialInput,
  ClientMerchantAccessRepository,
  CreateClientMerchantAccessInput,
} from './application/repositories';
