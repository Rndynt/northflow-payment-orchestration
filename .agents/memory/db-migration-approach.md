---
name: DB migration approach
description: How schema migrations are managed in this monorepo — drizzle-kit journal vs. direct psql.
---

# DB migration approach

## The rule
- `migrations/` at root contains plain SQL files applied directly via `psql $DATABASE_URL -f`.
- drizzle-kit is used only for `db:generate` (schema diffing) — the generated SQL is reviewed and applied manually via psql with `CREATE TABLE IF NOT EXISTS`.
- drizzle-kit's meta journal (`migrations/meta/_journal.json`) reflects what drizzle-kit knows, but is NOT used for actual migration tracking (no `db:migrate` is run against a live DB).

**Why:** The initial DB setup used raw psql, not drizzle-kit push/migrate. Trying to use `pnpm db:migrate` would fail because drizzle-kit's journal doesn't match the actual DB state.

**How to apply:**
- For new tables: write a new `migrations/000N_description.sql` with `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS`. Apply via `psql $DATABASE_URL -f migrations/000N_...sql`.
- Note: PostgreSQL does NOT support `ADD CONSTRAINT IF NOT EXISTS` — omit that clause and rely on idempotent table creation instead, or use `DO $$ ... EXCEPTION ... END $$` blocks.
- The `migrations/meta/` directory and `0000_overrated_morgan_stark.sql` are drizzle-kit artifacts that can be ignored.
