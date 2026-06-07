-- Migration: 0008_po_audit_logs
-- Phase S8: Service Audit Log
-- Creates po_audit_logs table — immutable audit trail for all protected API activity.
-- No FK constraints: audit rows must survive merchant/client deletion.

CREATE TABLE IF NOT EXISTS "po_audit_logs" (
  "id"            text PRIMARY KEY,
  "request_id"    text NOT NULL,
  "client_id"     text,
  "source_app"    text,
  "merchant_id"   text,
  "actor_type"    text NOT NULL,
  "action"        text NOT NULL,
  "resource_type" text,
  "resource_id"   text,
  "status"        text NOT NULL,
  "http_method"   text,
  "path"          text,
  "status_code"   integer,
  "error_code"    text,
  "ip_address"    text,
  "user_agent"    text,
  "metadata"      jsonb NOT NULL DEFAULT '{}',
  "created_at"    timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "po_audit_logs_request_id_idx"
  ON "po_audit_logs" ("request_id");

CREATE INDEX IF NOT EXISTS "po_audit_logs_client_id_idx"
  ON "po_audit_logs" ("client_id");

CREATE INDEX IF NOT EXISTS "po_audit_logs_merchant_id_idx"
  ON "po_audit_logs" ("merchant_id");

CREATE INDEX IF NOT EXISTS "po_audit_logs_action_idx"
  ON "po_audit_logs" ("action");

CREATE INDEX IF NOT EXISTS "po_audit_logs_resource_idx"
  ON "po_audit_logs" ("resource_type", "resource_id");

CREATE INDEX IF NOT EXISTS "po_audit_logs_status_idx"
  ON "po_audit_logs" ("status");

CREATE INDEX IF NOT EXISTS "po_audit_logs_created_at_idx"
  ON "po_audit_logs" ("created_at");
