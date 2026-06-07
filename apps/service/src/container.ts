/**
 * container — dependency injection container for payment-orchestration-service.
 *
 * Phase 8D: DB connection, repositories, provider registry, and use cases wired.
 * Phase 8F: RefundPaymentTransaction and VoidPaymentTransaction wired.
 * Phase S1: ApiClient, ClientCredential, ClientMerchantAccess repos added (optional authRepos).
 * Phase S9.1: CreateCredential, ListCredentials, RevokeCredential, RotateCredential use cases.
 * Phase S9.2: InMemoryRateLimiterStore wired; rateLimiter available to app.ts and auth middleware.
 *
 * No legacy session/tenant middleware.
 * No POS order domain deps.
 */

import type { PaymentOrchestrationServiceConfig } from './config/env.ts';
import { createPoDb } from './infrastructure/db.ts';
import type { PoDb } from './infrastructure/db.ts';
import { createProviderRegistry } from './infrastructure/providers/providerRegistry.ts';
import type { ProviderRegistry } from './infrastructure/providers/providerRegistry.ts';
import { DrizzlePaymentMerchantRepository } from './infrastructure/repositories/DrizzlePaymentMerchantRepository.ts';
import { DrizzlePaymentProviderAccountRepository } from './infrastructure/repositories/DrizzlePaymentProviderAccountRepository.ts';
import { DrizzlePaymentIntentRepository } from './infrastructure/repositories/DrizzlePaymentIntentRepository.ts';
import { DrizzlePaymentTransactionRepository } from './infrastructure/repositories/DrizzlePaymentTransactionRepository.ts';
import { DrizzlePaymentProviderEventRepository } from './infrastructure/repositories/DrizzlePaymentProviderEventRepository.ts';
import { DrizzlePaymentIdempotencyRepository } from './infrastructure/repositories/DrizzlePaymentIdempotencyRepository.ts';
import { DrizzleApiClientRepository } from './infrastructure/repositories/DrizzleApiClientRepository.ts';
import { DrizzleClientCredentialRepository } from './infrastructure/repositories/DrizzleClientCredentialRepository.ts';
import { DrizzleClientMerchantAccessRepository } from './infrastructure/repositories/DrizzleClientMerchantAccessRepository.ts';
import { DrizzleProviderAccountMethodRepository } from './infrastructure/repositories/DrizzleProviderAccountMethodRepository.ts';
import { DrizzleAuditLogRepository } from './infrastructure/repositories/DrizzleAuditLogRepository.ts';
import { DrizzleClientSigningKeyRepository } from './infrastructure/repositories/DrizzleClientSigningKeyRepository.ts';
import { DrizzleRequestNonceRepository } from './infrastructure/repositories/DrizzleRequestNonceRepository.ts';
import { FakeGatewayWebhookHandler } from './infrastructure/providers/FakeGatewayWebhookHandler.ts';
import { CreateMerchant } from './application/use-cases/CreateMerchant.ts';
import { CreateProviderAccount } from './application/use-cases/CreateProviderAccount.ts';
import { CreatePaymentIntent } from './application/use-cases/CreatePaymentIntent.ts';
import { CreateGatewayPayment } from './application/use-cases/CreateGatewayPayment.ts';
import { ConfirmFakeGatewayPayment } from './application/use-cases/ConfirmFakeGatewayPayment.ts';
import { GetPaymentIntentStatus } from './application/use-cases/GetPaymentIntentStatus.ts';
import { GetRefundability } from './application/use-cases/GetRefundability.ts';
import { HandleProviderWebhook } from './application/use-cases/HandleProviderWebhook.ts';
import { ReconcilePaymentIntentTotals } from './application/use-cases/ReconcilePaymentIntentTotals.ts';
import { RefreshProviderStatus } from './application/use-cases/RefreshProviderStatus.ts';
import { ExpireStalePaymentTransactions } from './application/use-cases/ExpireStalePaymentTransactions.ts';
import { ReprocessProviderEvents } from './application/use-cases/ReprocessProviderEvents.ts';
import { RefundPaymentTransaction } from './application/use-cases/RefundPaymentTransaction.ts';
import { VoidPaymentTransaction } from './application/use-cases/VoidPaymentTransaction.ts';
import { CreateCredential } from './application/use-cases/CreateCredential.ts';
import { ListCredentials } from './application/use-cases/ListCredentials.ts';
import { RevokeCredential } from './application/use-cases/RevokeCredential.ts';
import { RotateCredential } from './application/use-cases/RotateCredential.ts';
import { InMemoryRateLimiterStore } from './rate-limit/rateLimiter.ts';
import type { RateLimiterStore } from './rate-limit/rateLimiter.ts';
import type { CreateMerchantInput, CreateMerchantOutput } from './application/use-cases/CreateMerchant.ts';
import type { ProviderAccountPaymentMethodRepository, AuditLogRepository } from '@northflow/payment-orchestration-core';
import { randomUUID } from 'crypto';

import type { PaymentMerchantRepository } from '@northflow/payment-orchestration-core';
import type { PaymentProviderAccountRepository } from '@northflow/payment-orchestration-core';
import type { PaymentIntentRepository } from '@northflow/payment-orchestration-core';
import type { PaymentTransactionRepository } from '@northflow/payment-orchestration-core';
import type { PaymentProviderEventRepository } from '@northflow/payment-orchestration-core';
import type { PaymentIdempotencyRepository } from '@northflow/payment-orchestration-core';
import type { ApiClientRepository } from '@northflow/payment-orchestration-core';
import type { ClientCredentialRepository } from '@northflow/payment-orchestration-core';
import type { ClientMerchantAccessRepository } from '@northflow/payment-orchestration-core';

export interface ServiceRepos {
  merchantRepo: PaymentMerchantRepository;
  providerAccountRepo: PaymentProviderAccountRepository;
  intentRepo: PaymentIntentRepository;
  transactionRepo: PaymentTransactionRepository;
  providerEventRepo: PaymentProviderEventRepository;
  idempotencyRepo: PaymentIdempotencyRepository;
}

/** S1: Auth repos — optional so in-memory test containers remain backward-compatible. */
export interface AuthRepos {
  apiClientRepo: ApiClientRepository;
  clientCredentialRepo: ClientCredentialRepository;
  clientMerchantAccessRepo: ClientMerchantAccessRepository;
}

export interface ServiceUseCases {
  createMerchant: CreateMerchant;
  createProviderAccount: CreateProviderAccount;
  createPaymentIntent: CreatePaymentIntent;
  createGatewayPayment: CreateGatewayPayment;
  confirmFakeGatewayPayment: ConfirmFakeGatewayPayment;
  getPaymentIntentStatus: GetPaymentIntentStatus;
  getRefundability: GetRefundability;
  handleProviderWebhook: HandleProviderWebhook;
  reconcilePaymentIntentTotals: ReconcilePaymentIntentTotals;
  refreshProviderStatus: RefreshProviderStatus;
  refundPaymentTransaction: RefundPaymentTransaction;
  voidPaymentTransaction: VoidPaymentTransaction;
  expireStalePaymentTransactions?: ExpireStalePaymentTransactions;
  reprocessProviderEvents?: ReprocessProviderEvents;
  // S9.1: Credential lifecycle use cases (optional for backward compat with test containers)
  createCredential?: CreateCredential;
  listCredentials?: ListCredentials;
  revokeCredential?: RevokeCredential;
  rotateCredential?: RotateCredential;
}

export interface ServiceContainer {
  config: PaymentOrchestrationServiceConfig;
  db: PoDb;
  repos: ServiceRepos;
  /** S1: Per-client auth repos. Optional to preserve backward compat with in-memory test containers. */
  authRepos?: AuthRepos;
  providerRegistry: ProviderRegistry;
  useCases: ServiceUseCases;
  /** S7.5: Provider account payment method repo. Optional for backward compat with in-memory test containers. */
  providerAccountMethodRepo?: ProviderAccountPaymentMethodRepository;
  /** S8: Audit log repo. Optional for backward compat with in-memory test containers. */
  auditRepo?: AuditLogRepository;
  /** S9.2: Rate limiter store. Optional for backward compat with in-memory test containers. */
  rateLimiter?: RateLimiterStore;
  /** S9.4: Signing key repo. Optional for backward compat with in-memory test containers. */
  signingKeyRepo?: DrizzleClientSigningKeyRepository;
  /** S9.4: Request nonce repo. Optional for backward compat with in-memory test containers. */
  nonceRepo?: DrizzleRequestNonceRepository;
}

export function createContainer(config: PaymentOrchestrationServiceConfig): ServiceContainer {
  const db = createPoDb(config.dbUrl);
  const providerRegistry = createProviderRegistry(config.nodeEnv, {
    xenditSandboxEnabled: config.xenditSandboxEnabled,
    xenditBaseUrl: config.xenditBaseUrl,
  });

  const merchantRepo = new DrizzlePaymentMerchantRepository(db);
  const providerAccountRepo = new DrizzlePaymentProviderAccountRepository(db);
  const intentRepo = new DrizzlePaymentIntentRepository(db);
  const transactionRepo = new DrizzlePaymentTransactionRepository(db);
  const providerEventRepo = new DrizzlePaymentProviderEventRepository(db);
  const idempotencyRepo = new DrizzlePaymentIdempotencyRepository(db);

  const repos: ServiceRepos = {
    merchantRepo,
    providerAccountRepo,
    intentRepo,
    transactionRepo,
    providerEventRepo,
    idempotencyRepo,
  };

  // ── S1: API Client auth repos ──────────────────────────────────────────────
  const apiClientRepo = new DrizzleApiClientRepository(db);
  const clientCredentialRepo = new DrizzleClientCredentialRepository(db);
  const clientMerchantAccessRepo = new DrizzleClientMerchantAccessRepository(db);

  const authRepos: AuthRepos = { apiClientRepo, clientCredentialRepo, clientMerchantAccessRepo };

  // ── S7.5: Provider account payment method repo ─────────────────────────────
  const providerAccountMethodRepo = new DrizzleProviderAccountMethodRepository(db);

  // ── S8: Audit log repo ────────────────────────────────────────────────────
  const auditRepo = new DrizzleAuditLogRepository(db);

  // ── S9.2: Rate limiter ────────────────────────────────────────────────────
  const rateLimiter = new InMemoryRateLimiterStore();

  // ── S9.4: Signing key and nonce repos ─────────────────────────────────────
  const signingKeyRepo = new DrizzleClientSigningKeyRepository(db);
  const nonceRepo = new DrizzleRequestNonceRepository(db);

  // ── Phase 8E: FakeGateway webhook handler ────────────────────────────────
  const fakeGatewayWebhookHandler = new FakeGatewayWebhookHandler({
    webhookSecret: process.env['PAYMENT_ORCHESTRATION_FAKEGATEWAY_WEBHOOK_SECRET'] ?? null,
    nodeEnv: config.nodeEnv,
  });

  const useCases: ServiceUseCases = {
    createMerchant: new CreateMerchant(merchantRepo),
    createProviderAccount: new CreateProviderAccount(merchantRepo, providerAccountRepo),
    createPaymentIntent: new CreatePaymentIntent(merchantRepo, intentRepo, idempotencyRepo),
    createGatewayPayment: new CreateGatewayPayment(
      merchantRepo,
      intentRepo,
      transactionRepo,
      providerRegistry,
      providerAccountRepo,
      idempotencyRepo,
      config.nodeEnv,
      providerAccountMethodRepo,
    ),
    confirmFakeGatewayPayment: new ConfirmFakeGatewayPayment(
      transactionRepo,
      intentRepo,
      config.nodeEnv,
    ),
    getPaymentIntentStatus: new GetPaymentIntentStatus(intentRepo, transactionRepo),
    getRefundability: new GetRefundability(intentRepo, transactionRepo),
    handleProviderWebhook: new HandleProviderWebhook(
      transactionRepo,
      intentRepo,
      providerEventRepo,
      fakeGatewayWebhookHandler,
      providerRegistry,
    ),
    reconcilePaymentIntentTotals: new ReconcilePaymentIntentTotals(
      intentRepo,
      transactionRepo,
    ),
    refreshProviderStatus: new RefreshProviderStatus(
      transactionRepo,
      intentRepo,
      providerAccountRepo,
      providerRegistry,
    ),
    refundPaymentTransaction: new RefundPaymentTransaction(
      transactionRepo,
      intentRepo,
      providerAccountRepo,
      providerRegistry,
    ),
    voidPaymentTransaction: new VoidPaymentTransaction(
      transactionRepo,
      intentRepo,
      providerAccountRepo,
      providerRegistry,
    ),
    expireStalePaymentTransactions: new ExpireStalePaymentTransactions(
      intentRepo,
      transactionRepo,
    ),
    reprocessProviderEvents: new ReprocessProviderEvents(providerEventRepo, transactionRepo, intentRepo),
    // S9.1: Credential lifecycle use cases
    createCredential: new CreateCredential(apiClientRepo, clientCredentialRepo),
    listCredentials: new ListCredentials(clientCredentialRepo),
    revokeCredential: new RevokeCredential(clientCredentialRepo),
    rotateCredential: new RotateCredential(apiClientRepo, clientCredentialRepo),
  };

  return { config, db, repos, authRepos, providerRegistry, useCases, providerAccountMethodRepo, auditRepo, rateLimiter, signingKeyRepo, nonceRepo };
}

/**
 * createMerchantWithGrantAtomic — P1.1 atomic merchant + grant creation.
 *
 * For normal (non-legacy, non-internal) clients, both the merchant row and the
 * client-merchant access grant are written in a single DB transaction so they are
 * either both committed or both rolled back.
 *
 * Falls back to sequential writes when `container.db` is unavailable (in-memory test
 * containers) — in that scenario both repos are already in-process, so no partial
 * state can survive a failure.
 *
 * @param container  the wired ServiceContainer (needs container.db + authRepos)
 * @param merchantInput  forwarded to CreateMerchant.execute
 * @param grantInput     clientId + scopes for the access grant (only used when created=true)
 */
export async function createMerchantWithGrantAtomic(
  container: ServiceContainer,
  merchantInput: CreateMerchantInput,
  grantInput: { clientId: string; scopes: string[] },
): Promise<CreateMerchantOutput> {
  // ── Production path: wrap in DB transaction for true atomicity ────────────
  if (container.db && container.authRepos?.clientMerchantAccessRepo) {
    return container.db.transaction(async (tx) => {
      const txDb = tx as unknown as PoDb;
      const txMerchantRepo = new DrizzlePaymentMerchantRepository(txDb);
      const txAccessRepo = new DrizzleClientMerchantAccessRepository(txDb);

      const result = await new CreateMerchant(txMerchantRepo).execute(merchantInput);

      if (result.created) {
        // Grant is created atomically with the merchant — if this throws,
        // the merchant INSERT is also rolled back.
        await txAccessRepo.create({
          id: randomUUID(),
          clientId: grantInput.clientId,
          merchantId: result.merchant.id,
          scopes: grantInput.scopes,
        });
      }

      return result;
    });
  }

  // ── Fallback path: in-memory repos / test containers without a real DB ────
  // Sequential writes are acceptable here because in-process repos cannot
  // partially fail across a process boundary.
  const result = await container.useCases.createMerchant.execute(merchantInput);

  if (result.created && container.authRepos?.clientMerchantAccessRepo) {
    await container.authRepos.clientMerchantAccessRepo.create({
      id: randomUUID(),
      clientId: grantInput.clientId,
      merchantId: result.merchant.id,
      scopes: grantInput.scopes,
    });
  }

  return result;
}
