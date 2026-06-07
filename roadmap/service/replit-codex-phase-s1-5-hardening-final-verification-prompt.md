# Replit/Codex Prompt - S1-S5 Final Verification Hardening

You are working in the `northflow-payment-orchestration` repository.

This task is a final hardening verification patch after the S1-S5 service security and Drizzle migration cleanup work.

Do not rewrite the service.
Do not change unrelated payment logic.
Do not implement dashboard work.
Do not implement webhook roadmap work.
Do not change the Drizzle-only migration decision.

## Current Status

The latest implementation is mostly correct:

- migrations are split by priority
- table names use `po_*`
- migration files are no longer one giant base dump
- foreign keys are inline in `CREATE TABLE`
- Drizzle is the official migration system
- `db:migrate` remains supported
- create merchant + access grant is atomic/fail-closed
- credential validation rejects unsafe IDs
- HTTP negative tests exist for gateway payment, reconcile, and refund scope denial

Only final verification and small documentation/report patches remain.

---

# Task 1 - Fix Migration Mapping Documentation

Open:

```txt
roadmap/service/migration-naming-cleanup.md
```

Find the section:

```txt
Old Migration Names -> New Clean Chain
```

Add the missing old migration mapping:

```txt
0003_s1_api_client_registry.sql -> 0006_po_service_api_clients.sql
```

The mapping must be explicit. It must explain that the old S1 API client registry migration is now folded into:

```txt
0006_po_service_api_clients.sql
```

Do not recreate the old migration file.
Do not change the current clean migration chain.

Acceptance:

- `0003_s1_api_client_registry.sql` appears in the mapping table.
- It maps to `0006_po_service_api_clients.sql`.
- Documentation still says Drizzle is the official migration system.
- Documentation still says manual `psql` mode is not the project standard.
- Documentation still says migrations are split by table/domain priority, not one giant base dump.

---

# Task 2 - Verify Migration Chain

Verify official migration files are exactly:

```txt
migrations/0000_po_merchants.sql
migrations/0001_po_provider_accounts.sql
migrations/0002_po_payment_intents.sql
migrations/0003_po_payment_transactions.sql
migrations/0004_po_idempotency_keys.sql
migrations/0005_po_provider_events.sql
migrations/0006_po_service_api_clients.sql
```

Verify these obsolete migration files are not present:

```txt
migrations/0000_po_base_schema.sql
migrations/0001_payment_orchestration_initial.sql
migrations/0002_refund_void_manual_parity.sql
migrations/0003_s1_api_client_registry.sql
```

Verify:

```txt
migrations/meta/_journal.json
```

has all seven current entries in the same order.

Verify every current migration file has a matching snapshot file in:

```txt
migrations/meta/
```

Acceptance:

- Journal is not empty.
- Journal entries match real files.
- Snapshot files exist for all current migrations.
- No obsolete migration file remains in the official chain.

---

# Task 3 - Verify No ALTER TABLE ADD In Current Migrations

Search current official migration SQL files for:

```sql
ALTER TABLE
ADD COLUMN
ADD CONSTRAINT
```

Current-schema migration files must not use:

```sql
ALTER TABLE ... ADD ...
```

Foreign keys must be inline in `CREATE TABLE` blocks.

Acceptance:

- No current official migration file contains `ALTER TABLE ... ADD ...`.
- No current official migration file contains invalid PostgreSQL syntax.
- Every table is created complete in the migration where it is introduced.

---

# Task 4 - Verify Drizzle Scripts

Check:

```txt
package.json
apps/service/package.json
```

Acceptance:

- root `db:migrate` delegates to the service migration command.
- service `db:migrate` uses `drizzle-kit migrate`.
- root/service `db:generate` remains available.
- no script disables `db:migrate`.
- docs do not recommend `psql` as the official path.

---

# Task 5 - Verify Credential Validation

Check:

```txt
apps/service/src/middleware/auth.ts
```

Verify `generateCredential(environment, credentialId)` rejects:

```txt
empty values
dots
whitespace
slashes
underscores
unsafe delimiter characters
```

Expected allowed format:

```txt
environment: lowercase letters, numbers, hyphen only
credentialId: letters, numbers, hyphen only
```

Acceptance:

- `credentialId` does not allow underscore.
- tests cover invalid credential IDs.
- tests cover invalid environments.

---

# Task 6 - Verify HTTP Grant-Scope Negative Tests

Check:

```txt
tests/payment-orchestration-service-security-hardening.test.ts
```

Verify real HTTP endpoint tests exist for:

```txt
POST /v1/payment-intents/:id/gateway-payments
POST /v1/payment-intents/:id/reconcile
POST /v1/payment-transactions/:id/refund
```

Required denial cases:

```txt
global scope exists but merchant grant lacks scope -> 403 SCOPE_DENIED
merchant grant scope exists but global scope is missing -> 403 SCOPE_DENIED
```

Acceptance:

- tests call real HTTP paths, not only helper functions.
- expected error code is `SCOPE_DENIED`.

---

# Task 7 - Run Validation Commands And Record Evidence

Run:

```bash
pnpm type-check
pnpm test
pnpm db:generate
pnpm db:migrate
```

For migration validation, use a clean local/test database if available.

If any command cannot be run because a database URL is unavailable, do not fake success. Record the exact reason.

Create or update:

```txt
.agents/memory/s1-s5-final-hardening-validation.md
```

The report must include:

```txt
- timestamp
- git commit checked
- command run
- result: pass/fail/skipped
- important output summary
- reason for skipped command, if any
- any remaining known issue
```

If a failure is pre-existing, document it clearly. Do not hide new failures introduced by this patch.

Acceptance:

- validation evidence file exists
- command results are explicit
- skipped DB validation is explained if no clean database is available

---

# Final Commit Requirements

Commit and push the changes.

Expected changed files should be limited to:

```txt
roadmap/service/migration-naming-cleanup.md
.agents/memory/s1-s5-final-hardening-validation.md
```

Do not touch service implementation unless verification finds a real issue.

Final report must include:

```txt
1. files changed
2. migration mapping status
3. migration chain status
4. no ALTER TABLE ADD verification result
5. Drizzle script verification result
6. credential validation status
7. HTTP grant-scope test status
8. validation command results
9. remaining known issues, if any
```
