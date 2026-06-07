-- Migration 0004: po_idempotency_keys
-- Idempotency safety — deduplication guard for create-intent, create-payment, refund.
-- Foreign key to po_merchants defined inline.

CREATE TABLE "po_idempotency_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"scope" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_snapshot" jsonb,
	"resource_type" text,
	"resource_id" text,
	"status" text DEFAULT 'processing' NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"expires_at" timestamp,
	CONSTRAINT "po_idempotency_keys_merchant_id_po_merchants_id_fk"
		FOREIGN KEY ("merchant_id") REFERENCES "po_merchants"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX "po_idempotency_merchant_scope_key_unique" ON "po_idempotency_keys" USING btree ("merchant_id","scope","idempotency_key");
--> statement-breakpoint
CREATE INDEX "po_idempotency_expires_at_idx" ON "po_idempotency_keys" USING btree ("expires_at");
--> statement-breakpoint
CREATE INDEX "po_idempotency_status_idx" ON "po_idempotency_keys" USING btree ("status");
