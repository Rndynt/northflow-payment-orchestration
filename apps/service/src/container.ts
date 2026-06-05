/**
 * container — dependency injection container for payment-orchestration-service.
 *
 * Phase 8D: DB connection, repositories, provider registry, and use cases wired.
 * Phase 8D Hardening:
 *   - CreateGatewayPayment now receives providerAccountRepo, idempotencyRepo, nodeEnv
 *     for provider account validation (Task 4) and idempotency guard (Task 5).
 * Phase 8D.1 + 8E:
 *   - ConfirmFakeGatewayPayment uses atomic markSucceededIfConfirmable.
 *   - FakeGatewayWebhookHandler wired with optional webhook secret from env.
 *   - HandleProviderWebhook use case wired and exposed.
 * Phase 8F:
 *   - RefundPaymentTransaction and VoidPaymentTransaction wired (legacy parity).
 *   - StandaloneManualProvider registered in providerRegistry.
 *
 * No AuraPoS session/tenant middleware.
 * No POS order domain deps.
 * No import from apps/api/src/container.ts.
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

import type { PaymentMerchantRepository } from '@northflow/payment-orchestration-core';
import type { PaymentProviderAccountRepository } from '@northflow/payment-orchestration-core';
import type { PaymentIntentRepository } from '@northflow/payment-orchestration-core';
import type { PaymentTransactionRepository } from '@northflow/payment-orchestration-core';
import type { PaymentProviderEventRepository } from '@northflow/payment-orchestration-core';
import type { PaymentIdempotencyRepository } from '@northflow/payment-orchestration-core';

export interface ServiceRepos {
  merchantRepo: PaymentMerchantRepository;
  providerAccountRepo: PaymentProviderAccountRepository;
  intentRepo: PaymentIntentRepository;
  transactionRepo: PaymentTransactionRepository;
  providerEventRepo: PaymentProviderEventRepository;
  idempotencyRepo: PaymentIdempotencyRepository;
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
}

export interface ServiceContainer {
  config: PaymentOrchestrationServiceConfig;
  db: PoDb;
  repos: ServiceRepos;
  providerRegistry: ProviderRegistry;
  useCases: ServiceUseCases;
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
      providerAccountRepo,   // Task 4: provider account validation
      idempotencyRepo,       // Task 5: gateway payment idempotency
      config.nodeEnv,        // Task 4: fake_gateway dev convenience in non-production
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
    // Phase 8F: Refund + Void parity use cases
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
  };

  return { config, db, repos, providerRegistry, useCases };
}
