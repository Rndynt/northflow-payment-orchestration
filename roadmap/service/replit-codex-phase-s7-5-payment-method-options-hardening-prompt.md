# Replit/Codex Prompt - Phase S7.5 Payment Method Options Hardening

You are working in the `northflow-payment-orchestration` repository.

S7.5 Payment Method Options has been implemented, but review found blocking issues. This hardening patch must finish all remaining S7.5 requirements.

Do not implement dashboard UI.
Do not implement provider webhook roadmap work.
Do not rewrite unrelated payment logic.
Do not weaken S1-S7 auth, merchant access, sourceApp, scope, idempotency, SDK, or smoke-test guarantees.

---

# Blocking Issues To Fix

Current implementation problems:

1. Migration file was generated as `migrations/0007_supreme_wolfsbane.sql`, but required name is `migrations/0007_po_provider_account_methods.sql`.
2. Migration `0007` uses `ALTER TABLE ... ADD CONSTRAINT` for FK creation. This violates the existing migration cleanup rule.
3. `CreateGatewayPayment` skips method validation when the provider account has zero registered methods. This allows arbitrary method bypass.
4. New payment method routes only check merchant access when `accessRepo` exists. This is fail-open and violates S1-S5 security rules.
5. Validation report file has the wrong name and is not a full validation report.
6. `.replit` was changed even though it is unrelated to S7.5; verify and revert if accidental.

Fix all of them. Do not leave partial work.

---

# Task 1 - Fix Migration Name And Drizzle Metadata

Rename the migration file:

```txt
migrations/0007_supreme_wolfsbane.sql
```

to:

```txt
migrations/0007_po_provider_account_methods.sql
```

Update Drizzle metadata consistently:

```txt
migrations/meta/_journal.json
migrations/meta/0007_snapshot.json
```

Requirements:

- `_journal.json` must reference `0007_po_provider_account_methods`.
- No journal entry may reference `0007_supreme_wolfsbane`.
- Snapshot metadata must remain consistent with the migration chain.
- Do not rename any previous migrations `0000` through `0006`.
- Do not edit old migrations except if necessary to keep metadata consistent; prefer not touching them.

Acceptance:

- `migrations/0007_po_provider_account_methods.sql` exists.
- `migrations/0007_supreme_wolfsbane.sql` no longer exists.
- Drizzle journal references the new descriptive name.
- `pnpm db:migrate` works from a clean database.

---

# Task 2 - Remove ALTER TABLE ADD From Migration 0007

Current migration contains FK creation like:

```sql
ALTER TABLE "po_provider_account_methods" ADD CONSTRAINT ...
```

This must be removed.

The migration must define FK constraints inline inside the `CREATE TABLE` statement, consistent with the clean migration style already used by migrations `0000` through `0006`.

Expected style:

```sql
CREATE TABLE "po_provider_account_methods" (
  "id" text PRIMARY KEY NOT NULL,
  "merchant_id" text NOT NULL,
  "provider_account_id" text NOT NULL,
  ...,
  CONSTRAINT "po_provider_account_methods_merchant_id_po_merchants_id_fk"
    FOREIGN KEY ("merchant_id") REFERENCES "public"."po_merchants"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "po_provider_account_methods_provider_account_id_po_provider_accounts_id_fk"
    FOREIGN KEY ("provider_account_id") REFERENCES "public"."po_provider_accounts"("id") ON DELETE cascade ON UPDATE no action
);
```

Rules:

- Keep all indexes and unique indexes.
- Do not use `ALTER TABLE ... ADD COLUMN`.
- Do not use `ALTER TABLE ... ADD CONSTRAINT`.
- Do not use any `ALTER TABLE ... ADD ...` pattern to construct current schema.
- SQL must be valid PostgreSQL.

Acceptance:

- `grep -R "ALTER TABLE.*ADD" migrations/0007_po_provider_account_methods.sql` returns no match.
- FK constraints are inline in `CREATE TABLE`.
- Migration applies cleanly on a clean DB.

---

# Task 3 - Make Gateway Payment Method Validation Fail Closed

Current behavior:

```txt
if methodRepo exists and providerAccountId exists but provider account has zero registered methods, CreateGatewayPayment skips validation.
```

This is not acceptable for S7.5.

Required behavior:

When `methodRepo` is configured and `providerAccountId` is provided:

1. Load methods for the provider account.
2. If no methods are configured, reject the request.
3. If requested method is missing, reject the request.
4. If method status is not active, reject the request.
5. If currency mismatch, reject the request.
6. If amount is below min or above max, reject the request.

Required error codes:

```txt
PAYMENT_METHODS_NOT_CONFIGURED
PAYMENT_METHOD_NOT_AVAILABLE
PAYMENT_METHOD_DISABLED
PAYMENT_METHOD_CURRENCY_UNSUPPORTED
PAYMENT_METHOD_AMOUNT_OUT_OF_RANGE
```

Suggested status:

```txt
422
```

Rules:

- Do not bypass validation when methods table is empty for that provider account.
- Backward compatibility can only skip validation when `methodRepo` is truly not wired in legacy/test containers.
- Production/service container must wire `methodRepo`, so real behavior must fail closed.
- Keep fake_gateway dev convenience for missing providerAccountId only if existing behavior requires it, but when providerAccountId is supplied and methodRepo exists, validation must enforce configured methods.

Acceptance:

- Gateway payment with providerAccountId and zero configured methods returns `PAYMENT_METHODS_NOT_CONFIGURED`.
- Gateway payment with unknown method returns `PAYMENT_METHOD_NOT_AVAILABLE`.
- Disabled/unsupported method returns `PAYMENT_METHOD_DISABLED`.
- Currency mismatch returns `PAYMENT_METHOD_CURRENCY_UNSUPPORTED`.
- Amount below/above configured bounds returns `PAYMENT_METHOD_AMOUNT_OUT_OF_RANGE`.
- Valid configured active method succeeds.

---

# Task 4 - Make Payment Method Routes Fail Closed

Current route code does this pattern:

```ts
if (accessRepo) {
  const denied = await assertMerchantAccessWithAnyScope(...)
  if (denied) return denied
}
```

This is fail-open. Fix it.

For normal API clients, if `accessRepo` is missing, route must reject with service misconfiguration.

Apply to all S7.5 routes:

```txt
GET /v1/merchants/:merchantId/provider-accounts/:providerAccountId/methods
PUT /v1/merchants/:merchantId/provider-accounts/:providerAccountId/methods/:method
POST /v1/merchants/:merchantId/provider-accounts/:providerAccountId/methods/sync
GET /v1/merchants/:merchantId/payment-methods
GET /v1/payment-intents/:intentId/payment-options
```

Expected error:

```txt
503 SERVICE_MISCONFIGURED
```

or the same status/code convention already used in S1-S5 fail-closed merchant access guard.

Rules:

- Internal/legacy bypass may remain only if already explicit in S1-S5 auth model.
- Normal API clients must never bypass merchant access validation.
- Reuse existing helper behavior if possible; do not create a divergent security model.

Acceptance:

- Tests prove routes reject normal API clients when merchant access repo is missing.
- Cross-merchant access still returns `MERCHANT_ACCESS_DENIED`.
- Missing route scope still returns `SCOPE_DENIED`.

---

# Task 5 - Fix Validation Report File

Current file:

```txt
.agents/memory/s7-5-payment-method-options.md
```

is implementation notes, not the requested validation report.

Create the required validation report:

```txt
.agents/memory/s7-5-payment-method-options-validation.md
```

It must include:

```txt
- timestamp
- git commit checked
- files changed
- migration result
- command run
- result: pass/fail/skipped
- important output summary
- reason for skipped command, if any
- known pre-existing failures
- remaining issues
```

Commands to run:

```bash
pnpm type-check
pnpm test
pnpm db:generate
pnpm db:migrate
```

If root type-check still has pre-existing dashboard/client-sdk issues, document clearly and prove service + SDK checks are clean.

Do not fake validation results.

The existing notes file may remain if useful, but the validation report file must exist with real results.

Acceptance:

- `.agents/memory/s7-5-payment-method-options-validation.md` exists.
- It contains command results.
- It distinguishes real failures from pre-existing unrelated failures.

---

# Task 6 - Verify And Revert `.replit` If Accidental

The previous S7.5 implementation changed `.replit`. This is suspicious because S7.5 should not need Replit runtime config changes.

Check the diff.

If the `.replit` change is unrelated to S7.5, revert it.

Only keep it if there is a clear, documented reason tied to S7.5 validation or test execution.

Acceptance:

- `.replit` is either unchanged from pre-S7.5 or the validation report explains exactly why it changed.

---

# Task 7 - Strengthen Tests

Add or update tests for all hardening requirements.

Required tests:

## Migration / static check

Add a test or script/assertion that ensures migration `0007_po_provider_account_methods.sql` does not contain:

```txt
ALTER TABLE ... ADD
```

If repo style does not include migration-file tests, at minimum document the grep result in validation report.

## Gateway validation

Tests must cover:

```txt
provider account has zero methods -> PAYMENT_METHODS_NOT_CONFIGURED
unknown method -> PAYMENT_METHOD_NOT_AVAILABLE
disabled method -> PAYMENT_METHOD_DISABLED
unsupported method -> PAYMENT_METHOD_DISABLED
currency mismatch -> PAYMENT_METHOD_CURRENCY_UNSUPPORTED
amount below min -> PAYMENT_METHOD_AMOUNT_OUT_OF_RANGE
amount above max -> PAYMENT_METHOD_AMOUNT_OUT_OF_RANGE
valid active configured method -> success
```

## Route fail-closed

Tests must cover:

```txt
normal API client + missing accessRepo -> SERVICE_MISCONFIGURED
cross-merchant access -> MERCHANT_ACCESS_DENIED
missing scope -> SCOPE_DENIED
```

Apply at least to:

```txt
GET /v1/payment-intents/:intentId/payment-options
GET /v1/merchants/:merchantId/payment-methods
```

Add more route coverage if practical.

---

# Task 8 - Documentation Update

Update:

```txt
docs/integration/payment-method-options.md
```

Make sure it says:

- Methods originate from provider capabilities.
- `po_provider_account_methods` stores enabled/allowed methods per merchant provider account.
- Gateway payment rejects unconfigured methods.
- Payment options are the only supported way for consumer apps to know what to display.
- Consumer apps must not hard-code provider method availability.
- Provider sync can be static capability-based or provider API-based if supported.

Also update any validation/status note that still references `0007_supreme_wolfsbane.sql` to use:

```txt
0007_po_provider_account_methods.sql
```

---

# Required Validation

Run:

```bash
pnpm type-check
pnpm test
pnpm db:generate
pnpm db:migrate
```

Also run package-specific checks if available:

```bash
pnpm --filter @northflow/payment-orchestration-service type-check
pnpm --filter @northflow/payment-orchestration-client-sdk type-check
```

Use a clean test database for migration validation if available.

Document exact results in:

```txt
.agents/memory/s7-5-payment-method-options-validation.md
```

---

# Expected Final State

After this hardening patch:

```txt
migrations/0007_po_provider_account_methods.sql exists
migrations/0007_supreme_wolfsbane.sql is gone
migration 0007 has no ALTER TABLE ADD statements
Drizzle journal references the descriptive migration name
CreateGatewayPayment rejects unconfigured methods
payment method routes fail closed when accessRepo is missing
validation report exists with real command results
.replit is reverted unless clearly justified
S7.5 tests cover gateway validation, security, and route fail-closed behavior
```

Commit and push all changes.
