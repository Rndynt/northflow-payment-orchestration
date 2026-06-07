# Replit/Codex Prompt - Phase S10 Operational Bootstrap & Admin Runtime

You are working in the `northflow-payment-orchestration` repository.

This phase implements:

```txt
S10 - Operational Bootstrap & Admin Runtime
```

## Context

Northflow already has service security and protection hardening through S9:

```txt
S1-S5   service auth, merchant access, sourceApp, scopes
S6-S7   client integration contract and smoke tests
S7.5    payment method options
S8      audit log
S9.1    credential lifecycle
S9.2    rate limit
S9.3    network protection
S9.4    signed requests
```

The service is now secure enough to need an operator/bootstrap workflow.

Dashboard management is intentionally not part of this phase.

## Northflow-only rule

Keep this phase generic and Northflow-only.

Do not mention named external consumer projects anywhere in generated code comments, docs, tests, examples, prompts, validation reports, or roadmap text.

Use generic terms only:

```txt
API client
consumer backend
REST consumer
SDK consumer
external integrator
merchant
provider account
payment method
```

Payment provider names are allowed when they refer to real provider integrations.

## Goal

Create a safe operational bootstrap layer so Northflow can be configured without a dashboard.

Operators must be able to create and inspect the minimum required production objects:

```txt
API clients
client credentials
client signing keys
merchants
client-to-merchant grants
provider accounts
provider account payment methods
```

This phase must provide deterministic CLI/admin commands, documentation, tests, and a validation report.

## Do not implement

Do not implement:

```txt
management dashboard UI
dashboard authentication
provider webhook expansion
mTLS/private network
new payment provider integration
funds movement changes
payment flow rewrite
```

Do not weaken existing S1-S9.4 behavior.

---

# Part A - Admin CLI entrypoint

Add an operational CLI entrypoint.

Recommended package/script shape:

```txt
apps/service/src/cli/nf-admin.ts
```

Expose it through package scripts, for example:

```json
{
  "scripts": {
    "nf:admin": "tsx src/cli/nf-admin.ts"
  }
}
```

If the workspace already has a preferred script structure, follow it.

The CLI must run inside the same environment as the service and must use the existing database/config/repository code, not duplicate database access logic unnecessarily.

Required global flags:

```txt
--json
--dry-run
--yes
--help
```

Rules:

```txt
--json returns machine-readable output
--dry-run validates and previews without writing
--yes skips interactive confirmation for destructive/sensitive operations
--help documents commands and required flags
```

CLI output must never print stored hashes, protected key material, provider secrets, database URLs, or environment secrets.

One-time generated raw values may be printed only on create/rotate commands where the operator must copy them immediately.

---

# Part B - Bootstrap access policy

Define how CLI/admin operations are authorized.

Because this is a local operator CLI, prefer one of these models:

```txt
1. Local trusted runtime only: command can run only with direct server/deployment environment access.
2. Optional bootstrap/admin token env: command requires an env token for destructive or credential-producing operations.
```

If adding an env token, use:

```txt
PAYMENT_ORCHESTRATION_ADMIN_BOOTSTRAP_TOKEN
```

Rules:

```txt
never expose this token in health/version/ready/logs/audit
never require it for non-sensitive help output
fail closed for sensitive commands if configured and missing/wrong
```

Document the selected model clearly.

---

# Part C - Required CLI commands

Implement commands for the minimum operational lifecycle.

## 1. Create API client

Command:

```bash
pnpm --filter @northflow/payment-orchestration-service nf:admin create-client \
  --client-id client_main_prod \
  --name "Main Production Client" \
  --source-app consumer-a \
  --environment production
```

Behavior:

```txt
creates API client if it does not exist
fails clearly if the client exists unless --upsert is explicitly supported
status defaults to active
metadata may be supplied as JSON
```

## 2. List/get API client

Commands:

```bash
pnpm --filter @northflow/payment-orchestration-service nf:admin list-clients
pnpm --filter @northflow/payment-orchestration-service nf:admin get-client --client-id client_main_prod
```

Output must be safe and must not include credential material.

## 3. Create client credential

Command:

```bash
pnpm --filter @northflow/payment-orchestration-service nf:admin create-credential \
  --client-id client_main_prod \
  --scopes intent:create,intent:read,payment:create,payment:read
```

Behavior:

```txt
creates a new active bearer credential for the API client
returns raw credential exactly once
stores only safe prefix and one-way hash
supports optional expiry
never writes raw credential to audit metadata
```

## 4. Create client signing key

Command:

```bash
pnpm --filter @northflow/payment-orchestration-service nf:admin create-signing-key \
  --client-id client_main_prod
```

Behavior:

```txt
creates a new active signing key for the API client
returns raw signing material exactly once
stores protected material only
requires valid signing key protection config
supports optional expiry
never logs raw signing material
```

## 5. Rotate/revoke credential and signing key

Commands:

```bash
pnpm --filter @northflow/payment-orchestration-service nf:admin revoke-credential \
  --client-id client_main_prod \
  --credential-id cred_xxx \
  --yes

pnpm --filter @northflow/payment-orchestration-service nf:admin revoke-signing-key \
  --client-id client_main_prod \
  --signing-key-id sk_xxx \
  --yes
```

Rules:

```txt
revoke is idempotent
revoked credential/signing key cannot authenticate
must require --yes unless --dry-run
```

## 6. Create merchant

Command:

```bash
pnpm --filter @northflow/payment-orchestration-service nf:admin create-merchant \
  --merchant-id mer_demo \
  --name "Demo Merchant" \
  --external-ref consumer-a:demo
```

Behavior:

```txt
creates merchant with explicit merchantId or generated merchantId
merchantId is the Northflow owner identity
externalRef is optional external reference only
metadata may be supplied as JSON
```

Do not use tenantId or legacyId as the primary Northflow identity.

## 7. Grant merchant access

Command:

```bash
pnpm --filter @northflow/payment-orchestration-service nf:admin grant-merchant \
  --client-id client_main_prod \
  --merchant-id mer_demo \
  --scopes intent:create,intent:read,payment:create,payment:read
```

Behavior:

```txt
creates or updates client-to-merchant access grant
validates client exists
validates merchant exists
validates scopes are known official scopes
safe idempotent behavior is preferred
```

## 8. Revoke merchant access

Command:

```bash
pnpm --filter @northflow/payment-orchestration-service nf:admin revoke-merchant \
  --client-id client_main_prod \
  --merchant-id mer_demo \
  --yes
```

Behavior:

```txt
revokes or disables client-to-merchant access
must require --yes unless --dry-run
idempotent if already revoked/missing according to chosen contract
```

## 9. Create provider account

Command:

```bash
pnpm --filter @northflow/payment-orchestration-service nf:admin create-provider-account \
  --merchant-id mer_demo \
  --provider manual \
  --environment production \
  --display-name "Manual Provider"
```

Behavior:

```txt
creates provider account for merchant
validates provider is supported
supports manual/fake/sandbox/provider-specific environments according to existing provider registry
never prints provider secrets
metadata may be supplied as JSON
```

## 10. Manage provider account methods

Commands:

```bash
pnpm --filter @northflow/payment-orchestration-service nf:admin list-payment-methods \
  --merchant-id mer_demo

pnpm --filter @northflow/payment-orchestration-service nf:admin enable-payment-method \
  --merchant-id mer_demo \
  --provider-account-id pa_xxx \
  --method qris \
  --currency IDR

pnpm --filter @northflow/payment-orchestration-service nf:admin disable-payment-method \
  --merchant-id mer_demo \
  --provider-account-id pa_xxx \
  --method qris
```

Behavior:

```txt
uses existing payment method/provider account tables and repositories
validates provider account belongs to merchant
validates method names consistently with S7.5 rules
supports min/max amount and currency if existing model supports it
```

## 11. Print bootstrap bundle

Add command:

```bash
pnpm --filter @northflow/payment-orchestration-service nf:admin bootstrap-bundle \
  --client-id client_main_prod \
  --merchant-id mer_demo
```

Output safe operational summary:

```txt
clientId
sourceApp
environment
merchantId
credentialPrefix only
signingKeyPrefix only
providerAccountIds
payment methods
required env names for the consumer backend
```

Never output raw secret material from old records.

---

# Part D - Output contract

Every command must support human output and JSON output.

JSON success shape:

```json
{
  "ok": true,
  "operation": "create-client",
  "result": {}
}
```

JSON failure shape:

```json
{
  "ok": false,
  "operation": "create-client",
  "error": {
    "code": "...",
    "message": "...",
    "details": null
  }
}
```

Never print stack traces unless an explicit debug flag is added.

Recommended CLI error codes:

```txt
ADMIN_INVALID_ARGUMENT
ADMIN_CONFIG_MISSING
ADMIN_NOT_FOUND
ADMIN_ALREADY_EXISTS
ADMIN_SCOPE_INVALID
ADMIN_CONFIRMATION_REQUIRED
ADMIN_OPERATION_FAILED
ADMIN_DRY_RUN
```

---

# Part E - Audit logging

Admin/bootstrap actions should be auditable when they change state.

Add audit action names such as:

```txt
admin.api_client.create
admin.client_credential.create
admin.client_credential.revoke
admin.client_signing_key.create
admin.client_signing_key.revoke
admin.merchant.create
admin.merchant_access.grant
admin.merchant_access.revoke
admin.provider_account.create
admin.payment_method.enable
admin.payment_method.disable
```

Audit metadata must be redacted.

Never store:

```txt
raw credential
raw signing material
protected signing material
provider secret
Authorization header
database URL
full raw environment
```

If audit logging fails, admin command should report a warning but should not roll back a successful primary operation unless the codebase already requires transactional audit behavior.

---

# Part F - Documentation

Create:

```txt
docs/operations/bootstrap-admin-runtime.md
```

Must include:

```txt
purpose of S10
when to use CLI instead of dashboard
security model
required environment variables
all commands with examples
human output examples
JSON output examples
one-time secret handling
merchantId vs externalRef explanation
provider account setup
payment method setup
safe rotation/revocation flow
dry-run usage
troubleshooting
```

The docs must be Northflow-only and must not mention named external consumer projects.

Update:

```txt
roadmap/service/main.md
```

Add S10 section and mark it completed only after implementation/tests pass.

---

# Part G - Tests

Add tests for S10.

Recommended files:

```txt
tests/s10-operational-bootstrap-admin-runtime.test.ts
tests/s10-admin-cli-output.test.ts
```

Required coverage:

```txt
create client
list/get client
create credential returns raw value once
create credential stores only hash/safe prefix
create signing key returns raw value once
create signing key stores protected material only
revoke credential is idempotent
revoke signing key is idempotent
create merchant requires merchantId or generates one safely
grant merchant validates client and merchant
grant merchant rejects unknown scopes
revoke merchant access is safe/idempotent
create provider account validates merchant/provider
payment method enable validates provider account ownership
payment method disable works safely
--dry-run writes nothing
--json returns stable envelope
sensitive output redaction
admin audit actions are written for state changes
Northflow-only search has no named external consumer project references
```

If testing the CLI process directly is heavy, test command handlers as pure functions and add at least one smoke test for the actual CLI entrypoint.

---

# Part H - Validation report

Create:

```txt
.agents/memory/s10-operational-bootstrap-admin-runtime-validation.md
```

The report must include:

```txt
timestamp
git commit checked
files changed
migration result
commands run
pass/fail/skipped results
known pre-existing failures
remaining issues
CLI commands implemented
output contract result
redaction result
audit result
dry-run result
merchantId model result
provider account/method result
Northflow-only search result
```

Run and document:

```bash
pnpm type-check
pnpm test
pnpm --filter @northflow/payment-orchestration-service type-check
pnpm --filter @northflow/payment-orchestration-service test
```

If root workspace is noisy, document the exact issue and still run targeted S10 tests.

S10 should not require a DB migration unless a required admin runtime field is missing. If a migration is added, justify it clearly in the validation report.

---

# Final acceptance checklist

S10 is complete only when:

```txt
Admin CLI exists and is wired into package scripts.
Operators can create API clients.
Operators can create credentials.
Operators can create signing keys.
Operators can create merchants.
Operators can grant and revoke merchant access.
Operators can create provider accounts.
Operators can enable/disable payment methods.
Raw secret material is only shown once on creation/rotation.
Sensitive data is never printed in list/get/bootstrap summary commands.
Dry-run mode writes nothing.
JSON output has a stable envelope.
State-changing actions are audited with redaction.
Docs exist under docs/operations/.
S10 validation report exists.
Tests pass or failures are honestly documented.
No named external consumer project references are introduced.
```

Commit and push all changes.
