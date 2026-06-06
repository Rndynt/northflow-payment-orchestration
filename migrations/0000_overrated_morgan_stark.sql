CREATE TABLE "payment_orchestration_api_clients" (
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
CREATE TABLE "payment_orchestration_client_credentials" (
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
--> statement-breakpoint
CREATE TABLE "payment_orchestration_client_merchant_access" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"merchant_id" text NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"revoked_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "payment_orchestration_idempotency_keys" (
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
	"expires_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "payment_orchestration_intents" (
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
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_orchestration_merchants" (
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
CREATE TABLE "payment_orchestration_provider_accounts" (
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
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_orchestration_provider_events" (
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
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_orchestration_transactions" (
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
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payment_orchestration_client_credentials" ADD CONSTRAINT "payment_orchestration_client_credentials_client_id_payment_orchestration_api_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."payment_orchestration_api_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_orchestration_client_merchant_access" ADD CONSTRAINT "payment_orchestration_client_merchant_access_client_id_payment_orchestration_api_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."payment_orchestration_api_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_orchestration_client_merchant_access" ADD CONSTRAINT "payment_orchestration_client_merchant_access_merchant_id_payment_orchestration_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."payment_orchestration_merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_orchestration_idempotency_keys" ADD CONSTRAINT "payment_orchestration_idempotency_keys_merchant_id_payment_orchestration_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."payment_orchestration_merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_orchestration_intents" ADD CONSTRAINT "payment_orchestration_intents_merchant_id_payment_orchestration_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."payment_orchestration_merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_orchestration_intents" ADD CONSTRAINT "payment_orchestration_intents_provider_account_id_payment_orchestration_provider_accounts_id_fk" FOREIGN KEY ("provider_account_id") REFERENCES "public"."payment_orchestration_provider_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_orchestration_provider_accounts" ADD CONSTRAINT "payment_orchestration_provider_accounts_merchant_id_payment_orchestration_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."payment_orchestration_merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_orchestration_provider_events" ADD CONSTRAINT "payment_orchestration_provider_events_merchant_id_payment_orchestration_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."payment_orchestration_merchants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_orchestration_transactions" ADD CONSTRAINT "payment_orchestration_transactions_merchant_id_payment_orchestration_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."payment_orchestration_merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_orchestration_transactions" ADD CONSTRAINT "payment_orchestration_transactions_intent_id_payment_orchestration_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."payment_orchestration_intents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_orchestration_transactions" ADD CONSTRAINT "payment_orchestration_transactions_provider_account_id_payment_orchestration_provider_accounts_id_fk" FOREIGN KEY ("provider_account_id") REFERENCES "public"."payment_orchestration_provider_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_orchestration_transactions" ADD CONSTRAINT "payment_orchestration_transactions_parent_transaction_id_payment_orchestration_transactions_id_fk" FOREIGN KEY ("parent_transaction_id") REFERENCES "public"."payment_orchestration_transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "po_api_clients_source_app_env_idx" ON "payment_orchestration_api_clients" USING btree ("source_app","environment");--> statement-breakpoint
CREATE INDEX "po_api_clients_status_idx" ON "payment_orchestration_api_clients" USING btree ("status");--> statement-breakpoint
CREATE INDEX "po_client_credentials_client_idx" ON "payment_orchestration_client_credentials" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "po_client_credentials_prefix_idx" ON "payment_orchestration_client_credentials" USING btree ("credential_prefix");--> statement-breakpoint
CREATE INDEX "po_client_credentials_status_idx" ON "payment_orchestration_client_credentials" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "po_client_merchant_access_unique" ON "payment_orchestration_client_merchant_access" USING btree ("client_id","merchant_id");--> statement-breakpoint
CREATE INDEX "po_client_merchant_access_client_idx" ON "payment_orchestration_client_merchant_access" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "po_client_merchant_access_merchant_idx" ON "payment_orchestration_client_merchant_access" USING btree ("merchant_id");--> statement-breakpoint
CREATE INDEX "po_client_merchant_access_status_idx" ON "payment_orchestration_client_merchant_access" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "po_idempotency_merchant_scope_key_unique" ON "payment_orchestration_idempotency_keys" USING btree ("merchant_id","scope","idempotency_key");--> statement-breakpoint
CREATE INDEX "po_idempotency_expires_at_idx" ON "payment_orchestration_idempotency_keys" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "po_idempotency_status_idx" ON "payment_orchestration_idempotency_keys" USING btree ("status");--> statement-breakpoint
CREATE INDEX "po_intents_merchant_idx" ON "payment_orchestration_intents" USING btree ("merchant_id");--> statement-breakpoint
CREATE INDEX "po_intents_source_app_tenant_idx" ON "payment_orchestration_intents" USING btree ("source_app","external_tenant_id");--> statement-breakpoint
CREATE INDEX "po_intents_payable_idx" ON "payment_orchestration_intents" USING btree ("external_payable_type","external_payable_id");--> statement-breakpoint
CREATE UNIQUE INDEX "po_intents_merchant_payable_unique" ON "payment_orchestration_intents" USING btree ("merchant_id","source_app","external_payable_type","external_payable_id") WHERE "payment_orchestration_intents"."source_app" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "po_merchants_source_app_ref_unique" ON "payment_orchestration_merchants" USING btree ("source_app","external_ref") WHERE "payment_orchestration_merchants"."source_app" IS NOT NULL AND "payment_orchestration_merchants"."external_ref" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "po_merchants_status_idx" ON "payment_orchestration_merchants" USING btree ("status");--> statement-breakpoint
CREATE INDEX "po_provider_accounts_merchant_idx" ON "payment_orchestration_provider_accounts" USING btree ("merchant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "po_provider_accounts_merchant_provider_env_unique" ON "payment_orchestration_provider_accounts" USING btree ("merchant_id","provider","environment","provider_account_ref") WHERE "payment_orchestration_provider_accounts"."provider_account_ref" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "po_provider_events_unique" ON "payment_orchestration_provider_events" USING btree ("provider","provider_event_id");--> statement-breakpoint
CREATE INDEX "po_provider_events_merchant_idx" ON "payment_orchestration_provider_events" USING btree ("merchant_id");--> statement-breakpoint
CREATE INDEX "po_provider_events_reference_idx" ON "payment_orchestration_provider_events" USING btree ("provider","provider_reference");--> statement-breakpoint
CREATE INDEX "po_provider_events_status_idx" ON "payment_orchestration_provider_events" USING btree ("processing_status");--> statement-breakpoint
CREATE INDEX "po_provider_events_received_at_idx" ON "payment_orchestration_provider_events" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "po_transactions_merchant_idx" ON "payment_orchestration_transactions" USING btree ("merchant_id");--> statement-breakpoint
CREATE INDEX "po_transactions_intent_idx" ON "payment_orchestration_transactions" USING btree ("intent_id");--> statement-breakpoint
CREATE INDEX "po_transactions_provider_reference_idx" ON "payment_orchestration_transactions" USING btree ("provider","provider_reference");--> statement-breakpoint
CREATE INDEX "po_transactions_expires_at_idx" ON "payment_orchestration_transactions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "po_transactions_merchant_idempotency_unique" ON "payment_orchestration_transactions" USING btree ("merchant_id","idempotency_key") WHERE "payment_orchestration_transactions"."idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "po_transactions_provider_reference_unique" ON "payment_orchestration_transactions" USING btree ("provider","provider_reference") WHERE "payment_orchestration_transactions"."provider_reference" IS NOT NULL;