-- Migration 0000: po_merchants
-- Merchant/payment owner foundation — no upstream dependencies.
-- All columns, constraints, and indexes are defined inline at creation time.

CREATE TABLE "po_merchants" (
	"id" text PRIMARY KEY NOT NULL,
	"external_ref" text,
	"source_app" text,
	"name" text NOT NULL,
	"legal_name" text,
	"status" text DEFAULT 'active' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "po_merchants_source_app_ref_unique" ON "po_merchants" USING btree ("source_app","external_ref") WHERE "po_merchants"."source_app" IS NOT NULL AND "po_merchants"."external_ref" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "po_merchants_status_idx" ON "po_merchants" USING btree ("status");
