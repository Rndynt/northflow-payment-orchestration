/**
 * schema — payment-orchestration-service owned Drizzle schema.
 *
 * This module is the standalone source of truth for `payment_orchestration_*`
 * tables. AuraPoS root/shared schema may keep compatibility definitions for
 * monorepo tests and migrations, but service repositories must import from this
 * service-local module only.
 */

import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const paymentOrchestrationMerchants = pgTable('payment_orchestration_merchants', {
  id: text('id').primaryKey(),
  externalRef: text('external_ref'),
  sourceApp: text('source_app'),
  name: text('name').notNull(),
  legalName: text('legal_name'),
  status: text('status').notNull().default('active'),
  metadata: jsonb('metadata').notNull().default({}),
  createdAt: timestamp('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  sourceAppExternalRefIdx: uniqueIndex('po_merchants_source_app_ref_unique')
    .on(table.sourceApp, table.externalRef)
    .where(sql`${table.sourceApp} IS NOT NULL AND ${table.externalRef} IS NOT NULL`),
  statusIdx: index('po_merchants_status_idx').on(table.status),
}));

export const paymentOrchestrationProviderAccounts = pgTable('payment_orchestration_provider_accounts', {
  id: text('id').primaryKey(),
  merchantId: text('merchant_id').notNull().references(() => paymentOrchestrationMerchants.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  providerAccountRef: text('provider_account_ref'),
  environment: text('environment').notNull(),
  status: text('status').notNull().default('active'),
  credentialsRef: text('credentials_ref'),
  publicConfig: jsonb('public_config').notNull().default({}),
  metadata: jsonb('metadata').notNull().default({}),
  createdAt: timestamp('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  merchantIdx: index('po_provider_accounts_merchant_idx').on(table.merchantId),
  merchantProviderEnvUnique: uniqueIndex('po_provider_accounts_merchant_provider_env_unique')
    .on(table.merchantId, table.provider, table.environment, table.providerAccountRef)
    .where(sql`${table.providerAccountRef} IS NOT NULL`),
}));

export const paymentOrchestrationIntents = pgTable('payment_orchestration_intents', {
  id: text('id').primaryKey(),
  merchantId: text('merchant_id').notNull().references(() => paymentOrchestrationMerchants.id, { onDelete: 'cascade' }),
  providerAccountId: text('provider_account_id').references(() => paymentOrchestrationProviderAccounts.id, { onDelete: 'set null' }),
  sourceApp: text('source_app'),
  externalTenantId: text('external_tenant_id'),
  externalOutletId: text('external_outlet_id'),
  externalLocationId: text('external_location_id'),
  externalPayableType: text('external_payable_type').notNull(),
  externalPayableId: text('external_payable_id').notNull(),
  amountDue: integer('amount_due').notNull(),
  amountPaid: integer('amount_paid').notNull().default(0),
  amountRefunded: integer('amount_refunded').notNull().default(0),
  amountRemaining: integer('amount_remaining').notNull(),
  currency: text('currency').notNull().default('IDR'),
  status: text('status').notNull(),
  allowPartial: boolean('allow_partial').notNull().default(false),
  expiresAt: timestamp('expires_at'),
  metadata: jsonb('metadata').notNull().default({}),
  createdAt: timestamp('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  merchantIdx: index('po_intents_merchant_idx').on(table.merchantId),
  sourceAppTenantIdx: index('po_intents_source_app_tenant_idx').on(table.sourceApp, table.externalTenantId),
  payableIdx: index('po_intents_payable_idx').on(table.externalPayableType, table.externalPayableId),
  merchantPayableUnique: uniqueIndex('po_intents_merchant_payable_unique')
    .on(table.merchantId, table.sourceApp, table.externalPayableType, table.externalPayableId)
    .where(sql`${table.sourceApp} IS NOT NULL`),
}));

export const paymentOrchestrationTransactions = pgTable('payment_orchestration_transactions', {
  id: text('id').primaryKey(),
  merchantId: text('merchant_id').notNull().references(() => paymentOrchestrationMerchants.id, { onDelete: 'cascade' }),
  intentId: text('intent_id').notNull().references(() => paymentOrchestrationIntents.id, { onDelete: 'cascade' }),
  providerAccountId: text('provider_account_id').references(() => paymentOrchestrationProviderAccounts.id, { onDelete: 'set null' }),
  provider: text('provider').notNull(),
  method: text('method').notNull(),
  transactionType: text('transaction_type').notNull(),
  status: text('status').notNull(),
  direction: text('direction').notNull(),
  amount: integer('amount').notNull(),
  currency: text('currency').notNull().default('IDR'),
  parentTransactionId: text('parent_transaction_id').references((): any => paymentOrchestrationTransactions.id, { onDelete: 'set null' }),
  providerReference: text('provider_reference'),
  providerEventId: text('provider_event_id'),
  providerPaymentUrl: text('provider_payment_url'),
  providerQrString: text('provider_qr_string'),
  failureReason: text('failure_reason'),
  idempotencyKey: text('idempotency_key'),
  expiresAt: timestamp('expires_at'),
  metadata: jsonb('metadata').notNull().default({}),
  rawProviderResponse: jsonb('raw_provider_response'),
  createdAt: timestamp('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  merchantIdx: index('po_transactions_merchant_idx').on(table.merchantId),
  intentIdx: index('po_transactions_intent_idx').on(table.intentId),
  providerReferenceIdx: index('po_transactions_provider_reference_idx').on(table.provider, table.providerReference),
  expiresAtIdx: index('po_transactions_expires_at_idx').on(table.expiresAt),
  merchantIdempotencyUnique: uniqueIndex('po_transactions_merchant_idempotency_unique')
    .on(table.merchantId, table.idempotencyKey)
    .where(sql`${table.idempotencyKey} IS NOT NULL`),
  providerReferenceUnique: uniqueIndex('po_transactions_provider_reference_unique')
    .on(table.provider, table.providerReference)
    .where(sql`${table.providerReference} IS NOT NULL`),
}));

export const paymentOrchestrationProviderEvents = pgTable('payment_orchestration_provider_events', {
  id: text('id').primaryKey(),
  merchantId: text('merchant_id').references(() => paymentOrchestrationMerchants.id, { onDelete: 'set null' }),
  provider: text('provider').notNull(),
  providerEventId: text('provider_event_id').notNull(),
  providerReference: text('provider_reference'),
  eventType: text('event_type').notNull(),
  processingStatus: text('processing_status').notNull().default('pending'),
  processingAttempts: integer('processing_attempts').notNull().default(0),
  lastError: text('last_error'),
  rawHeaders: jsonb('raw_headers').notNull().default({}),
  rawBody: jsonb('raw_body'),
  parsedPayload: jsonb('parsed_payload'),
  receivedAt: timestamp('received_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  processedAt: timestamp('processed_at'),
  createdAt: timestamp('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  providerEventUnique: uniqueIndex('po_provider_events_unique').on(table.provider, table.providerEventId),
  merchantIdx: index('po_provider_events_merchant_idx').on(table.merchantId),
  providerReferenceIdx: index('po_provider_events_reference_idx').on(table.provider, table.providerReference),
  processingStatusIdx: index('po_provider_events_status_idx').on(table.processingStatus),
  receivedAtIdx: index('po_provider_events_received_at_idx').on(table.receivedAt),
}));

export const paymentOrchestrationIdempotencyKeys = pgTable('payment_orchestration_idempotency_keys', {
  id: text('id').primaryKey(),
  merchantId: text('merchant_id').notNull().references(() => paymentOrchestrationMerchants.id, { onDelete: 'cascade' }),
  scope: text('scope').notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  requestHash: text('request_hash').notNull(),
  responseSnapshot: jsonb('response_snapshot'),
  resourceType: text('resource_type'),
  resourceId: text('resource_id'),
  status: text('status').notNull().default('processing'),
  createdAt: timestamp('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  expiresAt: timestamp('expires_at'),
}, (table) => ({
  merchantScopeKeyUnique: uniqueIndex('po_idempotency_merchant_scope_key_unique')
    .on(table.merchantId, table.scope, table.idempotencyKey),
  expiresAtIdx: index('po_idempotency_expires_at_idx').on(table.expiresAt),
  statusIdx: index('po_idempotency_status_idx').on(table.status),
}));
