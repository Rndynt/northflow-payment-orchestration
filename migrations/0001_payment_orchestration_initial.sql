-- Standalone-owned migration for apps/payment-orchestration-service.
-- Root migrations may keep compatibility copies for monorepo test databases.

-- Migration: Payment Orchestration Phase 8C — Standalone Schema
-- Adds 6 new payment_orchestration_* tables for the standalone service boundary.
-- Does NOT modify any existing embedded payment_engine_* or order_payments tables.
-- Safe to run multiple times (IF NOT EXISTS guards on all DDL).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. payment_orchestration_merchants
-- Primary owner identity for standalone payment orchestration.
-- Uses merchant_id (slug/text), NOT tenant_id (AuraPoS-specific).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "payment_orchestration_merchants" (
  "id"           text PRIMARY KEY,
  "external_ref" text,
  "source_app"   text,
  "name"         text NOT NULL,
  "legal_name"   text,
  "status"       text NOT NULL DEFAULT 'active',
  "metadata"     jsonb NOT NULL DEFAULT '{}',
  "created_at"   timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Partial unique: (source_app, external_ref) where both non-null
CREATE UNIQUE INDEX IF NOT EXISTS "po_merchants_source_app_ref_unique"
  ON "payment_orchestration_merchants" ("source_app", "external_ref")
  WHERE "source_app" IS NOT NULL AND "external_ref" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "po_merchants_status_idx"
  ON "payment_orchestration_merchants" ("status");

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. payment_orchestration_provider_accounts
-- Links merchants to payment provider credentials (by reference, not raw secrets).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "payment_orchestration_provider_accounts" (
  "id"                   text PRIMARY KEY,
  "merchant_id"          text NOT NULL REFERENCES "payment_orchestration_merchants" ("id") ON DELETE CASCADE,
  "provider"             text NOT NULL,
  "provider_account_ref" text,
  "environment"          text NOT NULL,
  "status"               text NOT NULL DEFAULT 'active',
  "credentials_ref"      text,
  "public_config"        jsonb NOT NULL DEFAULT '{}',
  "metadata"             jsonb NOT NULL DEFAULT '{}',
  "created_at"           timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"           timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "po_provider_accounts_merchant_idx"
  ON "payment_orchestration_provider_accounts" ("merchant_id");

CREATE UNIQUE INDEX IF NOT EXISTS "po_provider_accounts_merchant_provider_env_unique"
  ON "payment_orchestration_provider_accounts" ("merchant_id", "provider", "environment", "provider_account_ref")
  WHERE "provider_account_ref" IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. payment_orchestration_intents
-- Standalone payment intents. References external AuraPoS entities via
-- external_tenant_id / external_outlet_id / external_payable_* fields.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "payment_orchestration_intents" (
  "id"                    text PRIMARY KEY,
  "merchant_id"           text NOT NULL REFERENCES "payment_orchestration_merchants" ("id") ON DELETE CASCADE,
  "provider_account_id"   text REFERENCES "payment_orchestration_provider_accounts" ("id") ON DELETE SET NULL,
  "source_app"            text,
  "external_tenant_id"    text,
  "external_outlet_id"    text,
  "external_location_id"  text,
  "external_payable_type" text NOT NULL,
  "external_payable_id"   text NOT NULL,
  "amount_due"            integer NOT NULL,
  "amount_paid"           integer NOT NULL DEFAULT 0,
  "amount_refunded"       integer NOT NULL DEFAULT 0,
  "amount_remaining"      integer NOT NULL,
  "currency"              text NOT NULL DEFAULT 'IDR',
  "status"                text NOT NULL,
  "allow_partial"         boolean NOT NULL DEFAULT false,
  "expires_at"            timestamp,
  "metadata"              jsonb NOT NULL DEFAULT '{}',
  "created_at"            timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"            timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "po_intents_amount_due_check" CHECK ("amount_due" >= 0),
  CONSTRAINT "po_intents_amount_paid_check" CHECK ("amount_paid" >= 0),
  CONSTRAINT "po_intents_amount_refunded_check" CHECK ("amount_refunded" >= 0),
  CONSTRAINT "po_intents_amount_remaining_check" CHECK ("amount_remaining" >= 0)
);

CREATE INDEX IF NOT EXISTS "po_intents_merchant_idx"
  ON "payment_orchestration_intents" ("merchant_id");

CREATE INDEX IF NOT EXISTS "po_intents_source_app_tenant_idx"
  ON "payment_orchestration_intents" ("source_app", "external_tenant_id");

CREATE INDEX IF NOT EXISTS "po_intents_payable_idx"
  ON "payment_orchestration_intents" ("external_payable_type", "external_payable_id");

CREATE UNIQUE INDEX IF NOT EXISTS "po_intents_merchant_payable_unique"
  ON "payment_orchestration_intents" ("merchant_id", "source_app", "external_payable_type", "external_payable_id")
  WHERE "source_app" IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. payment_orchestration_transactions
-- Individual payment, refund, void, and settlement transactions.
-- Self-referential via parent_transaction_id for refund/void chains.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "payment_orchestration_transactions" (
  "id"                     text PRIMARY KEY,
  "merchant_id"            text NOT NULL REFERENCES "payment_orchestration_merchants" ("id") ON DELETE CASCADE,
  "intent_id"              text NOT NULL REFERENCES "payment_orchestration_intents" ("id") ON DELETE CASCADE,
  "provider_account_id"    text REFERENCES "payment_orchestration_provider_accounts" ("id") ON DELETE SET NULL,
  "provider"               text NOT NULL,
  "method"                 text NOT NULL,
  "transaction_type"       text NOT NULL,
  "status"                 text NOT NULL,
  "direction"              text NOT NULL,
  "amount"                 integer NOT NULL,
  "currency"               text NOT NULL DEFAULT 'IDR',
  "parent_transaction_id"  text REFERENCES "payment_orchestration_transactions" ("id") ON DELETE SET NULL,
  "provider_reference"     text,
  "provider_event_id"      text,
  "provider_payment_url"   text,
  "provider_qr_string"     text,
  "failure_reason"         text,
  "idempotency_key"        text,
  "expires_at"             timestamp,
  "metadata"               jsonb NOT NULL DEFAULT '{}',
  "raw_provider_response"  jsonb,
  "created_at"             timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"             timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "po_transactions_amount_check" CHECK ("amount" >= 0)
);

CREATE INDEX IF NOT EXISTS "po_transactions_merchant_idx"
  ON "payment_orchestration_transactions" ("merchant_id");

CREATE INDEX IF NOT EXISTS "po_transactions_intent_idx"
  ON "payment_orchestration_transactions" ("intent_id");

CREATE INDEX IF NOT EXISTS "po_transactions_provider_reference_idx"
  ON "payment_orchestration_transactions" ("provider", "provider_reference");

CREATE INDEX IF NOT EXISTS "po_transactions_expires_at_idx"
  ON "payment_orchestration_transactions" ("expires_at");

CREATE UNIQUE INDEX IF NOT EXISTS "po_transactions_merchant_idempotency_unique"
  ON "payment_orchestration_transactions" ("merchant_id", "idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "po_transactions_provider_reference_unique"
  ON "payment_orchestration_transactions" ("provider", "provider_reference")
  WHERE "provider_reference" IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. payment_orchestration_provider_events
-- Inbound webhook events from payment providers.
-- merchant_id is nullable: real webhooks carry no merchant header;
-- backfilled after provider_reference resolves to a known transaction.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "payment_orchestration_provider_events" (
  "id"                   text PRIMARY KEY,
  "merchant_id"          text REFERENCES "payment_orchestration_merchants" ("id") ON DELETE SET NULL,
  "provider"             text NOT NULL,
  "provider_event_id"    text NOT NULL,
  "provider_reference"   text,
  "event_type"           text NOT NULL,
  "processing_status"    text NOT NULL DEFAULT 'pending',
  "processing_attempts"  integer NOT NULL DEFAULT 0,
  "last_error"           text,
  "raw_headers"          jsonb NOT NULL DEFAULT '{}',
  "raw_body"             jsonb,
  "parsed_payload"       jsonb,
  "received_at"          timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processed_at"         timestamp,
  "created_at"           timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"           timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "po_provider_events_unique"
  ON "payment_orchestration_provider_events" ("provider", "provider_event_id");

CREATE INDEX IF NOT EXISTS "po_provider_events_merchant_idx"
  ON "payment_orchestration_provider_events" ("merchant_id");

CREATE INDEX IF NOT EXISTS "po_provider_events_reference_idx"
  ON "payment_orchestration_provider_events" ("provider", "provider_reference");

CREATE INDEX IF NOT EXISTS "po_provider_events_status_idx"
  ON "payment_orchestration_provider_events" ("processing_status");

CREATE INDEX IF NOT EXISTS "po_provider_events_received_at_idx"
  ON "payment_orchestration_provider_events" ("received_at");

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. payment_orchestration_idempotency_keys
-- Idempotency tracking for standalone create-intent and create-payment calls.
-- Not wired into live use cases until Phase 8D.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "payment_orchestration_idempotency_keys" (
  "id"                text PRIMARY KEY,
  "merchant_id"       text NOT NULL REFERENCES "payment_orchestration_merchants" ("id") ON DELETE CASCADE,
  "scope"             text NOT NULL,
  "idempotency_key"   text NOT NULL,
  "request_hash"      text NOT NULL,
  "response_snapshot" jsonb,
  "resource_type"     text,
  "resource_id"       text,
  "status"            text NOT NULL DEFAULT 'processing',
  "created_at"        timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"        timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at"        timestamp
);

CREATE UNIQUE INDEX IF NOT EXISTS "po_idempotency_merchant_scope_key_unique"
  ON "payment_orchestration_idempotency_keys" ("merchant_id", "scope", "idempotency_key");

CREATE INDEX IF NOT EXISTS "po_idempotency_expires_at_idx"
  ON "payment_orchestration_idempotency_keys" ("expires_at");

CREATE INDEX IF NOT EXISTS "po_idempotency_status_idx"
  ON "payment_orchestration_idempotency_keys" ("status");
