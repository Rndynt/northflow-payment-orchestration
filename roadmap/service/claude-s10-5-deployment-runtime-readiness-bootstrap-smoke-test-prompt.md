# Claude Prompt — S10.5 Deployment Runtime Readiness + Bootstrap Smoke Test

You are working in `northflow-payment-orchestration`.

S10.4/S10.4.1 froze the public REST/OpenAPI/SDK contract. S1–S5 security and client integration isolation are already implemented and compliance-tested. This phase must prepare Northflow for real deployment validation by combining deployment runtime readiness, bootstrap data setup, and post-deploy smoke testing into one release-readiness phase.

## Phase Name

```txt
S10.5 — Deployment Runtime Readiness + Bootstrap Smoke Test
```

## Hard Rules

- Do not add new payment features.
- Do not add dashboard UI.
- Do not add provider integrations.
- Do not change provider codes: `manual`, `fake_gateway`, `xendit_sandbox`.
- Do not change public REST route names unless fixing a proven contract mismatch.
- Do not change SDK public method names unless fixing a proven contract mismatch.
- Do not change inbound HMAC canonical request signing.
- Do not change merchant outbound webhook signature format.
- Do not expose API keys, raw credentials, provider secrets, webhook raw secrets, database URLs, or service tokens in docs, tests, validation reports, logs, or sample output.
- Do not use browser/frontend clients for Northflow service API. Northflow remains backend-to-backend only.
- Do not assume production provider credentials are available in tests. Use `fake_gateway` and documented sandbox/manual flows where needed.
- If a command cannot be run, document it honestly in the validation report.

---

## Goal

Create a complete deployment readiness and smoke test pack so that after Northflow is deployed, operators can verify:

1. Runtime env is valid.
2. Server boots correctly.
3. Migrations are present and safe to run.
4. Health/readiness/version endpoints work.
5. API client credential auth works.
6. Merchant access guard works.
7. Scope guard works.
8. SourceApp enforcement works.
9. Provider account setup works.
10. Payment method setup works.
11. Payment intent + gateway payment flow works.
12. Fake gateway confirmation updates transaction/intent state.
13. Refund/void guard paths work where applicable.
14. Audit logs are written.
15. Rate limit headers/behavior are detectable.
16. Merchant outbound webhook endpoint/delivery flow can be smoke-tested.
17. No secret leaks appear in readiness/docs/sample outputs.

---

## Task A — Deployment environment contract

Create or update:

```txt
docs/deployment/runtime-environment.md
```

Document required and optional env vars for deployment.

Must include at least:

```txt
NODE_ENV
PORT
DATABASE_URL
PAYMENT_ORCHESTRATION_LEGACY_SERVICE_TOKEN_ENABLED
PAYMENT_ORCHESTRATION_RATE_LIMIT_ENABLED
PAYMENT_ORCHESTRATION_RATE_LIMIT_CLIENT_GLOBAL_PER_MINUTE
PAYMENT_ORCHESTRATION_RATE_LIMIT_CLIENT_ROUTE_PER_MINUTE
PAYMENT_ORCHESTRATION_RATE_LIMIT_AUTH_FAILURE_PER_MINUTE
PAYMENT_ORCHESTRATION_CORS_ENABLED
PAYMENT_ORCHESTRATION_CORS_ALLOWED_ORIGINS
PAYMENT_ORCHESTRATION_TRUST_PROXY
PAYMENT_ORCHESTRATION_JSON_BODY_LIMIT
PAYMENT_ORCHESTRATION_READY_TOKEN
XENDIT_CALLBACK_TOKEN or current Xendit webhook secret env if used
Provider sandbox env vars currently supported by the repo
Merchant webhook encryption/signing env vars currently required by S10.3 if present
```

Rules:

- Document which env vars are required for service boot.
- Document which env vars are optional and their safe defaults.
- Production default must not rely on global service token.
- Document backend-only secret policy.
- Include a redline section: never expose `DATABASE_URL`, API keys, provider secrets, raw webhook secrets, or service tokens.

If actual env var names differ, use names from the codebase and mention aliases only if they actually exist.

---

## Task B — Deployment checklist

Create or update:

```txt
docs/deployment/deployment-checklist.md
```

Include checklists for:

```txt
Local/dev
Replit
VPS + Nginx
Coolify
Docker/container
Cloudflare/reverse proxy
```

Must include:

```txt
install command
build command
start command
migration command
worker command if any
health check URL
readiness check URL
version check URL
port binding
reverse proxy setup
origin firewall note
CORS policy
ready-token policy
request body limit policy
rate limit env policy
log redaction policy
rollback checklist
```

Do not invent a deployment target that has no repo support. If support is manual, document it as manual.

---

## Task C — Runtime readiness script

Add a script under:

```txt
scripts/s10-5-runtime-readiness-check.ts
```

The script must be runnable after deployment.

Purpose:

```txt
node/tsx script checks a deployed Northflow base URL without mutating payment data
```

Inputs via env or CLI args:

```txt
NORTHFLOW_BASE_URL
NORTHFLOW_READY_TOKEN optional
NORTHFLOW_API_KEY optional for authenticated checks
NORTHFLOW_MERCHANT_ID optional for authenticated checks
NORTHFLOW_SOURCE_APP optional
```

Checks:

```txt
GET /health
GET /version
GET /ready with ready token if configured
verify response is JSON or expected format
verify no obvious secret-looking keys in response body
if API key is provided, call a safe authenticated read endpoint if available
print PASS/FAIL summary
exit code 0 on pass, non-zero on fail
```

Do not print raw API key. If logging configured env, mask values.

---

## Task D — Bootstrap smoke script

Add a script under:

```txt
scripts/s10-5-bootstrap-smoke.ts
```

The script may mutate data, but only in a clearly labeled sandbox/dev/smoke context.

Inputs via env or CLI args:

```txt
NORTHFLOW_BASE_URL
NORTHFLOW_API_KEY
NORTHFLOW_SOURCE_APP
NORTHFLOW_SMOKE_MERCHANT_NAME
NORTHFLOW_SMOKE_EXTERNAL_REF
NORTHFLOW_SMOKE_PROVIDER=fake_gateway
NORTHFLOW_SMOKE_METHOD=qris
NORTHFLOW_SMOKE_CURRENCY=IDR
NORTHFLOW_SMOKE_AMOUNT=10000
NORTHFLOW_SMOKE_WEBHOOK_URL optional
```

Required flow:

1. Create or use a smoke merchant.
2. Verify API client can access that merchant. If route for grant setup is not public, document operator prerequisite instead of inventing a route.
3. Create provider account for `fake_gateway` or use existing one if provided by env.
4. Upsert or sync payment method where supported.
5. Create payment intent.
6. Create gateway payment.
7. Confirm fake gateway payment if dev route enabled.
8. Poll/get payment intent status.
9. Read refundability.
10. Try refund or void only when valid for the transaction state and scope. Do not force both if business state does not allow it.
11. Read audit logs if the API key has `audit_log:read`; otherwise skip with clear message.
12. Create merchant outbound webhook endpoint only if `NORTHFLOW_SMOKE_WEBHOOK_URL` is provided.
13. List webhook deliveries if webhook smoke is enabled and scope is available.

Output:

```txt
S10.5 smoke summary
- readiness: PASS/FAIL
- merchant: PASS/FAIL/SKIPPED
- provider account: PASS/FAIL/SKIPPED
- payment method: PASS/FAIL/SKIPPED
- intent: PASS/FAIL
- gateway payment: PASS/FAIL
- fake confirm: PASS/FAIL/SKIPPED
- status: PASS/FAIL
- refundability: PASS/FAIL/SKIPPED
- refund/void: PASS/FAIL/SKIPPED
- audit log: PASS/FAIL/SKIPPED
- webhook: PASS/FAIL/SKIPPED
```

Mask all sensitive values.

Do not hardcode real merchant/provider secrets.

---

## Task E — Bootstrap operator guide

Create or update:

```txt
docs/deployment/bootstrap-operator-guide.md
```

Document manual bootstrap order for production/staging:

```txt
1. Run migrations
2. Create API client for consumer app
3. Create credential
4. Store raw credential once in backend secret manager
5. Create merchant
6. Grant client merchant access with scopes
7. Create provider account
8. Enable/sync payment methods
9. Configure merchant outbound webhook endpoint if needed
10. Run runtime readiness script
11. Run bootstrap smoke script in sandbox/staging
12. Only then point consumer app to deployed service
```

Include examples for:

```txt
AuraPoS REST
Transity SDK
Kioskoin REST
```

Do not use real secrets. Use placeholders only.

---

## Task F — Production redline checklist

Create or update:

```txt
docs/deployment/production-redline-checklist.md
```

Must state that real production traffic is blocked until all redlines pass:

```txt
/health OK
/version OK
/ready OK or protected correctly
migrations applied
legacy global token disabled in production
API key auth OK
revoked/invalid key rejected
merchant access guard OK
scope guard OK
sourceApp mismatch rejected
provider codes unchanged
fake/manual smoke flow OK
audit log writes OK
rate limit enabled or explicit exception documented
CORS disabled or strict allowlist
trust proxy configured only behind trusted proxy
service port not directly exposed when reverse proxy is used
origin firewall/proxy policy documented
no secret leak in readiness/logs/docs
rollback plan documented
```

Also include explicit redlines:

```txt
Do not allow browser/frontend direct access to Northflow service API.
Do not use global service token in production.
Do not connect real PSP production credentials before smoke test passes in sandbox.
Do not onboard real merchant production traffic before API key, merchant access, sourceApp, scope, and audit checks pass.
Do not expose docs/swagger publicly in production unless protected.
```

---

## Task G — Tests

Add tests:

```txt
tests/s10-5-deployment-runtime-readiness.test.ts
```

Test coverage:

1. Deployment env docs exist and mention required env vars.
2. Deployment checklist exists and includes migration, health, readiness, rollback, proxy/firewall, CORS, ready token.
3. Runtime readiness script exists and masks secrets.
4. Bootstrap smoke script exists and masks secrets.
5. Bootstrap operator guide exists and documents API client -> merchant -> provider account -> payment method -> smoke order.
6. Production redline checklist exists and includes all critical redlines.
7. Scripts do not contain real-looking hardcoded secrets.
8. Provider codes remain unchanged: `manual`, `fake_gateway`, `xendit_sandbox`.
9. No dashboard references as required implementation work.
10. No frontend/browser direct-call recommendation.
11. Docs mention REST and SDK integration paths without making SDK mandatory.
12. Docs mention global service token is not production default.
13. Smoke script output masks API keys and provider/webhook secrets.

Prefer static tests if booting the service is heavy.

---

## Task H — package scripts

If compatible with the repo's package manager setup, add package scripts for the new tools.

Possible names:

```txt
s10:readiness
s10:smoke
```

If root scripts are not appropriate, document direct commands in deployment docs instead.

Do not break existing scripts.

---

## Task I — Validation report

Create:

```txt
.agents/memory/s10-5-deployment-runtime-readiness-bootstrap-smoke-validation.md
```

Include:

```txt
timestamp
commit checked
files changed
what was added
readiness script behavior
smoke script behavior
docs created/updated
redline checklist status
package scripts added or skipped
tests added/updated
commands run
type-check results
test results
provider codes unchanged confirmation
no DB schema/migration change confirmation
no route behavior change confirmation
no SDK public API breaking change confirmation
no HMAC/signature change confirmation
no dashboard implementation confirmation
remaining issues
```

Do not claim any command passed unless actually run.

---

## Required Commands

Run and document:

```bash
pnpm --filter @northflow/payment-orchestration-core type-check
pnpm --filter @northflow/payment-orchestration-client-sdk type-check
pnpm --filter @northflow/payment-orchestration-service type-check
pnpm test
```

If scripts are added, also run the scripts in a safe dry-run/help mode if implemented:

```bash
pnpm s10:readiness --help
pnpm s10:smoke --help
```

or document why help mode is unavailable.

---

## Acceptance Criteria

S10.5 is complete only when:

- Deployment env contract doc exists.
- Deployment checklist exists.
- Runtime readiness script exists and masks secrets.
- Bootstrap smoke script exists and masks secrets.
- Operator bootstrap guide exists.
- Production redline checklist exists.
- Tests guard the docs/scripts/redlines.
- Provider codes remain unchanged.
- No route behavior changed unless clearly documented as a bug fix.
- No DB schema/migration change.
- No SDK public API breaking change.
- No inbound HMAC canonical request signing change.
- No outbound merchant webhook signature change.
- No dashboard implementation added.
- Type-check and tests pass, or failures are honestly documented.
- Validation report exists.

Commit and push all changes.
