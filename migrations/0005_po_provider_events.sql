-- Migration 0005: po_provider_events
-- Provider event intake and reprocess support.
-- merchant_id is nullable (SET NULL on delete) — events can arrive before merchant resolved.
-- Foreign key to po_merchants defined inline.

CREATE TABLE "po_provider_events" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text,
	"provider" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"provider_reference" text,
	"event_type" text NOT NULL,
	"processing_status" text DEFAULT 'pending' NOT NULL,
	"processing_attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"raw_headers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"raw_body" jsonb,
	"parsed_payload" jsonb,
	"received_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"processed_at" timestamp,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "po_provider_events_merchant_id_po_merchants_id_fk"
		FOREIGN KEY ("merchant_id") REFERENCES "po_merchants"("id") ON DELETE SET NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "po_provider_events_unique" ON "po_provider_events" USING btree ("provider","provider_event_id");
--> statement-breakpoint
CREATE INDEX "po_provider_events_merchant_idx" ON "po_provider_events" USING btree ("merchant_id");
--> statement-breakpoint
CREATE INDEX "po_provider_events_reference_idx" ON "po_provider_events" USING btree ("provider","provider_reference");
--> statement-breakpoint
CREATE INDEX "po_provider_events_status_idx" ON "po_provider_events" USING btree ("processing_status");
--> statement-breakpoint
CREATE INDEX "po_provider_events_received_at_idx" ON "po_provider_events" USING btree ("received_at");
