# Claude Prompt — S10.6 Staging Deployment Execution + Runtime Smoke Validation

Repository: `northflow-payment-orchestration`

## Phase

`S10.6 — Staging Deployment Execution + Runtime Smoke Validation`

## Context

S10.5 created deployment readiness docs and scripts. S10.5.1 fixed smoke script runtime contract issues, and the final direct patch added a regression guard so gateway payment response parsing must use `data.transaction.id`.

Now do the next phase: run and document a real staging deployment validation flow. This is not a new feature phase. It is a staging runtime verification phase before release candidate or production go-live.

## Hard Rules

- No new payment features.
- No dashboard UI.
- No new provider integration.
- Keep provider codes unchanged: `manual`, `fake_gateway`, `xendit_sandbox`.
- No DB schema or migration changes unless a real deployment blocker is discovered and documented.
- No public REST route rename.
- No SDK public API rename.
- No inbound HMAC canonical signing change.
- No merchant outbound webhook signature change.
- No real production provider credentials in tests, docs, logs, reports, or scripts.
- No real merchant production traffic.
- Northflow remains backend-to-backend only. No frontend/browser direct-call pattern.

---

## Goal

Produce a staging deployment execution pack and validation evidence showing that a deployed Northflow service can pass:

1. service boot verification
2. migration verification
3. `/health`
4. `/version`
5. `/ready`
6. API key auth
7. invalid key rejection
8. merchant access guard
9. scope guard
10. sourceApp enforcement
11. provider account setup
12. payment method setup
13. payment intent creation
14. gateway payment creation
15. fake gateway confirmation where staging allows dev route
16. payment status read
17. refundability read
18. refund or void smoke when valid
19. audit log read or documented skip
20. outbound merchant webhook smoke when configured
21. no secret leak in responses or reports

---

## Task A — Create staging runbook

Create:

```txt
docs/deployment/staging-runtime-smoke-runbook.md
```

The runbook must document the exact operator sequence:

```txt
1. select staging domain
2. configure env vars
3. deploy service
4. run migrations
5. verify server boot logs
6. run /health
7. run /version
8. run /ready
9. bootstrap API client and credential
10. bootstrap merchant access grant
11. run pnpm s10:readiness
12. run pnpm s10:smoke
13. collect output
14. inspect audit logs
15. inspect rate limit behavior
16. inspect sourceApp and merchant access guard behavior
17. record result in validation report
```

Include commands using placeholders only.

Do not include real domains, keys, provider secrets, database URLs, or customer data.

---

## Task B — Create staging env template

Create:

```txt
docs/deployment/staging-env-template.md
```

It must include placeholder-only env template for:

```txt
NODE_ENV
PORT
DATABASE_URL
PAYMENT_ORCHESTRATION_LEGACY_SERVICE_TOKEN_ENABLED
PAYMENT_ORCHESTRATION_READY_TOKEN
PAYMENT_ORCHESTRATION_CORS_ENABLED
PAYMENT_ORCHESTRATION_CORS_ALLOWED_ORIGINS
PAYMENT_ORCHESTRATION_TRUST_PROXY
PAYMENT_ORCHESTRATION_JSON_BODY_LIMIT
PAYMENT_ORCHESTRATION_RATE_LIMIT_ENABLED
PAYMENT_ORCHESTRATION_RATE_LIMIT_CLIENT_GLOBAL_PER_MINUTE
PAYMENT_ORCHESTRATION_RATE_LIMIT_CLIENT_ROUTE_PER_MINUTE
PAYMENT_ORCHESTRATION_RATE_LIMIT_AUTH_FAILURE_PER_MINUTE
PAYMENT_ORCHESTRATION_OUTBOUND_WEBHOOKS_ENABLED
PAYMENT_ORCHESTRATION_OUTBOUND_WEBHOOKS_TIMEOUT_MS
PAYMENT_ORCHESTRATION_OUTBOUND_WEBHOOKS_MAX_ATTEMPTS
PAYMENT_ORCHESTRATION_OUTBOUND_WEBHOOKS_RESPONSE_BODY_LIMIT
PAYMENT_ORCHESTRATION_XENDIT_SANDBOX_ENABLED
PAYMENT_ORCHESTRATION_XENDIT_BASE_URL
PAYMENT_ORCHESTRATION_XENDIT_CALLBACK_TOKEN
```

If actual env names differ, use the actual names from `apps/service/src/config/env.ts`.

Rules:

- Use placeholders like `<STAGING_DATABASE_URL>` only.
- State that legacy global token must stay disabled for staging security validation unless explicitly testing legacy compatibility.
- State that CORS should be disabled or strict allowlist.
- State that `/ready` token should be set in staging.

---

## Task C — Add staging smoke command guide

Create or update:

```txt
docs/deployment/staging-smoke-commands.md
```

Include copy-paste command blocks for:

```bash
pnpm install
pnpm --filter @northflow/payment-orchestration-service db:migrate
pnpm --filter @northflow/payment-orchestration-service type-check
pnpm s10:readiness --help
pnpm s10:smoke --help
pnpm s10:readiness
pnpm s10:smoke
```

Also include curl examples for:

```txt
GET /health
GET /version
GET /ready with x-nf-ready-token
invalid API key rejection check
```

Use placeholders only.

---

## Task D — Runtime smoke evidence format

Create:

```txt
docs/deployment/staging-smoke-result-template.md
```

This file is a template for human/runtime output collection.

Required sections:

```txt
Deployment target
Commit SHA
Environment summary without secrets
Migration status
Health result
Version result
Ready result
Readiness script result
Smoke script result
Auth guard result
Merchant access guard result
Scope guard result
SourceApp guard result
Audit log result
Rate limit result
Webhook result
Known skips
Failures
Decision: PASS / FAIL
```

Do not include fake pass results. This is a template unless the agent actually runs against a real deployed service.

---

## Task E — Add static tests for S10.6 artifacts

Add:

```txt
tests/s10-6-staging-deployment-smoke-validation.test.ts
```

Static tests must verify:

1. staging runbook exists
2. staging env template exists
3. staging smoke command guide exists
4. staging result template exists
5. runbook includes migration, health, version, ready, readiness script, smoke script
6. env template includes ready token, rate limit, CORS, trust proxy, outbound webhook, Xendit sandbox env placeholders
7. command guide includes `pnpm s10:readiness` and `pnpm s10:smoke`
8. result template includes PASS/FAIL decision section
9. docs do not contain real-looking credentials or database URLs
10. docs do not recommend browser/frontend direct Northflow calls
11. provider codes remain unchanged
12. S10.5.1 gateway transaction parsing guard remains present

---

## Task F — Optional script dry-run validation

Do not require a live deployment in CI. But verify local dry-run/help behavior:

```bash
pnpm s10:readiness --help
pnpm s10:smoke --help
```

If a live staging URL is not available, do not fake success. Document as `not run — staging URL not provided`.

---

## Task G — Validation report

Create:

```txt
.agents/memory/s10-6-staging-deployment-runtime-smoke-validation.md
```

Include:

```txt
timestamp
commit checked
files changed
what was added
whether live staging deployment was actually run
if not run, exact reason
commands run
type-check results
test results
readiness help result
smoke help result
staging smoke result template status
provider codes unchanged confirmation
no DB schema/migration change confirmation
no route behavior change confirmation
no SDK public API breaking change confirmation
no HMAC/signature change confirmation
no dashboard implementation confirmation
remaining issues
next recommended phase
```

Do not claim live deployment passed unless a real staging URL and credentials were provided and commands were actually run.

---

## Required Commands

Run and document:

```bash
pnpm --filter @northflow/payment-orchestration-core type-check
pnpm --filter @northflow/payment-orchestration-client-sdk type-check
pnpm --filter @northflow/payment-orchestration-service type-check
pnpm test
pnpm s10:readiness --help
pnpm s10:smoke --help
```

If live staging env is available, also run:

```bash
pnpm s10:readiness
pnpm s10:smoke
```

If live staging env is not available, do not run those commands and document the skip honestly.

---

## Acceptance Criteria

S10.6 is complete only when:

- staging runtime smoke runbook exists
- staging env template exists
- staging smoke command guide exists
- staging smoke result template exists
- S10.6 static tests exist
- validation report exists
- type-check and tests pass, or failures are honestly documented
- help mode for readiness and smoke scripts is verified
- no secrets are committed
- no fake live deployment pass is claimed
- provider codes remain unchanged
- no route behavior changes
- no DB schema/migration changes
- no SDK public API breaking changes
- no HMAC/signature changes
- no dashboard implementation added

Commit and push all changes.
