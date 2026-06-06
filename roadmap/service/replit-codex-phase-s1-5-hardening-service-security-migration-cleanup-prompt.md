# Replit/Codex Prompt - Phase S1-S5 Hardening: Service Security and Migration Cleanup

You are working in the `northflow-payment-orchestration` repository.

This is a hardening patch for the already-started Phase S1-S5 service security work.

Do not implement dashboard work.
Do not implement provider webhook roadmap work.
Do not rewrite unrelated payment orchestration behavior.

## Goal

Harden the Phase S1-S5 implementation so it is safe for multi-app consumers:

- AuraPoS: direct REST API consumer.
- Transity: SDK consumer.
- Kioskoin: direct REST API consumer.

The final security model remains:

```txt
1 consumer app environment = 1 API client
1 tenant/business/payment owner = 1 merchant
```

## Current Problems To Fix

The previous implementation added the core pieces, but it still has hardening gaps:

1. `x-nf-api-key` is not supported by auth token extraction.
2. Credential prefix parsing can break when generated prefixes contain underscores.
3. Merchant access guard currently fails open when the access repository is missing.
4. Scope checks currently use only global client scopes and do not enforce per-merchant grant scopes.
5. Migrations are inconsistent: a baseline migration and an extra S1 migration can duplicate the same tables.
6. A migration file uses unsafe or invalid PostgreSQL constraint syntax.
7. Build artifacts under `apps/dashboard/.next` were committed and must be removed from version control.
8. Negative tests are missing or incomplete.

---

# P0.1 - Fix Credential Format and Prefix Parser

## Problem

The current generated credential format can contain underscores inside the stored prefix. A parser that splits on `_` can extract the wrong prefix and reject valid credentials.

## Required Fix

Create a stable credential format that is easy to parse and cannot be broken by underscores in client IDs.

Recommended format:

```txt
nf.<environment>.<credentialId>.<secret>
```

Example shape only:

```txt
nf.live.abc123xyz.secretMaterial
```

Rules:

- Do not include raw client IDs in the credential prefix.
- `credentialId` must be URL-safe and must not contain dots or underscores.
- The stored lookup prefix should be deterministic and safe, for example `nf.live.abc123xyz`.
- The raw credential must be shown only once at generation time.
- Only store prefix and one-way hash.
- Use constant-time comparison for hash comparison.

## Acceptance Criteria

- Credentials generated for clients with underscores in their IDs still authenticate correctly.
- Malformed credentials return 401, not 500.
- Existing revoked and expired checks still work.
- Tests cover credential parsing for client IDs with underscores.

---

# P0.2 - Add `x-nf-api-key` Support

## Required Fix

Auth extraction must support both:

```txt
Authorization: Bearer <credential>
x-nf-api-key: <credential>
```

Legacy headers may remain only as compatibility fallback controlled by the existing legacy flag.

## Rules

- Prefer `Authorization` if present.
- Accept `x-nf-api-key` if `Authorization` is missing.
- Do not log either header.
- Do not expose credentials in error messages.

## Acceptance Criteria

- `Authorization: Bearer ...` works.
- `x-nf-api-key` works.
- Missing credential returns 401.
- Invalid credential returns 401.

---

# P0.3 - Make Merchant Access Guard Fail Closed

## Problem

`assertMerchantAccess()` currently returns success when the access repository is undefined. That is dangerous for production or custom containers.

## Required Fix

For non-legacy and non-internal clients:

```txt
if accessRepo is missing -> reject request
```

Recommended error:

```txt
503 SERVICE_MISCONFIGURED
```

or:

```txt
500 SERVICE_MISCONFIGURED
```

Use whichever status is consistent with the existing API error style.

## Rules

- Legacy compatibility clients may bypass only when explicitly enabled.
- Internal/system clients may bypass only if intentionally represented as `sourceApp = internal`.
- Normal API clients must never bypass merchant access validation.

## Acceptance Criteria

- Missing access repo does not allow normal clients through.
- Normal client without access grant receives `403 MERCHANT_ACCESS_DENIED`.
- Internal/system behavior remains explicit and tested.

---

# P0.4 - Enforce Per-Merchant Grant Scopes

## Problem

The current implementation checks only global API client scopes. However, `client_merchant_access` also stores `scopes`, and those grant scopes are not enforced.

## Required Model

A route action is allowed only if:

```txt
client global scopes allow the required scope
AND
merchant access grant scopes allow the required scope
```

Exception:

```txt
'*' scope means all scopes for that layer only.
```

Example:

```txt
client.scopes = ['payment:refund']
grant.scopes  = ['payment:read']
request refund -> denied
```

## Required Implementation

Refactor authorization helpers so merchant-scoped routes can validate both:

- Global client scope.
- Merchant grant scope.

Possible approach:

1. Keep `requireScope(scope)` for non-merchant routes or global pre-check.
2. Add a helper like `assertMerchantAccessWithScope(auth, merchantId, scope, accessRepo)`.
3. Use the helper in all merchant-scoped route handlers.

Required denial codes:

```txt
403 MERCHANT_ACCESS_DENIED
403 SCOPE_DENIED
```

Use `MERCHANT_ACCESS_DENIED` when no active grant exists.
Use `SCOPE_DENIED` when the grant exists but does not include the required scope.

## Acceptance Criteria

- Client with global refund scope but grant without refund scope cannot refund.
- Client with grant refund scope but global client without refund scope cannot refund.
- Client with both global and grant refund scope can refund.
- Existing wildcard scope behavior is explicit and tested.

---

# P0.5 - Migration Cleanup and Naming Hardening

## Migration Naming Rule

Use descriptive migration names in this format:

```txt
NNNN_<domain>_<purpose>.sql
```

Examples:

```txt
0000_payment_orchestration_base_tables.sql
0001_provider_runtime_and_events.sql
0002_idempotency_and_reconciliation.sql
0003_service_api_client_registry.sql
0004_service_security_hardening.sql
```

## Cleanup Requirements

Inspect the current migrations and fix the duplication/inconsistency.

Known issue to investigate:

- One baseline migration creates API client tables.
- Another S1 migration also creates API client tables.
- The S1 migration contains constraint syntax that may not be valid PostgreSQL.
- Migration journal/snapshot state may not match the added migration files.

## Safe Strategy

Choose one of these strategies based on repo state.

### Strategy A - Clean Baseline Repo / Not Applied To Production

Use this if there is no production DB migration history depending on the current file names.

- Rename the baseline migration to a descriptive name.
- Keep a single baseline that creates all current tables.
- Remove duplicate S1 migration if it only repeats baseline tables.
- Update migration journal/snapshot consistently.
- Add a mapping document explaining old-to-new migration names.

### Strategy B - Existing DB / Applied Migrations Must Be Preserved

Use this if migrations may already be applied in a real environment.

- Do not rename already-applied migration files unless the migration runner is confirmed filename-safe.
- Do not modify historical applied SQL in a destructive way.
- Add a new forward-only migration with a descriptive name.
- Make the new migration idempotent only where PostgreSQL syntax is valid.
- Avoid unsupported `ALTER TABLE ... ADD CONSTRAINT IF NOT EXISTS` syntax.
- If constraint creation must be conditional, use a safe `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; END $$;` block or another valid Postgres-safe pattern.
- Add a migration cleanup mapping document.

## Required Mapping Document

Create or update:

```txt
roadmap/service/migration-naming-cleanup.md
```

Include:

- Goal.
- Naming rule.
- Current migration files.
- Proposed descriptive names.
- Safety notes.
- Chosen strategy.
- Why the chosen strategy is safe.

Use the KiosKoin migration naming cleanup style:

```txt
NNNN_<domain>_<purpose>.sql
```

Keep ordering numbers unchanged when renaming is safe.

## Acceptance Criteria

- No duplicate table creation path remains for the same deployment mode.
- Migration journal/snapshot is consistent with actual migration files.
- Migration SQL is valid PostgreSQL.
- Migration names are descriptive or documented with a mapping plan.
- The cleanup does not risk breaking already-applied production migrations.

---

# P0.6 - Remove Committed Build Artifacts

## Problem

Build artifacts under `apps/dashboard/.next` are committed even though `.gitignore` ignores them.

## Required Fix

Remove all committed files under:

```txt
apps/dashboard/.next
```

Rules:

- Do not delete source files.
- Remove artifacts from Git tracking.
- Keep `.gitignore` rules that ignore `.next` directories.

## Acceptance Criteria

- `apps/dashboard/.next` files no longer appear in `git status` as tracked files.
- `.gitignore` still ignores dashboard build output.

---

# P0.7 - Add Missing Tests

Add or update tests for:

- Credential parser handles client IDs with underscores indirectly through generated credentials.
- `Authorization: Bearer` auth works.
- `x-nf-api-key` auth works.
- Missing credential returns 401.
- Invalid credential returns 401.
- Revoked credential returns 401.
- Expired credential returns 401.
- Normal client fails closed if merchant access repository is unavailable.
- Client without active merchant access receives `MERCHANT_ACCESS_DENIED`.
- Client with active grant but missing grant scope receives `SCOPE_DENIED`.
- Client with global scope but missing grant scope is denied.
- Client with grant scope but missing global scope is denied.
- Client with both scopes is allowed.
- SourceApp mismatch returns `SOURCE_APP_MISMATCH`.

---

# Implementation Rules

1. Keep the API response envelope stable.
2. Never store raw credential material.
3. Never log credentials, provider secrets, authorization data, or sensitive headers.
4. Keep service-owned Drizzle schema in `apps/service/src/infrastructure/schema.ts`.
5. Keep shared contracts in `packages/core` when needed by repositories, SDK, or service code.
6. Do not implement dashboard or webhook roadmap work.
7. Do not weaken existing payment domain behavior.
8. Do not remove tests unless replacing them with stronger tests.
9. Do not commit build artifacts.
10. Keep migration names descriptive and audit-friendly.

---

# Validation Commands

Run the repository's normal validation commands before finishing.

At minimum:

```bash
pnpm type-check
pnpm test
```

If the repo has a more specific service test command, run that too.

---

# Expected Final State

After this hardening patch:

```txt
AuraPoS credentials can access only AuraPoS merchants and only granted scopes.
Transity credentials can access only Transity merchants and only granted scopes.
Kioskoin credentials can access only Kioskoin merchants and only granted scopes.
```

Auth supports both standard bearer credentials and the dedicated Northflow API key header.

Merchant access validation fails closed.

Migrations are valid, descriptive, and safe for the chosen deployment history strategy.
