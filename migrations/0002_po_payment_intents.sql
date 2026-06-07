-- Migration 0002: po_intents
-- Payment intent / payable state.
-- Foreign keys to po_merchants and po_provider_accounts defined inline.

CREATE TABLE "po_intents" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"provider_account_id" text,
	"source_app" text,
	"external_tenant_id" text,
	"external_outlet_id" text,
	"external_location_id" text,
	"external_payable_type" text NOT NULL,
	"external_payable_id" text NOT NULL,
	"amount_due" integer NOT NULL,
	"amount_paid" integer DEFAULT 0 NOT NULL,
	"amount_refunded" integer DEFAULT 0 NOT NULL,
	"amount_remaining" integer NOT NULL,
	"currency" text DEFAULT 'IDR' NOT NULL,
	"status" text NOT NULL,
	"allow_partial" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "po_intents_merchant_id_po_merchants_id_fk"
		FOREIGN KEY ("merchant_id") REFERENCES "po_merchants"("id") ON DELETE CASCADE,
	CONSTRAINT "po_intents_provider_account_id_po_provider_accounts_id_fk"
		FOREIGN KEY ("provider_account_id") REFERENCES "po_provider_accounts"("id") ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX "po_intents_merchant_idx" ON "po_intents" USING btree ("merchant_id");
--> statement-breakpoint
CREATE INDEX "po_intents_source_app_tenant_idx" ON "po_intents" USING btree ("source_app","external_tenant_id");
--> statement-breakpoint
CREATE INDEX "po_intents_payable_idx" ON "po_intents" USING btree ("external_payable_type","external_payable_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "po_intents_merchant_payable_unique" ON "po_intents" USING btree ("merchant_id","source_app","external_payable_type","external_payable_id") WHERE "po_intents"."source_app" IS NOT NULL;
