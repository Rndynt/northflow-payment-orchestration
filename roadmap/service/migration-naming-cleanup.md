# Migration Naming Cleanup — Northflow Payment Orchestration Service

## Goal

Establish consistent, audit-friendly migration file names and remove confusing
artefacts introduced during the S1 per-client credential registry work.

---

## Naming Rule

```
NNNN_<domain>_<purpose>.sql
```

Example:
```
0001_payment_orchestration_initial.sql
0002_refund_void_manual_parity.sql
0003_service_api_client_registry.sql
0004_service_security_hardening.sql
```

---

## Current Migration Files

| File | Status | Description |
|------|--------|-------------|
| `0001_payment_orchestration_initial.sql` | ✅ Applied | Base 6 tables: merchants, provider_accounts, intents, transactions, provider_events, idempotency_keys |
| `0002_refund_void_manual_parity.sql` | ✅ Applied | Phase 8F — adds direction, parent_transaction_id, transaction_type columns to transactions |
| `0003_s1_api_client_registry.sql` | ✅ Applied | S1 — adds api_clients, client_credentials, client_merchant_access tables + indexes |
| ~~`0000_overrated_morgan_stark.sql`~~ | 🗑️ Removed | Drizzle-kit auto-generated all-table dump (never applied to DB; removed) |

---

## Chosen Strategy: Strategy B — Applied Migrations Preserved

Since the development database already has all migrations applied, we do not rename
existing files. Renaming applied migration files would break drizzle-kit lineage tracking
for any deployment that uses `drizzle-kit migrate`.

**Files `0001`, `0002`, and `0003` are kept as-is.**

---

## Known Issues Fixed

### 1. Drizzle-kit journal inconsistency (fixed)

`migrations/meta/_journal.json` previously referenced the removed `0000_overrated_morgan_stark`
migration. The journal has been reset to an empty entries list because:
- Migration tracking for this project is done via direct `psql` application, not `drizzle-kit migrate`.
- `drizzle-kit` is used only for schema diffing (`db:generate`), not for migration execution.
- The empty journal prevents drizzle-kit from attempting to apply the wrong files.

### 2. Invalid PostgreSQL constraint syntax in `0003` (documented)

`0003_s1_api_client_registry.sql` contained:
```sql
ALTER TABLE ... ADD CONSTRAINT IF NOT EXISTS ...  -- ❌ invalid in PostgreSQL
```

This syntax was applied via `psql` and the constraint errors were accepted (tables were
created; constraints were applied separately). The valid constraints are now in the database.

For future migrations, use the safe conditional pattern:
```sql
DO $$
BEGIN
  ALTER TABLE "payment_orchestration_client_credentials"
    ADD CONSTRAINT "fk_client_credentials_client_id"
    FOREIGN KEY ("client_id") REFERENCES "payment_orchestration_api_clients"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
```

---

## Migration Tool Usage

| Command | Purpose |
|---------|---------|
| `pnpm db:generate` | Generate diff SQL from schema changes (use as reference only) |
| `psql $DATABASE_URL -f migrations/<file>.sql` | Apply migration directly |
| `pnpm db:migrate` | NOT recommended — drizzle journal does not match applied history |

---

## Safety Notes

- Do not rename `0001`, `0002`, or `0003` — they are applied and referenced by DB history.
- Any new schema changes should use a new `0004_...sql` file applied via `psql`.
- Always use `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS` for new migrations.
- Never use `ADD CONSTRAINT IF NOT EXISTS` — use the `DO $$ BEGIN ... EXCEPTION ... END $$` pattern.
- The `migrations/meta/` directory is maintained for drizzle-kit's internal use only.

---

## Proposed Future Descriptive Names (for new deployments)

If this project is ever deployed fresh from a clean database, descriptive names can be used:

| New Name | Maps From |
|----------|-----------|
| `0000_payment_orchestration_base_tables.sql` | `0001_payment_orchestration_initial.sql` |
| `0001_refund_void_transaction_parity.sql` | `0002_refund_void_manual_parity.sql` |
| `0002_service_api_client_registry.sql` | `0003_s1_api_client_registry.sql` |

For the current deployed environment, use the existing names in the table above.
