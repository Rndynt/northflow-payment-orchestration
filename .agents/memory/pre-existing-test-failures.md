---
name: Pre-existing test failures
description: Known pre-existing failures unrelated to S1-S5 hardening work. Updated after final S1-S5 verification pass.
---

## Fixed in S1-S5 Hardening Pass

The following were recorded as pre-existing but were fixed during the hardening work:

- **AC10** (`tests/payment-orchestration-atomic-confirm.test.ts`) — Fixed by adding `allowPartial: true` to `setupMerchantAndIntent` for the overpayment guard scenario.
- **S16** (`tests/payment-orchestration-service-fakegateway-flow.test.ts`) — Fixed by adding `allowPartial: true` to the S16 intent creation.

All 249 unit/integration tests now pass.

---

## Active Pre-existing Failures (Not Caused by Hardening Work)

### Dashboard TypeScript type-check

**Command:** `pnpm type-check` (turbo — runs dashboard + service + core)

**Failing package:** `@northflow/payment-orchestration-dashboard`

**Errors:**

1. `src/components/ui/input.tsx(6,18): error TS2430` — `Interface 'InputProps' incorrectly extends InputHTMLAttributes<HTMLInputElement>`. The `prefix` property type `ReactNode` is incompatible with `string | undefined`.

2. `../../packages/client-sdk/src/client.ts(24,83): error TS5097` — Import path ending with `.ts` extension not allowed unless `allowImportingTsExtensions` is enabled.

3. Similar TS5097 errors in `packages/client-sdk/src/index.ts` (lines 39, 40, 73, 75, 77).

**Scope:** These are in the dashboard UI component library and client-sdk package — outside the `apps/service` hardening scope.

**Service-only type-check passes:** `pnpm --filter @northflow/payment-orchestration-service type-check` → clean.

**How to fix (when in scope):**
- For TS2430: Update `InputProps` to not extend `InputHTMLAttributes<HTMLInputElement>` directly, or use `Omit<InputHTMLAttributes<HTMLInputElement>, 'prefix'>`.
- For TS5097: Add `"allowImportingTsExtensions": true` to `packages/client-sdk/tsconfig.json`, or remove `.ts` from import paths.

---

## Drizzle Migration DB Sync Note

After rebuilding the migration chain from monolithic → 7-file prioritized chain, the `drizzle.__drizzle_migrations` tracking table may be out of sync with the new journal. To resync on a dev database:

```bash
# Drop all po_* tables and clear Drizzle tracking
psql "$DATABASE_URL" -c "
DROP TABLE IF EXISTS po_client_merchant_access, po_client_credentials, po_api_clients,
  po_idempotency_keys, po_provider_events, po_transactions, po_intents,
  po_provider_accounts, po_merchants CASCADE;
DELETE FROM drizzle.__drizzle_migrations;
"
# Re-apply clean 7-file chain
pnpm db:migrate
```

This is only needed once after the migration chain was rebuilt. On a fresh database, `pnpm db:migrate` works directly.
