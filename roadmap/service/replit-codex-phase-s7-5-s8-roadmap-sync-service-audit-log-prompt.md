# Replit/Codex Prompt - Phase S7.5 Roadmap Sync and S8 Service Audit Log

You are working in the `northflow-payment-orchestration` repository.

S1-S5 service security is complete. S6-S7 client integration is complete. S7.5 payment method options and hardening are complete.

This prompt has two goals:

1. Sync the service roadmap so S7.5 is reflected in `roadmap/service/main.md`.
2. Implement S8 Service Audit Log.

Do not implement dashboard UI.
Do not implement dashboard auth/RBAC.
Do not implement provider webhook roadmap expansion.
Do not weaken S1-S7.5 authentication, merchant access, sourceApp, scope, idempotency, SDK, migration, or payment method guarantees.

---

# Part A - S7.5 Roadmap Sync

## Goal

Update the canonical service roadmap to include the S7.5 Payment Method Options phase that has already been implemented.

File to update:

```txt
roadmap/service/main.md
```

## Required Updates

Add a new phase between S7 and S8:

```txt
Phase S7.5 — Payment Method Options
```

It must document:

```txt
po_provider_account_methods
provider adapter capability catalog
optional provider method sync
manual enable/disable per provider account
GET /v1/merchants/:merchantId/payment-methods
GET /v1/merchants/:merchantId/provider-accounts/:providerAccountId/methods
PUT /v1/merchants/:merchantId/provider-accounts/:providerAccountId/methods/:method
POST /v1/merchants/:merchantId/provider-accounts/:providerAccountId/methods/sync
GET /v1/payment-intents/:intentId/payment-options
CreateGatewayPayment method validation
```

Update the scope list to include:

```txt
payment_method:read
payment_method:write
payment_method:sync
```

Update execution priority from:

```txt
S6 -> S7 -> S8
```

to:

```txt
S6 -> S7 -> S7.5 -> S8
```

Acceptance:

- `roadmap/service/main.md` includes S7.5.
- The roadmap clearly says consumer apps must request payment options instead of hard-coding provider methods.
- The roadmap says payment methods originate from provider capabilities but are enabled/controlled per merchant provider account in Northflow.
- The roadmap scope list includes `payment_method:*` scopes.

---

# Part B - Phase S8 Service Audit Log

## Goal

Create an immutable audit trail for protected service API activity.

Audit logs must answer:

```txt
who called the service
which sourceApp
which merchant
which action
which resource
whether it succeeded or failed
which error code happened if failed
when it happened
which request id was involved
```

Audit logs must never contain secrets.

---

# S8.1 - Data Model and Migration

Add a new Drizzle migration after the current chain:

```txt
0008_po_audit_logs.sql
```

Table name:

```txt
po_audit_logs
```

Use the `po_*` naming convention.

Required fields:

```txt
id text primary key
request_id text not null
client_id text nullable
source_app text nullable
merchant_id text nullable
actor_type text not null
action text not null
resource_type text nullable
resource_id text nullable
status text not null
http_method text nullable
path text nullable
status_code integer nullable
error_code text nullable
ip_address text nullable
user_agent text nullable
metadata jsonb not null default '{}'
created_at timestamp not null default now
```

Recommended `actor_type` values:

```txt
api_client
legacy_client
internal
system
worker
unknown
```

Recommended `status` values:

```txt
success
failure
denied
error
```

Indexes:

```txt
request_id
client_id
merchant_id
action
resource_type + resource_id
status
created_at
```

Migration rules:

- Do not edit migrations `0000` through `0007`.
- Add only `0008_po_audit_logs.sql` plus Drizzle journal/snapshot updates.
- Define the table completely in its migration.
- No random Drizzle migration name.
- No `ALTER TABLE ... ADD ...` to construct the current table.
- Keep journal and snapshot consistent.

Acceptance:

- `migrations/0008_po_audit_logs.sql` exists.
- No random migration name exists for S8.
- Journal references `0008_po_audit_logs`.
- Clean DB migration succeeds.

---

# S8.2 - Core Domain and Repository

Add core domain type:

```txt
AuditLog
```

Suggested domain fields match `po_audit_logs`.

Add repository contract:

```ts
export interface AuditLogRepository {
  create(input: CreateAuditLogInput): Promise<AuditLog>;
  findById(id: string): Promise<AuditLog | null>;
  listByRequestId(requestId: string): Promise<AuditLog[]>;
  listByMerchant(merchantId: string, options?: AuditLogListOptions): Promise<AuditLog[]>;
  listByClient(clientId: string, options?: AuditLogListOptions): Promise<AuditLog[]>;
}
```

Implement Drizzle repository:

```txt
apps/service/src/infrastructure/repositories/DrizzleAuditLogRepository.ts
```

Wire it into:

```txt
apps/service/src/container.ts
apps/service/src/infrastructure/db.ts
```

Rules:

- Audit repository write must be best-effort only where required to avoid breaking core payment operation.
- But code-level audit errors must be visible in logs/tests where appropriate.
- Do not store plaintext API keys, authorization headers, provider credentials, provider secrets, raw webhook secrets, or full request body by default.

---

# S8.3 - Audit Action Model

Create a central action mapping. Do not scatter arbitrary strings everywhere.

Recommended action strings:

```txt
merchant.create
merchant.read
provider_account.create
provider_account.read
payment_method.list
payment_method.upsert
payment_method.sync
payment_options.read
payment_intent.create
payment_intent.status.read
payment_intent.refundability.read
gateway_payment.create
payment.refund
payment.void
payment.reconcile
provider_event.reprocess
```

Optional additional actions if existing routes need them:

```txt
health.read
version.read
ready.read
```

Protected route audit is required. Health/version/ready may be skipped or explicitly documented as unaudited public routes.

---

# S8.4 - Audit Logging Mechanism

Implement an audit helper/middleware/service that can log protected route activity consistently.

Recommended approach:

```txt
1. requestContextMiddleware already provides request id.
2. auth middleware attaches req.auth for protected /v1 routes.
3. route handlers or an audit wrapper call audit after success/failure.
4. authorization denials should also be audited when enough context exists.
```

Create helper utilities such as:

```ts
auditSuccess(req, { action, merchantId, resourceType, resourceId, metadata })
auditDenied(req, { action, merchantId, resourceType, resourceId, errorCode, statusCode, metadata })
auditFailure(req, { action, merchantId, resourceType, resourceId, errorCode, statusCode, metadata })
```

or an equivalent `AuditService`.

Rules:

- Use `req.requestId` or existing request context id.
- Use `req.auth.clientId` and `req.auth.sourceApp` when available.
- If auth failed before req.auth exists, capture actor as `unknown` only if practical.
- Audit logging must not expose sensitive headers or secrets.
- Metadata must be small and safe.
- Do not store full request body.
- Do not store provider raw response unless it is explicitly sanitized.

---

# S8.5 - Required Route Coverage

Audit at minimum these protected actions:

```txt
POST /v1/merchants
GET  /v1/merchants/:id

POST /v1/merchants/:merchantId/provider-accounts
GET  /v1/merchants/:merchantId/provider-accounts/:id

GET  /v1/merchants/:merchantId/payment-methods
GET  /v1/merchants/:merchantId/provider-accounts/:providerAccountId/methods
PUT  /v1/merchants/:merchantId/provider-accounts/:providerAccountId/methods/:method
POST /v1/merchants/:merchantId/provider-accounts/:providerAccountId/methods/sync
GET  /v1/payment-intents/:intentId/payment-options

POST /v1/payment-intents
GET  /v1/payment-intents/:id/status
GET  /v1/payment-intents/:id/refundability
POST /v1/payment-intents/:id/gateway-payments
POST /v1/payment-intents/:id/reconcile

POST /v1/payment-transactions/:transactionId/refund
POST /v1/payment-transactions/:transactionId/void
```

For provider event reprocess routes, audit if the route already exists.

If some listed route does not currently exist, do not create unrelated functionality just for audit. Document it in the validation report.

Acceptance:

- Successful protected mutation routes create `success` audit logs.
- Authorization denial creates `denied` audit logs where route context is available.
- Business/use-case failure creates `failure` or `error` audit logs where practical.

---

# S8.6 - Failed Authorization Audit

Audit should capture denied attempts where merchant context is known.

Required examples:

```txt
MERCHANT_ACCESS_DENIED
SCOPE_DENIED
SOURCE_APP_MISMATCH
SERVICE_MISCONFIGURED on protected merchant route
```

Rules:

- Do not break existing error response envelope.
- Do not change HTTP status codes from S1-S7.5.
- Do not leak client credential data.
- If request lacks enough context to identify merchant/resource, still audit client/sourceApp/action where possible.

---

# S8.7 - Read APIs For Audit Logs

Add minimal internal read endpoints only if consistent with current service scope.

Preferred route family:

```txt
GET /v1/audit-logs?merchantId=&clientId=&action=&resourceType=&resourceId=&status=&limit=
GET /v1/audit-logs/:id
```

Scope:

```txt
audit_log:read
```

Rules:

- Only internal/system clients or explicitly scoped API clients may read audit logs.
- Merchant-scoped clients may only read logs for merchants they are granted, unless sourceApp is internal.
- Return safe data only.
- Do not expose secrets.

If implementing read APIs is too large for S8 first pass, implement repository + tests and document read API as S8.1 follow-up. However, route-level audit creation must be implemented in this phase.

---

# S8.8 - Scope Update

Add scope documentation and fixtures for:

```txt
audit_log:read
```

Do not grant it broadly in existing smoke tests unless needed.

---

# S8.9 - Tests

Add tests for:

## Repository/schema

```txt
create audit log
find by id
list by request id
list by merchant
list by client
indexes/migration static check for 0008 name
```

## Audit write behavior

```txt
successful create merchant writes audit log
successful create payment intent writes audit log
successful create gateway payment writes audit log
successful provider account method sync/upsert writes audit log
```

## Denial/failure behavior

```txt
cross-merchant access denied writes denied audit log
missing scope writes denied audit log
sourceApp mismatch writes denied audit log
SERVICE_MISCONFIGURED on protected route writes denied/error audit log where possible
business validation failure writes failure/error audit log where practical
```

## Redaction/security

```txt
audit metadata does not include Authorization header
audit metadata does not include x-nf-api-key
audit metadata does not include raw API key
audit metadata does not include provider credential secrets
```

## Migration static check

```txt
0008_po_audit_logs.sql exists
no random 0008 migration name exists
0008 migration does not contain ALTER TABLE ... ADD ...
journal references 0008_po_audit_logs
```

---

# S8.10 - Documentation

Create or update:

```txt
docs/service-audit-log.md
```

The doc must explain:

```txt
purpose of audit logs
data stored
data never stored
action names
status values
actor_type values
route coverage
failed authorization behavior
how to query audit logs if read API is implemented
retention notes for future operations
```

Update integration docs only if needed to mention request ids and auditability.

---

# S8.11 - Validation Report

Create:

```txt
.agents/memory/s8-service-audit-log-validation.md
```

Must include:

```txt
timestamp
git commit checked
files changed
migration result
commands run
pass/fail/skipped results
known pre-existing failures
remaining issues
routes audited
routes intentionally not audited and why
```

Run:

```bash
pnpm type-check
pnpm test
pnpm db:generate
pnpm db:migrate
```

Also run service-specific checks if root checks are noisy:

```bash
pnpm --filter @northflow/payment-orchestration-service type-check
```

If root type-check still has known dashboard/client-sdk issues, document them as pre-existing and prove service checks are clean.

---

# Implementation Rules

1. Keep audit logs immutable. Do not add update/delete business paths for audit logs.
2. Do not store secrets.
3. Do not store full request bodies by default.
4. Preserve existing error envelopes and status codes.
5. Preserve S1-S7.5 security behavior.
6. Do not edit migrations `0000` through `0007`.
7. Add only a descriptive `0008_po_audit_logs.sql` migration for audit schema.
8. Keep Drizzle journal and snapshot consistent.
9. Do not introduce dashboard-specific concepts yet; `admin_user` remains future actor type only.
10. Document any route that cannot be audited in this pass.

---

# Expected Final State

After completion:

```txt
roadmap/service/main.md includes S7.5.
S8 audit log data model exists as po_audit_logs.
Drizzle migration 0008_po_audit_logs.sql exists and applies cleanly.
Audit repository and service/helper exist.
Protected service routes write audit logs for success and denial/failure where practical.
Audit logs redact secrets.
Tests prove audit writes, denial logging, redaction, and migration naming.
Validation report is committed.
```

Commit and push all changes.
