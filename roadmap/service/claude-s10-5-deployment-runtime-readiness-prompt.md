# Claude Prompt — S10.5 Deployment Runtime Readiness

You are working in `northflow-payment-orchestration`.

S10.4 and S10.4.1 froze the public REST/SDK/webhook contract. This phase prepares the standalone service for safe deployment and repeatable runtime smoke validation.

## Hard Rules

- Do not add payment features.
- Do not add dashboard UI.
- Do not add provider integrations.
- Do not change provider codes: `manual`, `fake_gateway`, `xendit_sandbox`.
- Do not change public route paths unless fixing a proven deployment/runtime mismatch.
- Do not change OpenAPI contract unless the runtime check finds a real mismatch.
- Do not change database schema unless an existing migration/runtime mismatch blocks deployment.
- Do not change inbound HMAC canonical request signing.
- Do not change merchant outbound webhook signature format.
- Do not expose real secrets, API keys, provider credentials, webhook secrets, signing secrets, service tokens, or database URLs.
- Use placeholder values only in docs and env examples.

---

## Goal

Make the service deployable and verifiable in a clean environment.

The final result must answer:

```txt
Can a fresh deployment install dependencies, build/type-check, run migrations, start the service, report readiness, and pass a minimal backend-to-backend smoke flow without using real provider credentials?
```

---

## Task A — Runtime entrypoint audit

Audit current runtime entrypoints:

```txt
apps/service/src/index.ts
apps/service/src/app.ts
apps/service/src/workers/run.ts
package.json
apps/service/package.json
Dockerfile / docker-compose files if present
```

Verify and document:

- how to start the HTTP service in production
- how to run the merchant webhook delivery worker
- how to run migrations
- how to run type-check/tests
- required Node version
- required package manager command
- expected default port
- graceful shutdown behavior if implemented

If start scripts are missing or incorrect, add minimal scripts without changing application behavior.

---

## Task B — Environment contract freeze

Create or update:

```txt
.env.example
docs/deployment/environment.md
```

Document all required and optional env vars with safe placeholder examples.

At minimum cover:

```txt
NODE_ENV
PORT
DATABASE_URL
PAYMENT_ORCHESTRATION_LEGACY_SERVICE_TOKEN_ENABLED
PAYMENT_ORCHESTRATION_SERVICE_TOKEN
PAYMENT_ORCHESTRATION_SIGNED_REQUESTS_MODE
PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_SECRET
PAYMENT_ORCHESTRATION_RATE_LIMIT_ENABLED
PAYMENT_ORCHESTRATION_RATE_LIMIT_CLIENT_GLOBAL_PER_MINUTE
PAYMENT_ORCHESTRATION_RATE_LIMIT_CLIENT_ROUTE_PER_MINUTE
PAYMENT_ORCHESTRATION_RATE_LIMIT_AUTH_FAILURE_PER_MINUTE
PAYMENT_ORCHESTRATION_CORS_ENABLED
PAYMENT_ORCHESTRATION_CORS_ALLOWED_ORIGINS
PAYMENT_ORCHESTRATION_TRUST_PROXY
PAYMENT_ORCHESTRATION_JSON_BODY_LIMIT
PAYMENT_ORCHESTRATION_OUTBOUND_WEBHOOKS_ENABLED
PAYMENT_ORCHESTRATION_OUTBOUND_WEBHOOK_TIMEOUT_MS
PAYMENT_ORCHESTRATION_OUTBOUND_WEBHOOK_MAX_ATTEMPTS
PAYMENT_ORCHESTRATION_OUTBOUND_WEBHOOK_RESPONSE_BODY_LIMIT
XENDIT_SANDBOX_ENABLED
XENDIT_CALLBACK_TOKEN
```

Rules:

- Do not include real values.
- Mark which vars are required in production.
- Mark which vars are dev/test only.
- Explain which vars must be backend/server-only.
- Explain safe defaults.
- Explain that frontend/browser clients must not call Northflow directly.

If env var names differ in code, use actual names from `apps/service/src/config/env.ts` and correct this list accordingly.

---

## Task C — Config validation and readiness check

Audit `apps/service/src/config/env.ts` and readiness route.

Required behavior:

- Missing production-critical config should fail clearly or make `/ready` report not ready.
- `/health` should be lightweight liveness.
- `/ready` should reflect DB/provider/runtime readiness without leaking secrets.
- Readiness response must never expose raw env values.
- If Xendit sandbox is disabled, readiness should not fail only because Xendit sandbox credentials are absent.
- If outbound webhooks are enabled, missing signing/encryption config must be surfaced safely.

Add tests if gaps exist.

---

## Task D — Migration and bootstrap documentation

Create or update:

```txt
docs/deployment/database-migrations.md
docs/deployment/bootstrap-runtime.md
```

Document:

- how to apply migrations in a fresh database
- how to verify schema is current
- how to bootstrap an API client and merchant for smoke testing
- how to create API credential safely
- how to create provider account using `manual` or `fake_gateway`
- how to enable provider account methods
- how to create and confirm a test payment intent
- how to configure merchant outbound webhook endpoint with a fake/local receiver

Do not require real PSP credentials for smoke tests.

---

## Task E — Deployment smoke script

Add a script if missing:

```txt
scripts/smoke-service-runtime.ts
```

The script should be safe and backend-only.

It should support env/config inputs like:

```txt
NORTHFLOW_BASE_URL
NORTHFLOW_API_KEY
NORTHFLOW_MERCHANT_ID
NORTHFLOW_PROVIDER_ACCOUNT_ID
```

Smoke flow should verify, where possible:

1. GET `/health`
2. GET `/ready`
3. create/read merchant or use existing merchant
4. create/read provider account or use existing provider account
5. upsert/list provider account method
6. create payment intent
7. create fake/manual payment transaction if supported
8. read payment intent status
9. list payment options
10. optionally create/list merchant webhook endpoint using placeholder/local URL

Rules:

- Script must not log secrets.
- Script must print clear pass/fail steps.
- Script must exit non-zero on failure.
- If some step requires existing IDs, support skip flags or env-based IDs.
- Do not call real provider APIs.

Add package script if appropriate:

```txt
pnpm smoke:service
```

---

## Task F — Worker runtime smoke

Add or document how to run:

```bash
pnpm --filter @northflow/payment-orchestration-service worker deliver-merchant-webhooks --limit 25
```

Verify the worker:

- starts without HTTP server
- exits cleanly after processing due deliveries
- does not require provider credentials
- does not leak webhook secrets in logs
- handles zero due deliveries safely

Add a focused test if missing.

---

## Task G — Docker / process deployment docs

Create or update:

```txt
docs/deployment/docker.md
docs/deployment/process-manager.md
```

Cover both:

```txt
HTTP service process
merchant webhook delivery worker process / cron / scheduled job
```

Document:

- build command
- start command
- env file usage
- port mapping
- health/readiness checks
- worker schedule recommendation
- log redaction expectations
- rolling restart considerations
- rollback checklist

If a Dockerfile exists and is broken, patch it minimally. If no Dockerfile exists, document non-Docker deployment and optionally add a simple Dockerfile only if consistent with repo style.

---

## Task H — CI / static verification

Add or update tests to guard deployment docs/scripts.

Suggested tests:

```txt
tests/s10-5-deployment-readiness.test.ts
```

Required assertions:

- `.env.example` exists and does not contain real secrets.
- deployment docs exist.
- smoke script exists and redacts API key/service token values from output.
- package scripts include service type-check/test and smoke command if added.
- readiness docs mention `/health` and `/ready` separation.
- worker docs mention outbound webhook delivery worker.
- no frontend/public env var pattern is used for secrets.
- provider codes remain unchanged.
```

Use static tests unless runtime integration is already available.

---

## Task I — Validation report

Create:

```txt
.agents/memory/s10-5-deployment-runtime-readiness-validation.md
```

Include:

- timestamp
- commit checked
- files changed
- runtime entrypoints audited
- env vars documented
- migration/bootstrap docs status
- smoke script status
- worker runtime status
- Docker/process docs status
- tests added/updated
- commands run
- type-check results
- test results
- provider codes unchanged confirmation
- no route/db/schema/signature behavior change confirmation
- remaining issues

Do not claim command success unless actually run.

---

## Required validation commands

Run and document:

```bash
pnpm --filter @northflow/payment-orchestration-core type-check
pnpm --filter @northflow/payment-orchestration-client-sdk type-check
pnpm --filter @northflow/payment-orchestration-service type-check
pnpm test
```

If a smoke script is added, run it only in safe dry-run/static mode unless a test service is already running with non-secret placeholder credentials. Do not invent a successful live smoke result.

---

## Acceptance Criteria

S10.5 is complete only when:

- Deployment env contract is documented.
- `.env.example` exists and uses safe placeholders only.
- Fresh database migration/bootstrap flow is documented.
- HTTP service start command is documented and/or scripted.
- Merchant webhook worker start command is documented and/or scripted.
- Runtime smoke script exists or an explicit reason is documented if omitted.
- Smoke script/logs do not expose secrets.
- `/health` and `/ready` behavior is documented and tested where practical.
- Deployment docs cover Docker/process manager/rollback basics.
- Provider codes remain unchanged.
- No public API/SDK/webhook signature drift is introduced.
- Core/client-sdk/service type-check pass.
- Full tests pass or failures are honestly documented.
- Validation report exists.

Commit and push all changes.
