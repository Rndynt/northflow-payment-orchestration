CREATE TABLE IF NOT EXISTS po_merchant_webhook_endpoints (
  id text PRIMARY KEY,
  merchant_id text NOT NULL REFERENCES po_merchants(id) ON DELETE cascade,
  url text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  subscribed_events jsonb NOT NULL DEFAULT '[]'::jsonb,
  secret_hash text NOT NULL,
  secret_prefix text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  disabled_at timestamp
);
CREATE INDEX IF NOT EXISTS po_mwe_merchant_idx ON po_merchant_webhook_endpoints(merchant_id);
CREATE INDEX IF NOT EXISTS po_mwe_status_idx ON po_merchant_webhook_endpoints(status);

CREATE TABLE IF NOT EXISTS po_merchant_webhook_events (
  id text PRIMARY KEY,
  merchant_id text NOT NULL REFERENCES po_merchants(id) ON DELETE cascade,
  event_type text NOT NULL,
  resource_type text NOT NULL,
  resource_id text NOT NULL,
  payload jsonb NOT NULL,
  dedupe_key text NOT NULL,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS po_mwv_events_merchant_idx ON po_merchant_webhook_events(merchant_id);
CREATE INDEX IF NOT EXISTS po_mwv_events_resource_idx ON po_merchant_webhook_events(resource_type, resource_id);
CREATE UNIQUE INDEX IF NOT EXISTS po_mwv_events_dedupe_unique ON po_merchant_webhook_events(merchant_id, dedupe_key);

CREATE TABLE IF NOT EXISTS po_merchant_webhook_deliveries (
  id text PRIMARY KEY,
  event_id text NOT NULL REFERENCES po_merchant_webhook_events(id) ON DELETE cascade,
  endpoint_id text NOT NULL REFERENCES po_merchant_webhook_endpoints(id) ON DELETE cascade,
  merchant_id text NOT NULL REFERENCES po_merchants(id) ON DELETE cascade,
  status text NOT NULL DEFAULT 'queued',
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  next_attempt_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_attempt_at timestamp,
  last_response_status integer,
  last_response_body_truncated text,
  last_error text,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  delivered_at timestamp
);
CREATE INDEX IF NOT EXISTS po_mwv_deliveries_due_idx ON po_merchant_webhook_deliveries(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS po_mwv_deliveries_merchant_idx ON po_merchant_webhook_deliveries(merchant_id);
CREATE INDEX IF NOT EXISTS po_mwv_deliveries_endpoint_idx ON po_merchant_webhook_deliveries(endpoint_id);
CREATE UNIQUE INDEX IF NOT EXISTS po_mwv_deliveries_event_endpoint_unique ON po_merchant_webhook_deliveries(event_id, endpoint_id);
