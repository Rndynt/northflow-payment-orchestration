# Migration Naming & Structure Cleanup

## Status: Complete (P1.3)

The migration history has been rebuilt with a clean, prioritized Drizzle chain.

---

## Official Migration System

**Drizzle ORM is the sole, official migration system for this service.**

- Run migrations: `pnpm db:migrate`
- Generate new migrations: `pnpm db:generate`
- Manual `psql` is not the project standard and must not be used as the primary migration path.
- `db:migrate` is always supported and must stay wired.

---

## Table Names

All tables use the short `po_*` prefix (not the verbose `payment_orchestration_*`).
Table names are stable and must not be renamed without a migration.

---

## Migration File Structure

Migrations are split by table/domain priority — **not** a single base dump.
Each file uses the naming convention:

```
NNNN_<domain>_<purpose>.sql
```

### Current Clean Chain

| File | Tables Created |
|------|----------------|
| `0000_po_merchants.sql` | `po_merchants` |
| `0001_po_provider_accounts.sql` | `po_provider_accounts` |
| `0002_po_payment_intents.sql` | `po_intents` |
| `0003_po_payment_transactions.sql` | `po_transactions` |
| `0004_po_idempotency_keys.sql` | `po_idempotency_keys` |
| `0005_po_provider_events.sql` | `po_provider_events` |
| `0006_po_service_api_clients.sql` | `po_api_clients`, `po_client_credentials`, `po_client_merchant_access` |

### Priority Order Rationale

1. `po_merchants` — owner foundation; everything cascades from merchants.
2. `po_provider_accounts` — FK to merchants; must exist before intents reference them.
3. `po_intents` — FK to merchants + provider_accounts.
4. `po_transactions` — FK to merchants, intents, provider_accounts, and self (parent).
5. `po_idempotency_keys` — FK to merchants; safety layer for payment operations.
6. `po_provider_events` — FK to merchants (nullable SET NULL); webhook intake.
7. `po_api_clients`, `po_client_credentials`, `po_client_merchant_access` — service auth layer; cross-references merchants and api_clients.

---

## Per-Migration Completeness

Each migration defines its table(s) **completely at creation time**:

- All columns
- Primary keys
- Foreign keys (as inline `CONSTRAINT ... REFERENCES` in `CREATE TABLE`)
- NOT NULL / DEFAULT rules
- All indexes (regular and unique)

**The current-schema migration chain contains no `ALTER TABLE ... ADD COLUMN` or `ALTER TABLE ... ADD CONSTRAINT` statements.**
Foreign key constraints that Drizzle would normally generate as `ALTER TABLE ADD CONSTRAINT` are instead written as inline table-level constraints in `CREATE TABLE`.

---

## Journal & Snapshot Files

The Drizzle journal (`migrations/meta/_journal.json`) lists all 7 entries in priority order.
Each migration has a corresponding snapshot file in `migrations/meta/` that records the cumulative schema state at that point.

These files are part of the official migration chain and must be kept consistent:
- Do not delete snapshot files.
- Do not manually edit `_journal.json` without also updating snapshots.
- After any schema change, run `pnpm db:generate` to produce a new migration and snapshot.

---

## Running on a Clean Database

```bash
# Apply all migrations in order to a fresh database:
pnpm db:migrate

# Verify no schema drift after cleanup:
pnpm db:generate
# → Should produce no new migration (empty diff).
```

---

## Old Migration Names → New Clean Chain

| Old File | Replaced By |
|----------|-------------|
| `0001_payment_orchestration_initial.sql` | Split across 0000–0006 |
| `0002_refund_void_manual_parity.sql` | Folded into `0003_po_payment_transactions` |
| `0003_s1_api_client_registry.sql` | Folded into `0006_po_service_api_clients` |
| `0000_po_base_schema.sql` (giant single dump) | Split across 0000–0006 |
