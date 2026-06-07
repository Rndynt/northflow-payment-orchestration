---
name: S7.5 Payment Method Options
description: Implementation notes and gotchas for the payment method options feature (po_provider_account_methods table, sync/upsert/list/options use cases, method validation in CreateGatewayPayment).
---

# S7.5 Payment Method Options — Implementation Notes

## Architecture
- `po_provider_account_methods` table with FK to `po_merchants` AND `po_provider_accounts` (both are NOT NULL FK constraints).
- Use cases: `SyncProviderAccountMethods`, `UpsertProviderAccountMethod`, `ListProviderAccountMethods`, `GetPaymentMethodOptions`.
- `CreateGatewayPayment` takes optional 8th ctor param `methodRepo?`; only validates when methodRepo + providerAccountId provided AND provider account has ≥1 method in DB.
- Error codes: `PAYMENT_METHOD_NOT_AVAILABLE`, `PAYMENT_METHOD_DISABLED`, `PAYMENT_METHOD_AMOUNT_OUT_OF_RANGE`, `PAYMENT_METHOD_CURRENCY_UNSUPPORTED`.

## Provider capabilities
- `StandalonePaymentProvider` interface extended with optional `getPaymentMethodCapabilities?()`.
- `FakeGateway` → 6 methods (qris, va_bca, va_mandiri, va_bni, gopay, redirect), all IDR.
- `Manual` → 3 methods (cash, bank_transfer, manual).
- `Xendit` → capabilities defined but disabled in test environment.

## Duplicate import gotcha
- `StandalonePaymentProvider.ts` already imports `PaymentProviderAccount` at the top. Adding an S7.5 import block must NOT re-import it — only import `ProviderPaymentMethodCapability`.

## Test pattern
- Full test suite uses `node:test` + `node:assert/strict` via `tsx --test`. DO NOT use Vitest `describe/it/expect/beforeEach` in test files under `tests/` — they will fail in the node:test runner.
- DB integration tests for `DrizzleProviderAccountMethodRepository` must seed BOTH merchant AND provider account in real DB before inserting methods (FK constraints on both).
- Provider account seed requires `environment: 'test'` (NOT NULL column in `po_provider_accounts`).

## Migration
- `migrations/0007_supreme_wolfsbane.sql` — FK name was truncated by Postgres (NOTICE, not error). Applied cleanly.

**Why:** FK constraints on both merchant and PA columns means any DB test that inserts methods without seeding the parent tables will get a FK violation.

**How to apply:** When writing DB integration tests for method repo, always seed merchant + PA in the real DB using their respective Drizzle repos before seeding methods.
