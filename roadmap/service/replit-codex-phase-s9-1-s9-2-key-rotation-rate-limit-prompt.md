# Replit/Codex Prompt - Phase S9.1-S9.2 API Key Rotation and Rate Limit

You are working in the `northflow-payment-orchestration` repository.

S1-S5 service security is complete. S6-S7 client integration is complete. S7.5 payment method options is complete. S8 service audit log is complete.

This prompt implements the next service protection hardening phases:

- S9.1 — API Key Rotation and Credential Lifecycle
- S9.2 — Rate Limit and Abuse Protection

Do not implement dashboard UI.
Do not implement provider webhook roadmap expansion.
Do not implement HMAC signed requests in this phase.
Do not implement mTLS/private-network changes in code.
Do not weaken S1-S8 authentication, merchant access, sourceApp, scope authorization, payment method, idempotency, SDK, or audit log guarantees.

---

# Current Security Context

Northflow now uses API client credentials for consumer backends:

```txt
AuraPoS backend  -> Northflow API client credential
Transity backend -> Northflow API client credential / SDK
Kioskoin backend -> Northflow API client credential
```

The service already supports hashed credentials, prefix lookup, scopes, merchant grants, audit logs, and legacy-token compatibility mode.

This phase must harden credential lifecycle and abuse controls.

---

# Part A - S9.1 API Key Rotation and Credential Lifecycle

## Goal

Allow each API client to maintain multiple credentials safely so keys can be rotated without downtime.

The final model must support:

```txt
active current key
active next key during rotation
revoked key
expired key
lastUsedAt tracking
safe key prefix lookup
one-time plaintext display only
```

Key rotation must be auditable.

---

## S9.1.1 - Review Existing Credential Model

Inspect existing tables, schema, repositories, and auth middleware for API client credentials.

Expected current concepts:

```txt
client credentials table
credential prefix
credential hash
status
expiresAt
lastUsedAt
createdAt
revokedAt
```

If the current schema already supports multiple credentials per client, do not add unnecessary columns.

If missing fields exist, add a new Drizzle migration.

Rules:

- Do not edit migrations 0000 through 0008.
- If schema change is required, add:

```txt
0009_po_client_credential_lifecycle.sql
```

- Use descriptive migration name.
- Do not generate random Drizzle migration names.
- Do not use `ALTER TABLE ... ADD ...` unless this is truly a future schema change after the clean baseline. If adding columns to an existing table is unavoidable, document why in the validation report.
- Keep journal/snapshot consistent.

---

## S9.1.2 - Credential Lifecycle Operations

Add service/use-case support for:

```txt
create credential for API client
list credentials for API client
revoke credential
rotate credential
```

Recommended route family:

```txt
POST /v1/api-clients/:clientId/credentials
GET  /v1/api-clients/:clientId/credentials
POST /v1/api-clients/:clientId/credentials/:credentialId/revoke
POST /v1/api-clients/:clientId/credentials/rotate
```

If the repo already has API client management routes, extend those instead of duplicating.

Required scopes:

```txt
api_client:credential:create
api_client:credential:read
api_client:credential:revoke
api_client:credential:rotate
```

Alternative: use a single broader `api_client:manage_credentials` only if existing scope style strongly prefers it. If you choose the broader scope, document the decision clearly.

Access rules:

- Internal/system client can manage any API client credentials.
- A normal API client may manage only its own credentials if explicitly scoped.
- Normal API clients must not manage credentials for another client.
- Legacy token mode must not become the recommended credential management path.

---

## S9.1.3 - Credential Creation Rules

When creating a credential:

- Generate secure random plaintext credential.
- Store only prefix + hash.
- Return plaintext credential only once in the creation response.
- Never store plaintext credential.
- Never log plaintext credential.
- Never include plaintext credential in audit metadata.
- Support optional `expiresAt`.
- Default new credential status should be `active` unless explicitly created disabled.
- Prefix must be safe and unique enough for lookup.

Response should include safe metadata only:

```txt
credentialId
clientId
credentialPrefix
status
expiresAt
createdAt
rawCredential only on create/rotate response
```

Do not expose credential hash.

---

## S9.1.4 - Credential Rotation Rules

Rotation must support zero downtime.

Recommended behavior for:

```txt
POST /v1/api-clients/:clientId/credentials/rotate
```

Input:

```txt
revokeOldCredentialId optional
oldCredentialGracePeriodSeconds optional
expiresAt optional for new credential
```

Behavior options:

1. Create a new active credential for the same client.
2. If `revokeOldCredentialId` is provided and no grace period is requested, revoke old credential immediately.
3. If grace period is requested but schema does not support scheduled revocation yet, document as unsupported and do not pretend to schedule it.
4. Return new plaintext credential once.

Minimum acceptable implementation:

```txt
create new active credential
optionally revoke specified old credential immediately
record audit log for rotation
```

Do not disable all credentials for a client by accident.

---

## S9.1.5 - Revoke Rules

When revoking:

- Credential must exist.
- Credential must belong to the target client.
- Revocation must set status to `revoked` and `revokedAt`.
- Revoked credential must no longer authenticate.
- Revoke must be idempotent: revoking an already revoked credential should not corrupt state.
- Do not delete credential rows.

Audit action:

```txt
api_client.credential.revoke
```

---

## S9.1.6 - Last Used Tracking

Ensure successful auth updates `lastUsedAt` for the credential used.

Rules:

- Update must be best-effort and must not break successful auth if tracking write fails.
- Do not update `lastUsedAt` for invalid/revoked/expired keys.
- Tests must prove `lastUsedAt` changes on successful auth.

---

## S9.1.7 - Audit Log Integration

Add audit actions:

```txt
api_client.credential.create
api_client.credential.read
api_client.credential.revoke
api_client.credential.rotate
```

Audit metadata must never include plaintext credential, credential hash, Authorization header, or x-nf-api-key.

Audit safe fields allowed:

```txt
clientId
credentialId
credentialPrefix
status
expiresAt
revokedAt
```

---

## S9.1.8 - SDK / Docs

Update SDK only if credential management endpoints are intended to be consumed by internal tooling or backend apps now.

At minimum update docs:

```txt
docs/security/api-key-rotation.md
```

The doc must explain:

```txt
how to create a new key
how to deploy new key to AuraPoS/Transity/Kioskoin
how to verify lastUsedAt
how to revoke old key
how to rotate without downtime
what is never stored or logged
what to do if a key leaks
```

---

# Part B - S9.2 Rate Limit and Abuse Protection

## Goal

Protect the service against abusive or accidental high-volume traffic.

The first implementation can be in-memory/per-process for development and single-instance deployments, but the design must be compatible with Redis/distributed storage later.

Do not overbuild Redis in this phase unless the repo already has Redis infrastructure.

---

## S9.2.1 - Rate Limit Design

Add a rate limit abstraction:

```ts
interface RateLimiterStore {
  hit(key: string, windowMs: number, limit: number): Promise<RateLimitResult>;
}
```

Result should include:

```txt
allowed
limit
remaining
resetAt
retryAfterSeconds
```

Provide an in-memory implementation:

```txt
InMemoryRateLimiterStore
```

Design should allow future Redis implementation:

```txt
RedisRateLimiterStore
```

Do not require Redis now unless already available.

---

## S9.2.2 - Rate Limit Middleware

Add middleware for protected service routes.

Recommended keys:

```txt
authenticated client route key: client:{clientId}:route:{method}:{routeGroup}
authenticated client global key: client:{clientId}:global
unauthenticated auth failure key: ip:{ip}:auth_fail
credential prefix failure key: credential_prefix:{prefix}:auth_fail
```

Initial defaults must be configurable through env.

Suggested env names:

```txt
PAYMENT_ORCHESTRATION_RATE_LIMIT_ENABLED=true
PAYMENT_ORCHESTRATION_RATE_LIMIT_CLIENT_GLOBAL_PER_MINUTE=600
PAYMENT_ORCHESTRATION_RATE_LIMIT_CLIENT_ROUTE_PER_MINUTE=120
PAYMENT_ORCHESTRATION_RATE_LIMIT_AUTH_FAILURE_PER_MINUTE=30
```

Development/test may default to permissive values, but production default should be enabled.

---

## S9.2.3 - Headers and Error Contract

When rate limit applies, add standard-ish headers:

```txt
X-RateLimit-Limit
X-RateLimit-Remaining
X-RateLimit-Reset
Retry-After
```

When denied, return:

```txt
429 RATE_LIMITED
```

Do not change existing error envelope shape.

---

## S9.2.4 - Scope/Route Sensitivity

Different actions may have different limits.

Minimum implementation:

```txt
global per-client limit
per-route per-client limit
auth failure limit
```

Optional stricter route groups:

```txt
gateway_payment.create
payment.refund
payment.void
payment.reconcile
payment_method.sync
api_client.credential.create
api_client.credential.rotate
api_client.credential.revoke
```

Do not make test/dev limits so strict that normal test suite becomes flaky.

---

## S9.2.5 - Auth Failure Abuse Protection

Protect invalid credential attempts.

Rules:

- Count invalid credential attempts by IP.
- If a credential prefix is parseable, count by prefix too.
- Do not leak whether a prefix exists.
- Return the same 401 error envelope until rate limited.
- Once rate limited, return 429 RATE_LIMITED.
- Audit rate-limited attempts if possible without storing secrets.

---

## S9.2.6 - Audit Log Integration

Add audit action:

```txt
rate_limit.denied
```

For credential management rate limits, also include action metadata where safe:

```txt
routeGroup
limit
resetAt
clientId if authenticated
```

Do not store API keys, auth headers, or raw credential values.

---

## S9.2.7 - Tests

Add tests for:

### Credential lifecycle

```txt
create credential returns plaintext once
stored row has prefix/hash only
list credentials never returns plaintext/hash
revoke credential prevents auth
expired credential prevents auth
rotation creates new active key
rotation optionally revokes old key
lastUsedAt updates on successful auth
normal client cannot manage another client's credentials
missing scope returns SCOPE_DENIED
credential lifecycle audit logs are written and redacted
```

### Rate limiting

```txt
client global limit returns 429 after threshold
client route limit returns 429 after threshold
auth failure limit returns 429 after repeated invalid attempts
rate limit headers exist
Retry-After exists on 429
rate limit denied audit log is written
rate limiting can be disabled in config for tests/dev
```

### Security/redaction

```txt
no plaintext credential in audit logs
no credential hash in API response
no Authorization header in audit metadata
no x-nf-api-key in audit metadata
invalid credential responses do not reveal whether prefix exists
```

---

# Part C - Roadmap and Documentation Updates

Update:

```txt
roadmap/service/main.md
```

Add/expand S9.1 and S9.2 as active implementation phases, not vague future notes.

Add the new credential management scopes to official scope list:

```txt
api_client:credential:create
api_client:credential:read
api_client:credential:revoke
api_client:credential:rotate
```

If you choose a broader scope instead, update docs consistently.

Add docs:

```txt
docs/security/api-key-rotation.md
docs/security/rate-limits.md
```

Docs must include examples for:

```txt
AuraPoS key rotation
Transity SDK key rotation
Kioskoin key rotation
rate limit behavior
429 response shape
safe incident response if a key leaks
```

---

# Migration Requirements

If a schema change is needed, add one descriptive migration after 0008:

```txt
0009_po_client_credential_lifecycle.sql
```

If no schema change is needed, do not create unnecessary migrations.

Rules:

- Do not edit migrations 0000 through 0008.
- Do not create random migration filenames.
- Keep Drizzle journal/snapshot consistent.
- `pnpm db:generate` should show no unexpected drift after changes.

---

# Validation Report

Create:

```txt
.agents/memory/s9-1-s9-2-key-rotation-rate-limit-validation.md
```

Must include:

```txt
timestamp
git commit checked
files changed
migration result or no-migration-needed explanation
commands run
pass/fail/skipped results
known pre-existing failures
remaining issues
credential lifecycle routes added
rate limit behavior summary
security/redaction result
```

Run:

```bash
pnpm type-check
pnpm test
pnpm db:generate
pnpm db:migrate
```

Also run service-specific checks if root workspace is noisy:

```bash
pnpm --filter @northflow/payment-orchestration-service type-check
```

Do not fake validation results. If a command cannot run, document the exact reason.

---

# Implementation Rules

1. Never store plaintext API keys.
2. Return plaintext API key only once during create/rotate.
3. Never store API keys, Authorization headers, x-nf-api-key, or hashes in audit metadata.
4. Do not leak whether a credential prefix exists on auth failure.
5. Revoked and expired keys must not authenticate.
6. Rotation must not accidentally revoke all keys for a client.
7. Rate limit denial must preserve existing error envelope style.
8. Rate limit must be configurable and test-safe.
9. Do not implement HMAC signed requests in this phase.
10. Do not implement dashboard UI in this phase.
11. Do not implement provider webhook hardening in this phase.
12. Keep audit logging best-effort and non-fatal.

---

# Expected Final State

After S9.1-S9.2:

```txt
API clients can create, list, revoke, and rotate credentials safely.
Multiple active credentials per client are supported for zero-downtime rotation.
Revoked and expired credentials cannot authenticate.
lastUsedAt is updated on successful auth.
Credential lifecycle operations are audited and redacted.
Service has configurable rate limiting for authenticated clients and auth failures.
429 RATE_LIMITED responses include rate limit headers.
Docs explain key rotation and rate limit behavior for AuraPoS, Transity, and Kioskoin.
Validation report is committed.
```

Commit and push all changes.
