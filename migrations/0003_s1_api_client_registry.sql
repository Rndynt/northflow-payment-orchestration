-- S1: Per-client API credential registry
-- Adds api_clients, client_credentials, and client_merchant_access tables.

CREATE TABLE IF NOT EXISTS "payment_orchestration_api_clients" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "source_app" text NOT NULL,
  "environment" text DEFAULT 'production' NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS "payment_orchestration_client_credentials" (
  "id" text PRIMARY KEY NOT NULL,
  "client_id" text NOT NULL,
  "credential_prefix" text NOT NULL,
  "credential_hash" text NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "expires_at" timestamp,
  "last_used_at" timestamp,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "revoked_at" timestamp
);

CREATE TABLE IF NOT EXISTS "payment_orchestration_client_merchant_access" (
  "id" text PRIMARY KEY NOT NULL,
  "client_id" text NOT NULL,
  "merchant_id" text NOT NULL,
  "scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "revoked_at" timestamp
);

-- Foreign keys
ALTER TABLE "payment_orchestration_client_credentials"
  ADD CONSTRAINT IF NOT EXISTS "payment_orchestration_client_credentials_client_id_fk"
  FOREIGN KEY ("client_id") REFERENCES "payment_orchestration_api_clients"("id") ON DELETE cascade;

ALTER TABLE "payment_orchestration_client_merchant_access"
  ADD CONSTRAINT IF NOT EXISTS "payment_orchestration_client_merchant_access_client_id_fk"
  FOREIGN KEY ("client_id") REFERENCES "payment_orchestration_api_clients"("id") ON DELETE cascade;

ALTER TABLE "payment_orchestration_client_merchant_access"
  ADD CONSTRAINT IF NOT EXISTS "payment_orchestration_client_merchant_access_merchant_id_fk"
  FOREIGN KEY ("merchant_id") REFERENCES "payment_orchestration_merchants"("id") ON DELETE cascade;

-- Indexes
CREATE INDEX IF NOT EXISTS "po_api_clients_source_app_env_idx"
  ON "payment_orchestration_api_clients" ("source_app", "environment");

CREATE INDEX IF NOT EXISTS "po_api_clients_status_idx"
  ON "payment_orchestration_api_clients" ("status");

CREATE INDEX IF NOT EXISTS "po_client_credentials_client_idx"
  ON "payment_orchestration_client_credentials" ("client_id");

CREATE INDEX IF NOT EXISTS "po_client_credentials_prefix_idx"
  ON "payment_orchestration_client_credentials" ("credential_prefix");

CREATE INDEX IF NOT EXISTS "po_client_credentials_status_idx"
  ON "payment_orchestration_client_credentials" ("status");

CREATE UNIQUE INDEX IF NOT EXISTS "po_client_merchant_access_unique"
  ON "payment_orchestration_client_merchant_access" ("client_id", "merchant_id");

CREATE INDEX IF NOT EXISTS "po_client_merchant_access_client_idx"
  ON "payment_orchestration_client_merchant_access" ("client_id");

CREATE INDEX IF NOT EXISTS "po_client_merchant_access_merchant_idx"
  ON "payment_orchestration_client_merchant_access" ("merchant_id");

CREATE INDEX IF NOT EXISTS "po_client_merchant_access_status_idx"
  ON "payment_orchestration_client_merchant_access" ("status");
