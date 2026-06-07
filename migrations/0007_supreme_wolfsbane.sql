CREATE TABLE "po_provider_account_methods" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"provider" text NOT NULL,
	"method" text NOT NULL,
	"method_type" text NOT NULL,
	"provider_method_code" text,
	"display_name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"currency" text DEFAULT 'IDR' NOT NULL,
	"min_amount" integer,
	"max_amount" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"public_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"provider_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "po_provider_account_methods" ADD CONSTRAINT "po_provider_account_methods_merchant_id_po_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."po_merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "po_provider_account_methods" ADD CONSTRAINT "po_provider_account_methods_provider_account_id_po_provider_accounts_id_fk" FOREIGN KEY ("provider_account_id") REFERENCES "public"."po_provider_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "po_pam_provider_account_idx" ON "po_provider_account_methods" USING btree ("provider_account_id");--> statement-breakpoint
CREATE INDEX "po_pam_merchant_idx" ON "po_provider_account_methods" USING btree ("merchant_id");--> statement-breakpoint
CREATE INDEX "po_pam_provider_method_idx" ON "po_provider_account_methods" USING btree ("provider","method");--> statement-breakpoint
CREATE INDEX "po_pam_status_idx" ON "po_provider_account_methods" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "po_pam_provider_account_method_unique" ON "po_provider_account_methods" USING btree ("provider_account_id","method");