-- Migration 0001: po_provider_accounts
-- Provider account binding per merchant.
-- Foreign key to po_merchants defined inline at table creation.

CREATE TABLE "po_provider_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"provider" text NOT NULL,
	"provider_account_ref" text,
	"environment" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"credentials_ref" text,
	"public_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "po_provider_accounts_merchant_id_po_merchants_id_fk"
		FOREIGN KEY ("merchant_id") REFERENCES "po_merchants"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX "po_provider_accounts_merchant_idx" ON "po_provider_accounts" USING btree ("merchant_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "po_provider_accounts_merchant_provider_env_unique" ON "po_provider_accounts" USING btree ("merchant_id","provider","environment","provider_account_ref") WHERE "po_provider_accounts"."provider_account_ref" IS NOT NULL;
