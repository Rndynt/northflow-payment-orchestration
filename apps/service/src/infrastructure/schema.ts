/**
 * schema — payment-orchestration-service owned Drizzle schema.
 *
 * Table prefix: po_* (shortened from payment_orchestration_* for readability).
 * All indexes keep the existing po_ naming convention.
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

export const poMerchants = pgTable('po_merchants', {
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

export const poProviderAccounts = pgTable('po_provider_accounts', {
  id: text('id').primaryKey(),
  merchantId: text('merchant_id').notNull().references(() => poMerchants.id, { onDelete: 'cascade' }),
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

export const poIntents = pgTable('po_intents', {
  id: text('id').primaryKey(),
  merchantId: text('merchant_id').notNull().references(() => poMerchants.id, { onDelete: 'cascade' }),
  providerAccountId: text('provider_account_id').references(() => poProviderAccounts.id, { onDelete: 'set null' }),
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

export const poTransactions = pgTable('po_transactions', {
  id: text('id').primaryKey(),
  merchantId: text('merchant_id').notNull().references(() => poMerchants.id, { onDelete: 'cascade' }),
  intentId: text('intent_id').notNull().references(() => poIntents.id, { onDelete: 'cascade' }),
  providerAccountId: text('provider_account_id').references(() => poProviderAccounts.id, { onDelete: 'set null' }),
  provider: text('provider').notNull(),
  method: text('method').notNull(),
  transactionType: text('transaction_type').notNull(),
  status: text('status').notNull(),
  direction: text('direction').notNull(),
  amount: integer('amount').notNull(),
  currency: text('currency').notNull().default('IDR'),
  parentTransactionId: text('parent_transaction_id').references((): any => poTransactions.id, { onDelete: 'set null' }),
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

export const poProviderEvents = pgTable('po_provider_events', {
  id: text('id').primaryKey(),
  merchantId: text('merchant_id').references(() => poMerchants.id, { onDelete: 'set null' }),
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

export const poIdempotencyKeys = pgTable('po_idempotency_keys', {
  id: text('id').primaryKey(),
  merchantId: text('merchant_id').notNull().references(() => poMerchants.id, { onDelete: 'cascade' }),
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

export const poApiClients = pgTable('po_api_clients', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  sourceApp: text('source_app').notNull(),
  environment: text('environment').notNull().default('production'),
  status: text('status').notNull().default('active'),
  scopes: jsonb('scopes').notNull().default([]),
  metadata: jsonb('metadata').notNull().default({}),
  createdAt: timestamp('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  sourceAppEnvIdx: index('po_api_clients_source_app_env_idx').on(table.sourceApp, table.environment),
  statusIdx: index('po_api_clients_status_idx').on(table.status),
}));

export const poClientCredentials = pgTable('po_client_credentials', {
  id: text('id').primaryKey(),
  clientId: text('client_id').notNull().references(() => poApiClients.id, { onDelete: 'cascade' }),
  credentialPrefix: text('credential_prefix').notNull(),
  credentialHash: text('credential_hash').notNull(),
  status: text('status').notNull().default('active'),
  expiresAt: timestamp('expires_at'),
  lastUsedAt: timestamp('last_used_at'),
  createdAt: timestamp('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  revokedAt: timestamp('revoked_at'),
}, (table) => ({
  clientIdx: index('po_client_credentials_client_idx').on(table.clientId),
  prefixIdx: index('po_client_credentials_prefix_idx').on(table.credentialPrefix),
  statusIdx: index('po_client_credentials_status_idx').on(table.status),
}));

export const poProviderAccountMethods = pgTable('po_provider_account_methods', {
  id: text('id').primaryKey(),
  merchantId: text('merchant_id').notNull().references(() => poMerchants.id, { onDelete: 'cascade' }),
  providerAccountId: text('provider_account_id').notNull().references(() => poProviderAccounts.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  method: text('method').notNull(),
  methodType: text('method_type').notNull(),
  providerMethodCode: text('provider_method_code'),
  displayName: text('display_name').notNull(),
  status: text('status').notNull().default('active'),
  currency: text('currency').notNull().default('IDR'),
  minAmount: integer('min_amount'),
  maxAmount: integer('max_amount'),
  sortOrder: integer('sort_order').notNull().default(0),
  publicConfig: jsonb('public_config').notNull().default({}),
  providerMetadata: jsonb('provider_metadata').notNull().default({}),
  metadata: jsonb('metadata').notNull().default({}),
  createdAt: timestamp('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  providerAccountIdx: index('po_pam_provider_account_idx').on(table.providerAccountId),
  merchantIdx: index('po_pam_merchant_idx').on(table.merchantId),
  providerMethodIdx: index('po_pam_provider_method_idx').on(table.provider, table.method),
  statusIdx: index('po_pam_status_idx').on(table.status),
  providerAccountMethodUnique: uniqueIndex('po_pam_provider_account_method_unique')
    .on(table.providerAccountId, table.method),
}));

export const poClientMerchantAccess = pgTable('po_client_merchant_access', {
  id: text('id').primaryKey(),
  clientId: text('client_id').notNull().references(() => poApiClients.id, { onDelete: 'cascade' }),
  merchantId: text('merchant_id').notNull().references(() => poMerchants.id, { onDelete: 'cascade' }),
  scopes: jsonb('scopes').notNull().default([]),
  status: text('status').notNull().default('active'),
  createdAt: timestamp('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  revokedAt: timestamp('revoked_at'),
}, (table) => ({
  clientMerchantUnique: uniqueIndex('po_client_merchant_access_unique').on(table.clientId, table.merchantId),
  clientIdx: index('po_client_merchant_access_client_idx').on(table.clientId),
  merchantIdx: index('po_client_merchant_access_merchant_idx').on(table.merchantId),
  statusIdx: index('po_client_merchant_access_status_idx').on(table.status),
}));
