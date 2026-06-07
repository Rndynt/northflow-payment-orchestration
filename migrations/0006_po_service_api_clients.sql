-- Migration 0006: po_api_clients, po_client_credentials, po_client_merchant_access
-- Service security and integration client isolation.
-- All three tables created here; foreign keys defined inline at table creation.
-- Order: api_clients → client_credentials (FK to api_clients)
--                    → client_merchant_access (FK to api_clients + po_merchants)

CREATE TABLE "po_api_clients" (
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
--> statement-breakpoint
CREATE TABLE "po_client_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"credential_prefix" text NOT NULL,
	"credential_hash" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"expires_at" timestamp,
	"last_used_at" timestamp,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"revoked_at" timestamp,
	CONSTRAINT "po_client_credentials_client_id_po_api_clients_id_fk"
		FOREIGN KEY ("client_id") REFERENCES "po_api_clients"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE "po_client_merchant_access" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"merchant_id" text NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"revoked_at" timestamp,
	CONSTRAINT "po_client_merchant_access_client_id_po_api_clients_id_fk"
		FOREIGN KEY ("client_id") REFERENCES "po_api_clients"("id") ON DELETE CASCADE,
	CONSTRAINT "po_client_merchant_access_merchant_id_po_merchants_id_fk"
		FOREIGN KEY ("merchant_id") REFERENCES "po_merchants"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX "po_api_clients_source_app_env_idx" ON "po_api_clients" USING btree ("source_app","environment");
--> statement-breakpoint
CREATE INDEX "po_api_clients_status_idx" ON "po_api_clients" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "po_client_credentials_client_idx" ON "po_client_credentials" USING btree ("client_id");
--> statement-breakpoint
CREATE INDEX "po_client_credentials_prefix_idx" ON "po_client_credentials" USING btree ("credential_prefix");
--> statement-breakpoint
CREATE INDEX "po_client_credentials_status_idx" ON "po_client_credentials" USING btree ("status");
--> statement-breakpoint
CREATE UNIQUE INDEX "po_client_merchant_access_unique" ON "po_client_merchant_access" USING btree ("client_id","merchant_id");
--> statement-breakpoint
CREATE INDEX "po_client_merchant_access_client_idx" ON "po_client_merchant_access" USING btree ("client_id");
--> statement-breakpoint
CREATE INDEX "po_client_merchant_access_merchant_idx" ON "po_client_merchant_access" USING btree ("merchant_id");
--> statement-breakpoint
CREATE INDEX "po_client_merchant_access_status_idx" ON "po_client_merchant_access" USING btree ("status");
