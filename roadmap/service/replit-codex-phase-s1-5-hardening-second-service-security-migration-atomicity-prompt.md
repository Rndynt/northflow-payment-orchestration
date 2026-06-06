# Replit/Codex Prompt - Phase S1-S5 Hardening Second Pass

You are working in the `northflow-payment-orchestration` repository.

This is the second hardening pass for Phase S1-S5 service security.

The first hardening pass fixed the credential format, added `x-nf-api-key`, introduced fail-closed merchant access guards, added merchant grant-scope checks, removed committed `.next` build artifacts, and added initial security tests.

However, a follow-up review found several remaining blockers. Fix only the issues in this prompt.

## Strict Scope

Do not implement dashboard features.
Do not implement provider webhook roadmap work.
Do not rewrite unrelated payment orchestration behavior.
Do not change business logic unless required by this hardening patch.
Do not weaken existing idempotency, refund, void, reconciliation, or provider protections.

---

# P1.1 - Fix Create Merchant Grant Atomicity and Fail-Closed Behavior

## Problem

`POST /v1/merchants` currently creates a merchant first, then tries to create the client-to-merchant access grant. The grant creation failure is swallowed.

This can create an orphan merchant:

```txt
merchant created
access grant creation failed
response still returns 201
client cannot access the merchant afterwards
```

## Required Fix

For normal API clients where:

```txt
req.auth.clientId !== 'legacy'
req.auth.sourceApp !== 'internal'
```

`POST /v1/merchants` must fail closed if the access repository is unavailable.

Before creating the merchant:

```txt
if accessRepo is missing -> return 503 SERVICE_MISCONFIGURED
```

After creating the merchant:

```txt
access grant creation must be awaited
access grant creation errors must not be swallowed
```

If grant creation fails, the request must fail with a service error.

Prefer an atomic DB transaction if the existing repository/container design supports it. If not, document the limitation in code comments and fail the request rather than returning success.

## Acceptance Criteria

- Normal client cannot create merchant when accessRepo is missing.
- Normal client merchant creation fails if grant creation fails.
- Normal successful merchant creation creates an active grant for the authenticated client.
- Legacy/internal clients keep explicit bypass behavior.
- No `.catch(() => {})` is used for security-critical grant creation.

---

# P1.2 - Validate Credential ID and Environment in `generateCredential()`

## Problem

`generateCredential(environment, credentialId)` documents that `credentialId` must not contain dots or unsafe characters, but the function does not enforce this.

If a caller passes unsafe values, generated credentials can become ambiguous.

## Required Fix

Add validation inside `generateCredential()`.

Allowed format:

```txt
environment: lowercase letters, numbers, hyphen only
credentialId: URL-safe alphanumeric or hyphen only
```

Recommended regex:

```txt
environment: /^[a-z0-9-]+$/
credentialId: /^[A-Za-z0-9-]+$/
```

Explicitly reject:

```txt
dots
whitespace
slashes
underscores, unless you intentionally support them and parser tests prove safety
empty values
```

Throw a clear `Error` for invalid inputs.

## Acceptance Criteria

- Valid environment + credentialId generate a credential.
- CredentialId containing `.` throws.
- CredentialId containing whitespace throws.
- CredentialId containing `_` throws unless intentionally supported and documented.
- Environment containing unsafe characters throws.
- Tests cover invalid inputs.

---

# P1.3 - Fix Migration SQL and Migration Execution Contract

## Problem

`migrations/0003_s1_api_client_registry.sql` still contains invalid PostgreSQL syntax:

```sql
ALTER TABLE ... ADD CONSTRAINT IF NOT EXISTS ...
```

PostgreSQL does not safely support that syntax for `ADD CONSTRAINT`.

Also, migration metadata currently creates confusion: the journal was reset to an empty entries list, but the repo still exposes `db:migrate` scripts. This can mislead future agents/developers.

## Required Fix

Choose and enforce one clear migration execution contract.

Preferred for this repo right now:

```txt
Manual psql migration mode
```

If keeping manual psql mode:

1. Fix `0003_s1_api_client_registry.sql` so it is valid PostgreSQL.
2. Replace invalid `ADD CONSTRAINT IF NOT EXISTS` statements with safe `DO $$ ... EXCEPTION WHEN duplicate_object THEN NULL; END $$;` blocks.
3. Keep `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS` where appropriate.
4. Update `roadmap/service/migration-naming-cleanup.md` to state that `0003` has been fixed, not only documented.
5. Update package scripts to avoid accidental `drizzle-kit migrate` usage, or make the script print a clear warning and exit non-zero.

Recommended script change:

```json
"db:migrate": "node -e \"console.error('Use psql $DATABASE_URL -f migrations/<file>.sql. drizzle-kit migrate is disabled for this repo history.'); process.exit(1)\""
```

Apply this at the root and service package if both expose `db:migrate`.

If instead you decide to restore Drizzle migrate mode, then the migration journal and snapshots must be made consistent with the actual migration files. Do not leave an empty journal while `db:migrate` appears usable.

## Acceptance Criteria

- `0003_s1_api_client_registry.sql` contains no invalid `ADD CONSTRAINT IF NOT EXISTS` syntax.
- Migration SQL is valid PostgreSQL.
- Migration cleanup document says the invalid syntax is fixed, not merely documented.
- `db:migrate` cannot accidentally run an inconsistent drizzle migration history.
- `db:generate` may remain available for schema diff/reference.

---

# P1.4 - Strengthen HTTP Negative Tests for Merchant Grant Scopes

## Problem

The first hardening tests verify grant-scope behavior mostly through unit tests and `GET /v1/merchants` success checks. They do not sufficiently verify route-level HTTP denial for payment/refund/reconcile actions.

## Required Fix

Add HTTP integration tests that call real merchant-scoped routes and assert denial.

At minimum, add tests for:

```txt
POST /v1/payment-intents/:id/gateway-payments
  client has global payment:create but grant lacks payment:create -> 403 SCOPE_DENIED

POST /v1/payment-intents/:id/reconcile
  client has global payment:reconcile but grant lacks payment:reconcile -> 403 SCOPE_DENIED

POST /v1/payment-transactions/:id/refund
  client has global payment:refund but grant lacks payment:refund -> 403 SCOPE_DENIED
```

Also add the inverse case:

```txt
grant has payment:refund but client global scopes lack payment:refund -> 403 SCOPE_DENIED
```

These tests must use HTTP request paths, not only direct helper calls.

## Test Setup Guidance

Use existing in-memory repositories in `tests/payment-orchestration-service-security-hardening.test.ts`.

If needed, seed:

- Merchant.
- Payment intent.
- Payment transaction.
- Client.
- Credential.
- Merchant access grant with intentionally missing scopes.

Do not weaken the route logic just to make tests pass.

## Acceptance Criteria

- HTTP route returns `403 SCOPE_DENIED` when grant scope is missing.
- HTTP route returns `403 SCOPE_DENIED` when global client scope is missing.
- Tests cover gateway payment, reconcile, and refund route families.
- Existing positive tests still pass.

---

# P1.5 - Keep Error Envelope Stable

Do not change the public error response shape unless absolutely necessary.

If tests reveal that `apiErrorResponse()` serializes differently over HTTP due to `toJSON()`, update tests carefully without breaking existing API contracts.

Do not add sensitive data to error details.

---

# Required Validation

Run the normal validation commands before finishing:

```bash
pnpm type-check
pnpm test
```

If there are pre-existing failures unrelated to this patch, document them in `.agents/memory/pre-existing-test-failures.md` without hiding new failures introduced by this patch.

---

# Expected Final State

After this second hardening pass:

```txt
- create merchant cannot produce orphan merchant grants silently
- credential generation rejects unsafe IDs
- migration SQL is valid PostgreSQL
- migration execution contract is explicit and not misleading
- HTTP tests prove merchant grant-scope denial on real payment routes
```

Do not proceed to S6/S7 until these are complete.
