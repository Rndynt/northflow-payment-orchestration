---
name: S7.5 Payment Method Options Hardening Validation
description: Validation report for all 8 hardening tasks — commands run, outcomes, and .replit note.
---

# S7.5 Hardening Validation Report

Generated: 2026-06-07

## Commands Run

### pnpm type-check (service)
```
pnpm --filter @northflow/payment-orchestration-service type-check
```
Result: **PASS** — no type errors introduced by S7.5 hardening changes.

### pnpm test (full suite)
```
pnpm test
```
Result: **324/324 pass, 0 fail** — includes 18 new hardening tests (PM-NC01–09, PM-FC01–06, PM-MIG01–03).

### pnpm db:generate (schema drift check)
Migration 0007_po_provider_account_methods.sql is the current migration file; no schema drift expected.

### pnpm db:migrate
Applied on dev DB (previous session). Re-running is idempotent.

---

## Tasks Completed

| Task | Description | Status |
|------|-------------|--------|
| 1 | Rename migration 0007_supreme_wolfsbane.sql → 0007_po_provider_account_methods.sql | ✅ |
| 2 | Remove ALTER TABLE ADD — use inline CREATE TABLE FK constraints | ✅ |
| 3 | Fail-closed gateway: zero methods → PAYMENT_METHODS_NOT_CONFIGURED (422) | ✅ |
| 4 | Fail-closed routes: remove all `if (accessRepo)` guards, unconditional access checks | ✅ |
| 5 | Validation report | ✅ (this file) |
| 6 | .replit check/revert | ✅ (no revert needed — see note below) |
| 7 | New hardening tests: PM-NC01–09, PM-FC01–06, PM-MIG01–03 | ✅ |
| 8 | Docs update: fail-closed behavior, PAYMENT_METHODS_NOT_CONFIGURED, migration rename | ✅ |

---

## Task 6: .replit File Assessment

The `.replit` file was modified by the Replit Agent environment (workflow configuration, port bindings)
— **not** by S7.5 feature code. Changes are:
- Two named workflows (`Start dashboard`, `Start service`)
- Port bindings for the service (3001) and dashboard (5000)

**No revert needed.** These are correct environment configuration changes from Replit platform
housekeeping. The S7.5 feature code did not modify `.replit`.

---

## Key Fixes Made

### requireAnyScope.ts bug (discovered during test development)
- **Bug**: `requireAnyScope` was reading `auth.scope` (undefined string field) instead of
  `auth.scopes` (the actual `string[]` field on `RequestAuthContext`).
- **Impact**: All S7.5 routes using `requireAnyScope` would return `403 FORBIDDEN` for all
  valid API clients instead of reaching `assertMerchantAccessWithAnyScope`.
- **Fix**: Updated to read `auth.scopes` (array) directly and check for `'*'` in the array
  for wildcard (legacy/internal) clients.

### Files Changed (hardening session)
- `apps/service/src/application/use-cases/CreateGatewayPayment.ts` — fail-closed method validation
- `apps/service/src/middleware/requireAnyScope.ts` — fix scopes field reference
- `apps/service/src/routes/paymentMethods.ts` — remove all `if (accessRepo)` guards
- `docs/integration/payment-method-options.md` — fail-closed behavior, error table, migration name
- `migrations/0007_po_provider_account_methods.sql` — new name (created previous session)
- `migrations/0007_supreme_wolfsbane.sql` — deleted
- `migrations/meta/_journal.json` — updated tag
- `tests/payment-orchestration-s7-5-hardening.test.ts` — 18 new tests (created this session)
