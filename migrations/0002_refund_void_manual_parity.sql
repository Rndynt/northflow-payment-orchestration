-- Migration: 0002_refund_void_manual_parity.sql
-- Phase 8F — Refund, Void, and Manual Provider Parity
--
-- Context:
--   This migration supports the legacy AuraPoS payment capability parity migration
--   into the standalone northflow-payment-orchestration service.
--
-- Schema assessment:
--   The existing payment_orchestration_transactions table already supports all columns
--   required for refund/void operations:
--     - parent_transaction_id  — FK to self (refund chain)
--     - direction              — 'incoming' | 'outgoing'
--     - transaction_type       — 'payment' | 'refund' | 'void' | etc.
--     - status                 — text; accepts 'cancelled', 'refunded', 'voided', etc.
--     - idempotency_key        — for refund idempotency
--     - failure_reason         — for failed provider cancel/refund results
--
--   No new columns are needed.
--
-- This migration adds a composite index to accelerate refund sum queries
-- (used by sumSucceededRefundsByParent in DrizzlePaymentTransactionRepository).

CREATE INDEX IF NOT EXISTS po_transactions_parent_type_status_idx
  ON payment_orchestration_transactions (parent_transaction_id, transaction_type, status)
  WHERE parent_transaction_id IS NOT NULL;
