/**
 * mappers — row → core DTO mapping for standalone payment orchestration.
 *
 * Pure functions. No DB calls. No side effects.
 * Input types mirror what Drizzle `$inferSelect` produces from the
 * `payment_orchestration_*` tables in service-local schema.ts.
 *
 * Phase 8C: mappers defined for boundary verification and testing.
 * Phase 8D: repository implementations call these after Drizzle queries.
 */

import type { PaymentMerchant } from '@northflow/payment-orchestration-core';
import type {
  PaymentProviderAccount,
  PaymentProviderAccountEnvironment,
  PaymentProviderAccountStatus,
} from '@northflow/payment-orchestration-core';
import type { StandalonePaymentIntentDTO, StandaloneIntentStatus } from '@northflow/payment-orchestration-core';
import type { StandalonePaymentTransactionDTO, StandaloneTransactionStatus } from '@northflow/payment-orchestration-core';
import type {
  PaymentProviderEventDTO,
  PaymentProviderEventProcessingStatus,
} from '@northflow/payment-orchestration-core';
import type {
  PaymentIdempotencyKeyDTO,
  IdempotencyKeyStatus,
} from '@northflow/payment-orchestration-core';

// ── Local row types ────────────────────────────────────────────────────────────
// These mirror the Drizzle $inferSelect shape from the service-local schema module.
// The actual Drizzle query results will structurally match these types.

export interface MerchantRow {
  id: string;
  externalRef: string | null;
  sourceApp: string | null;
  name: string;
  legalName: string | null;
  status: string;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProviderAccountRow {
  id: string;
  merchantId: string;
  provider: string;
  providerAccountRef: string | null;
  environment: string;
  status: string;
  credentialsRef: string | null;
  publicConfig: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IntentRow {
  id: string;
  merchantId: string;
  providerAccountId: string | null;
  sourceApp: string | null;
  externalTenantId: string | null;
  externalOutletId: string | null;
  externalLocationId: string | null;
  externalPayableType: string;
  externalPayableId: string;
  amountDue: number;
  amountPaid: number;
  amountRefunded: number;
  amountRemaining: number;
  currency: string;
  status: string;
  allowPartial: boolean;
  expiresAt: Date | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TransactionRow {
  id: string;
  merchantId: string;
  intentId: string;
  providerAccountId: string | null;
  provider: string;
  method: string;
  transactionType: string;
  status: string;
  direction: string;
  amount: number;
  currency: string;
  parentTransactionId: string | null;
  providerReference: string | null;
  providerEventId: string | null;
  providerPaymentUrl: string | null;
  providerQrString: string | null;
  failureReason: string | null;
  idempotencyKey: string | null;
  expiresAt: Date | null;
  metadata: Record<string, unknown> | null;
  rawProviderResponse: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProviderEventRow {
  id: string;
  merchantId: string | null;
  provider: string;
  providerEventId: string;
  providerReference: string | null;
  eventType: string;
  processingStatus: string;
  processingAttempts: number;
  lastError: string | null;
  rawHeaders: Record<string, unknown> | null;
  rawBody: Record<string, unknown> | null;
  parsedPayload: Record<string, unknown> | null;
  receivedAt: Date;
  processedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IdempotencyKeyRow {
  id: string;
  merchantId: string;
  scope: string;
  idempotencyKey: string;
  requestHash: string;
  responseSnapshot: Record<string, unknown> | null;
  resourceType: string | null;
  resourceId: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date | null;
}

// ── Mappers ────────────────────────────────────────────────────────────────────

/**
 * mapMerchantRow — maps a po_merchants DB row to PaymentMerchant.
 *
 * Uses `id` as the merchantId-equivalent field (standalone merchants use slug/text IDs).
 * No `tenantId` exposed.
 */
export function mapMerchantRow(row: MerchantRow): PaymentMerchant {
  return {
    id: row.id,
    displayName: row.name,
    legalName: row.legalName ?? null,
    status: (row.status as PaymentMerchant['status']) ?? 'active',
    metadata: (row.metadata as Record<string, unknown>) ?? {},
  };
}

/**
 * mapProviderAccountRow — maps a po_provider_accounts row to PaymentProviderAccount.
 *
 * `providerAccountRef` is the provider's own account identifier — safe to expose in API responses.
 * `credentialsRef` is an opaque secret-store reference — callers MUST NOT expose it in public responses.
 */
export function mapProviderAccountRow(row: ProviderAccountRow): PaymentProviderAccount {
  return {
    id: row.id,
    merchantId: row.merchantId,
    provider: row.provider,
    environment: (row.environment as PaymentProviderAccountEnvironment) ?? 'sandbox',
    providerAccountRef: row.providerAccountRef ?? null,
    credentialsRef: row.credentialsRef ?? null,
    publicConfig: (row.publicConfig as Record<string, unknown>) ?? {},
    status: (row.status as PaymentProviderAccountStatus) ?? 'active',
    metadata: (row.metadata as Record<string, unknown>) ?? {},
  };
}

/**
 * mapIntentRow — maps a po_intents row to StandalonePaymentIntentDTO.
 *
 * External references (sourceApp, externalTenantId, etc.) are preserved for callback correlation.
 * No AuraPoS tenantId in the output.
 */
export function mapIntentRow(row: IntentRow): StandalonePaymentIntentDTO {
  return {
    id: row.id,
    merchantId: row.merchantId,
    providerAccountId: row.providerAccountId ?? null,
    sourceApp: row.sourceApp ?? null,
    externalTenantId: row.externalTenantId ?? null,
    externalOutletId: row.externalOutletId ?? null,
    externalLocationId: row.externalLocationId ?? null,
    externalPayableType: row.externalPayableType,
    externalPayableId: row.externalPayableId,
    currency: row.currency,
    amountDue: row.amountDue,
    amountPaid: row.amountPaid,
    amountRefunded: row.amountRefunded,
    amountRemaining: row.amountRemaining,
    status: (row.status as StandaloneIntentStatus),
    allowPartial: row.allowPartial,
    expiresAt: row.expiresAt ?? null,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    idempotencyKey: null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * mapTransactionRow — maps a po_transactions row to StandalonePaymentTransactionDTO.
 *
 * Provider reference and action fields (url, qr) are mapped safely.
 * rawProviderResponse is passed through but callers must not leak it externally.
 * No AuraPoS tenantId in the output.
 */
export function mapTransactionRow(row: TransactionRow): StandalonePaymentTransactionDTO {
  return {
    id: row.id,
    merchantId: row.merchantId,
    intentId: row.intentId,
    providerAccountId: row.providerAccountId ?? null,
    provider: row.provider,
    method: row.method,
    transactionType: row.transactionType,
    status: (row.status as StandaloneTransactionStatus),
    direction: (row.direction as 'incoming' | 'outgoing'),
    amount: row.amount,
    currency: row.currency,
    parentTransactionId: row.parentTransactionId ?? null,
    providerReference: row.providerReference ?? null,
    providerEventId: row.providerEventId ?? null,
    providerPaymentUrl: row.providerPaymentUrl ?? null,
    providerQrString: row.providerQrString ?? null,
    failureReason: row.failureReason ?? null,
    idempotencyKey: row.idempotencyKey ?? null,
    expiresAt: row.expiresAt ?? null,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    rawProviderResponse: (row.rawProviderResponse as Record<string, unknown>) ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * mapProviderEventRow — maps a po_provider_events row to PaymentProviderEventDTO.
 *
 * merchantId may be null at initial receipt; it is backfilled after providerReference resolution.
 */
export function mapProviderEventRow(row: ProviderEventRow): PaymentProviderEventDTO {
  return {
    id: row.id,
    merchantId: row.merchantId ?? null,
    provider: row.provider,
    providerEventId: row.providerEventId,
    providerReference: row.providerReference ?? null,
    eventType: row.eventType,
    processingStatus: (row.processingStatus as PaymentProviderEventProcessingStatus),
    processingAttempts: row.processingAttempts,
    lastError: row.lastError ?? null,
    rawHeaders: (row.rawHeaders as Record<string, unknown>) ?? {},
    rawBody: (row.rawBody as Record<string, unknown>) ?? null,
    parsedPayload: (row.parsedPayload as Record<string, unknown>) ?? null,
    receivedAt: row.receivedAt,
    processedAt: row.processedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * mapIdempotencyKeyRow — maps a po_idempotency_keys row to PaymentIdempotencyKeyDTO.
 *
 * responseSnapshot is preserved for idempotent replay.
 */
export function mapIdempotencyKeyRow(row: IdempotencyKeyRow): PaymentIdempotencyKeyDTO {
  return {
    id: row.id,
    merchantId: row.merchantId,
    scope: row.scope,
    idempotencyKey: row.idempotencyKey,
    requestHash: row.requestHash,
    responseSnapshot: (row.responseSnapshot as Record<string, unknown>) ?? null,
    resourceType: row.resourceType ?? null,
    resourceId: row.resourceId ?? null,
    status: (row.status as IdempotencyKeyStatus),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    expiresAt: row.expiresAt ?? null,
  };
}
