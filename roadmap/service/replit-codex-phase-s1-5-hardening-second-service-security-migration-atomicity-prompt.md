# Replit/Codex Prompt - S1-S5 Hardening Second Pass

Use this prompt for the second hardening pass.

## Project Decision

Use Drizzle migrations only. Do not use `psql` as the official migration path. Do not disable `db:migrate`. Do not keep manual-only migration instructions.

Official commands:

```bash
pnpm db:generate
pnpm db:migrate
```

## Scope

Do not implement dashboard features. Do not implement provider webhook roadmap work. Do not rewrite unrelated payment logic.

---

# P1.1 - Create Merchant Grant Atomicity

Fix `POST /v1/merchants` so a normal API client cannot create an orphan merchant without a client-to-merchant access grant.

Rules:

- If caller is not legacy/internal and access repository is missing, return `503 SERVICE_MISCONFIGURED` before creating merchant.
- Access grant creation must be awaited.
- Access grant creation errors must not be swallowed.
- Do not use `.catch(() => {})` for security-critical grant creation.
- Prefer an atomic transaction if current repository design supports it.
- If transaction support is not available yet, fail the request rather than returning success when grant creation fails.

Acceptance:

- Normal client cannot create merchant when access repo is missing.
- Normal client merchant creation fails if grant creation fails.
- Successful merchant creation creates active grant for authenticated client.
- Legacy/internal bypass remains explicit.

---

# P1.2 - Validate Generated API Credential Inputs

Fix `generateCredential(environment, credentialId)`.

Allowed:

- `environment`: lowercase letters, numbers, hyphen.
- `credentialId`: letters, numbers, hyphen.

Reject:

- empty values
- dots
- whitespace
- slashes
- underscores
- unsafe delimiter characters

Acceptance:

- valid values work
- invalid values throw clear errors
- tests cover invalid environment and credential IDs

---

# P1.3 - Full Drizzle Migration Cleanup With Prioritized Split

## Goal

Rebuild migration history so the current complete service schema is represented by a clean Drizzle migration chain with clear naming and operational priority.

Table names should stay short and readable with the `po_*` prefix. The problem to fix is the migration file structure, not the table prefix.

This repo is treated as pre-production for migration-lineage cleanup.

## Migration File Naming Rule

Use:

```txt
NNNN_<domain>_<purpose>.sql
```

Use `po` in migration names when it improves readability.

Do not collapse the whole current schema into one giant base dump. Split migrations by table/domain priority.

Recommended clean chain:

```txt
0000_po_merchants.sql
0001_po_provider_accounts.sql
0002_po_payment_intents.sql
0003_po_payment_transactions.sql
0004_po_idempotency_keys.sql
0005_po_provider_events.sql
0006_po_service_api_clients.sql
```

Alternative names are allowed only if they preserve the same priority and are equally clear.

## Priority Order Rule

Migration order must follow dependency and operational importance:

1. `po_merchants` — merchant/payment owner foundation.
2. `po_provider_accounts` — provider account binding per merchant.
3. `po_intents` — payment intent/payable state.
4. `po_transactions` — payment/refund/void transaction records.
5. `po_idempotency_keys` — idempotency safety.
6. `po_provider_events` — provider event intake/reprocess support.
7. `po_api_clients`, `po_client_credentials`, `po_client_merchant_access` — service security and integration client isolation.

## Per-Migration Completeness Rule

Each migration must create its table(s) completely at creation time.

When a table is introduced, define from the start:

- columns
- primary keys
- foreign keys to already-existing tables
- not-null rules
- defaults
- indexes
- unique indexes
- check constraints if used

Do not create a table incomplete and then add its current columns/constraints in a later migration.

## No ALTER ADD Rule For Current Schema

The clean current-schema migration chain must not contain:

- `ALTER TABLE ... ADD COLUMN`
- `ALTER TABLE ... ADD CONSTRAINT`
- any `ALTER TABLE ... ADD ...` pattern used to construct the current schema

Do not keep patch-style migrations for the current schema. Fold current schema definitions into the migration that introduces the table.

If Drizzle generates `ALTER TABLE ... ADD CONSTRAINT` for foreign keys, treat it as a migration cleanup failure for this phase. Normalize the migration so the final committed SQL creates the intended table/constraint structure without `ALTER TABLE ... ADD ...`, while keeping Drizzle journal/snapshot consistent.

`ALTER TABLE` is acceptable only for genuinely future schema changes after this cleanup, not for constructing the current clean chain.

## Cleanup Actions

1. Inspect `migrations/` and `migrations/meta/`.
2. Remove obsolete random-name, ad-hoc, manual-only, duplicate, one-giant-dump, and patch-style migrations from the official chain.
3. Replace the current one-file `0000_po_base_schema.sql` approach with prioritized migration files.
4. Regenerate or normalize a consistent Drizzle migration chain from `apps/service/src/infrastructure/schema.ts`.
5. Ensure `_journal.json` references real migration files in correct order.
6. Ensure snapshot metadata is present and consistent.
7. Ensure migration names are descriptive and scoped by table/domain priority.
8. Ensure `pnpm db:migrate` works on a clean database.
9. Ensure `pnpm db:generate` produces no unexpected diff right after cleanup.
10. Keep root and service `db:migrate` scripts using Drizzle migration.

## Documentation Update

Update `roadmap/service/migration-naming-cleanup.md` to state:

- Drizzle is the official migration system.
- Manual `psql` mode is not the project standard.
- table names use the short `po_*` prefix.
- migration files are split by scope/priority, not one giant base dump.
- migration files use clear `NNNN_<domain>_<purpose>.sql` names.
- old migration names are mapped to the new clean chain.
- journal and snapshot files are part of the official chain.
- clean database migration uses `pnpm db:migrate`.
- each table is defined fully in the migration where it is introduced.
- no `ALTER TABLE ADD` migration constructs the current schema.

Acceptance:

- Drizzle journal is not empty when migration files exist.
- Journal entries match real files in priority order.
- Snapshot metadata is present and consistent.
- Official migration files contain no invalid PostgreSQL syntax.
- Current-schema migration files contain no `ALTER TABLE ... ADD ...` construction.
- Current schema is split into prioritized migration files, not one giant `base` file.
- All current tables are fully defined when introduced.
- `db:migrate` uses Drizzle and is supported.

---

# P1.4 - Stronger HTTP Negative Tests for Grant Scopes

Add HTTP integration tests that hit real routes, not only helper/unit tests.

Required negative cases:

- gateway payment route: global action allowed but merchant grant lacks action -> `403 SCOPE_DENIED`
- reconcile route: global action allowed but merchant grant lacks action -> `403 SCOPE_DENIED`
- refund route: global action allowed but merchant grant lacks action -> `403 SCOPE_DENIED`
- refund route: merchant grant has action but global client scopes lack action -> `403 SCOPE_DENIED`

Use existing in-memory test infrastructure if possible.

---

# P1.5 - Preserve Error Envelope

Do not change the public error response envelope unless unavoidable. Do not put sensitive data in errors.

---

# Required Validation

Run:

```bash
pnpm type-check
pnpm test
pnpm db:generate
pnpm db:migrate
```

Migration validation must use a clean local/test database.

---

# Expected Final State

- create merchant cannot silently create orphan merchant grants
- generated credential inputs are validated
- migration history is Drizzle-only
- table names keep the short `po_*` prefix
- migration files are split by table/domain priority
- migration names are clear
- Drizzle journal and snapshots are consistent
- `db:migrate` is the official path
- each current table is defined completely in the migration where it is introduced
- no `ALTER TABLE ADD` migration constructs current schema
- HTTP tests prove grant-scope denial on real routes
