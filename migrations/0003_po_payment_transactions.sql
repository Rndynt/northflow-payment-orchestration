-- Migration 0003: po_transactions
-- Payment, refund, and void transaction records.
-- Foreign keys to po_merchants, po_intents, po_provider_accounts, and self (parent_transaction_id)
-- are all defined inline at table creation — no ALTER TABLE needed.

CREATE TABLE "po_transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"intent_id" text NOT NULL,
	"provider_account_id" text,
	"provider" text NOT NULL,
	"method" text NOT NULL,
	"transaction_type" text NOT NULL,
	"status" text NOT NULL,
	"direction" text NOT NULL,
	"amount" integer NOT NULL,
	"currency" text DEFAULT 'IDR' NOT NULL,
	"parent_transaction_id" text,
	"provider_reference" text,
	"provider_event_id" text,
	"provider_payment_url" text,
	"provider_qr_string" text,
	"failure_reason" text,
	"idempotency_key" text,
	"expires_at" timestamp,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"raw_provider_response" jsonb,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "po_transactions_merchant_id_po_merchants_id_fk"
		FOREIGN KEY ("merchant_id") REFERENCES "po_merchants"("id") ON DELETE CASCADE,
	CONSTRAINT "po_transactions_intent_id_po_intents_id_fk"
		FOREIGN KEY ("intent_id") REFERENCES "po_intents"("id") ON DELETE CASCADE,
	CONSTRAINT "po_transactions_provider_account_id_po_provider_accounts_id_fk"
		FOREIGN KEY ("provider_account_id") REFERENCES "po_provider_accounts"("id") ON DELETE SET NULL,
	CONSTRAINT "po_transactions_parent_transaction_id_po_transactions_id_fk"
		FOREIGN KEY ("parent_transaction_id") REFERENCES "po_transactions"("id") ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX "po_transactions_merchant_idx" ON "po_transactions" USING btree ("merchant_id");
--> statement-breakpoint
CREATE INDEX "po_transactions_intent_idx" ON "po_transactions" USING btree ("intent_id");
--> statement-breakpoint
CREATE INDEX "po_transactions_provider_reference_idx" ON "po_transactions" USING btree ("provider","provider_reference");
--> statement-breakpoint
CREATE INDEX "po_transactions_expires_at_idx" ON "po_transactions" USING btree ("expires_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "po_transactions_merchant_idempotency_unique" ON "po_transactions" USING btree ("merchant_id","idempotency_key") WHERE "po_transactions"."idempotency_key" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "po_transactions_provider_reference_unique" ON "po_transactions" USING btree ("provider","provider_reference") WHERE "po_transactions"."provider_reference" IS NOT NULL;
