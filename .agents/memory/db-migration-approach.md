---
name: DB migration approach
description: How schema migrations are managed — Drizzle-only, 7-file prioritized chain with po_* table prefix.
---

# DB Migration Approach

## The Rule

**Drizzle ORM is the sole, official migration system.** Do not use psql directly for schema migrations.

- `pnpm db:migrate` — applies pending migrations via `drizzle-kit migrate`
- `pnpm db:generate` — generates a new migration file after schema changes in `apps/service/src/infrastructure/schema.ts`

## Migration Chain

7 prioritized files in `migrations/` (root), each in `po_*` naming:

| File | Tables |
|---|---|
| `0000_po_merchants.sql` | `po_merchants` |
| `0001_po_provider_accounts.sql` | `po_provider_accounts` |
| `0002_po_payment_intents.sql` | `po_intents` |
| `0003_po_payment_transactions.sql` | `po_transactions` |
| `0004_po_idempotency_keys.sql` | `po_idempotency_keys` |
| `0005_po_provider_events.sql` | `po_provider_events` |
| `0006_po_service_api_clients.sql` | `po_api_clients`, `po_client_credentials`, `po_client_merchant_access` |

## Key Constraints

- Table prefix: `po_*` (NOT `payment_orchestration_*` — renamed during S1-S5 work)
- No `ALTER TABLE ... ADD` in any migration file — all FKs are inline in `CREATE TABLE`
- All TypeScript schema variables in `schema.ts` use `po*` names (e.g. `poMerchants`, `poApiClients`)
- Drizzle tracking table: `drizzle.__drizzle_migrations` (internal — do not edit manually)

## If DB Tracking Gets Out of Sync

Only needed after rebuilding the migration chain on a dev database:

```bash
psql "$DATABASE_URL" -c "
DROP TABLE IF EXISTS po_client_merchant_access, po_client_credentials, po_api_clients,
  po_idempotency_keys, po_provider_events, po_transactions, po_intents,
  po_provider_accounts, po_merchants CASCADE;
DELETE FROM drizzle.__drizzle_migrations;
"
pnpm db:migrate
```

**Why:** The original setup used psql-based migrations. During S1-S5 hardening, the full chain was rebuilt as a Drizzle-managed prioritized 7-file sequence. On a fresh database, `pnpm db:migrate` works directly without any manual steps.
