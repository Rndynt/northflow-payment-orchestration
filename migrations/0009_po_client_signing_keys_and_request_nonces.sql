-- Migration: 0009_po_client_signing_keys_and_request_nonces
-- Phase S9.4: Signed Requests / HMAC
--
-- Table 1: po_client_signing_keys
--   Stores HMAC signing keys for API clients.
--   secret_ciphertext is AES-256-GCM encrypted — never plaintext.
--   Raw signing secret is returned only once on create/rotate.
--
-- Table 2: po_request_nonces
--   Replay protection store for signed requests.
--   Unique constraint on (signing_key_id, nonce) prevents replay.
--   Rows expire after nonce TTL and can be cleaned up periodically.

CREATE TABLE IF NOT EXISTS "po_client_signing_keys" (
  "id"                  text PRIMARY KEY,
  "client_id"           text NOT NULL REFERENCES "po_api_clients"("id") ON DELETE CASCADE,
  "key_prefix"          text NOT NULL,
  "secret_ciphertext"   text NOT NULL,
  "secret_nonce"        text,
  "secret_key_version"  text,
  "status"              text NOT NULL DEFAULT 'active',
  "expires_at"          timestamp,
  "last_used_at"        timestamp,
  "created_at"          timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revoked_at"          timestamp,
  "metadata"            jsonb NOT NULL DEFAULT '{}'
);

CREATE UNIQUE INDEX IF NOT EXISTS "po_client_signing_keys_prefix_unique"
  ON "po_client_signing_keys" ("key_prefix");

CREATE INDEX IF NOT EXISTS "po_client_signing_keys_client_idx"
  ON "po_client_signing_keys" ("client_id");

CREATE INDEX IF NOT EXISTS "po_client_signing_keys_status_idx"
  ON "po_client_signing_keys" ("status");

CREATE INDEX IF NOT EXISTS "po_client_signing_keys_expires_at_idx"
  ON "po_client_signing_keys" ("expires_at");

CREATE INDEX IF NOT EXISTS "po_client_signing_keys_last_used_at_idx"
  ON "po_client_signing_keys" ("last_used_at");

CREATE TABLE IF NOT EXISTS "po_request_nonces" (
  "id"             text PRIMARY KEY,
  "client_id"      text NOT NULL REFERENCES "po_api_clients"("id") ON DELETE CASCADE,
  "signing_key_id" text NOT NULL REFERENCES "po_client_signing_keys"("id") ON DELETE CASCADE,
  "nonce"          text NOT NULL,
  "timestamp"      timestamp NOT NULL,
  "expires_at"     timestamp NOT NULL,
  "created_at"     timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metadata"       jsonb NOT NULL DEFAULT '{}'
);

CREATE UNIQUE INDEX IF NOT EXISTS "po_request_nonces_key_nonce_unique"
  ON "po_request_nonces" ("signing_key_id", "nonce");

CREATE INDEX IF NOT EXISTS "po_request_nonces_client_idx"
  ON "po_request_nonces" ("client_id");

CREATE INDEX IF NOT EXISTS "po_request_nonces_signing_key_idx"
  ON "po_request_nonces" ("signing_key_id");

CREATE INDEX IF NOT EXISTS "po_request_nonces_expires_at_idx"
  ON "po_request_nonces" ("expires_at");

CREATE INDEX IF NOT EXISTS "po_request_nonces_created_at_idx"
  ON "po_request_nonces" ("created_at");
