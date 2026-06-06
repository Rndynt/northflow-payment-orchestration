# Replit/Codex Prompt - S1-S5 Hardening Second Pass V2

This prompt supersedes:

`roadmap/service/replit-codex-phase-s1-5-hardening-second-service-security-migration-atomicity-prompt.md`

Use this V2 prompt for the second hardening pass.

## Non-Negotiable Project Decision

Use Drizzle migrations only.

Do not use `psql` as the official migration execution path.
Do not disable `db:migrate`.
Do not recommend manual migration mode in docs.
Do not leave Drizzle journal or snapshots inconsistent.

Official commands must be:

```bash
pnpm db:generate
pnpm db:migrate
```

or the equivalent workspace-filtered service commands.

---

# P1.1 - Create Merchant Grant Atomicity

Fix `POST /v1/merchants` so a normal API client cannot create an orphan merchant without a client-to-merchant access grant.

Rules:

- If the caller is not legacy/internal and the access repository is missing, return `503 SERVICE_MISCONFIGURED` before creating the merchant.
- Access grant creation must be awaited.
- Access grant creation errors must not be swallowed.
- Do not use `.catch(() => {})` for security-critical grant creation.
- Prefer an atomic transaction if the current repository design supports it.
- If transaction support is not available yet, fail the request rather than returning success when grant creation fails.

Acceptance:

- Normal client cannot create merchant when access repo is missing.
- Normal client merchant creation fails if grant creation fails.
- Successful merchant creation creates an active grant for the authenticated client.
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
- any unsafe delimiter character

Acceptance:

- valid values work
- invalid values throw clear errors
- tests cover invalid environment and credential IDs

---

# P1.3 - Full Drizzle Migration Cleanup

## Goal

Rebuild migration history so the current complete service schema is represented by a clean Drizzle baseline with clear naming.

This repo is treated as pre-production for migration lineage cleanup.

## Naming Rule

Use:

```txt
NNNN_<domain>_<purpose>.sql
```

Preferred baseline name:

```txt
0000_payment_orchestration_base_schema.sql
```

Future examples:

```txt
0001_service_security_hardening.sql
0002_dashboard_management_tables.sql
0003_provider_webhook_hardening.sql
```

## Baseline-First Rule

All current payment orchestration tables must be fully defined from the first official Drizzle migration.

The baseline must define from the start:

- tables
- columns
- primary keys
- foreign keys
- not-null rules
- defaults
- indexes
- unique indexes
- check constraints if used

## No ALTER ADD Rule

The official clean baseline/current schema migration must not contain:

- `ALTER TABLE ... ADD COLUMN`
- `ALTER TABLE ... ADD CONSTRAINT`
- any `ALTER TABLE ... ADD ...` pattern used to construct the current schema

Do not keep patch-style migrations for the current schema.

Fold current schema definitions into the Drizzle baseline instead of keeping repair migrations such as:

- add refund columns
- add transaction type
- add API client tables
- add missing constraints
- fix invalid constraints

`ALTER TABLE` is only acceptable for future migrations after this cleanup, not for constructing the current baseline.

## Cleanup Actions

1. Inspect `migrations/` and `migrations/meta/`.
2. Remove obsolete random-name, ad-hoc, manual-only, duplicate, and patch-style migrations from the official chain.
3. Remove the manual S1 registry migration from the official chain if its definitions are folded into baseline.
4. Regenerate a consistent Drizzle migration chain from `apps/service/src/infrastructure/schema.ts`.
5. Ensure `_journal.json` references real migration files in correct order.
6. Ensure snapshot metadata is present and consistent.
7. Ensure migration names are descriptive.
8. Ensure `pnpm db:migrate` works on a clean database.
9. Ensure `pnpm db:generate` produces no unexpected diff right after cleanup.
10. Keep root and service `db:migrate` scripts using Drizzle migration.

## Documentation Update

Update:

`roadmap/service/migration-naming-cleanup.md`

It must state:

- Drizzle is the official migration system.
- Manual `psql` mode is not the project standard.
- migration files use clear `NNNN_<domain>_<purpose>.sql` names.
- old migration names are mapped to the new clean chain.
- journal and snapshot files are part of the official chain.
- clean database migration uses `pnpm db:migrate`.
- current tables, columns, and constraints are defined from baseline.
- no `ALTER TABLE ADD` migration constructs the current baseline schema.

Acceptance:

- Drizzle journal is not empty when migration files exist.
- Journal entries match real files.
- Snapshot metadata is present and consistent.
- Official migration files contain no invalid PostgreSQL syntax.
- Baseline/current schema migration contains no `ALTER TABLE ... ADD ...` construction.
- All current tables are fully defined from the initial baseline migration.
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

Do not change the public error response envelope unless unavoidable.
Do not put sensitive data in errors.

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
- migration names are clear
- Drizzle journal and snapshots are consistent
- `db:migrate` is the official path
- all current tables are defined completely in the baseline
- no `ALTER TABLE ADD` migration constructs current baseline schema
- HTTP tests prove grant-scope denial on real routes
