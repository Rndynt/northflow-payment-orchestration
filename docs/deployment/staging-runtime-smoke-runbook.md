# Staging Runtime Smoke Runbook

**Phase:** S10.6 — Staging Deployment + Runtime Smoke Validation
**Purpose:** Step-by-step procedure for validating a staging deployment of `northflow-payment-orchestration` before promoting to production.

> This runbook assumes the service is already deployed and accessible. If not, follow `deployment-checklist.md` first.

---

## Prerequisites

- [ ] Staging service deployed and running (see `deployment-checklist.md`)
- [ ] `NORTHFLOW_BASE_URL` pointing to staging service
- [ ] A valid staging API credential (`NORTHFLOW_API_KEY=nf.staging.cred_xxx.<secret>`)
- [ ] A test merchant ID or permission to create one (`NORTHFLOW_MERCHANT_ID` or `merchant:create` scope)
- [ ] Database migrations applied (`pnpm db:migrate`)
- [ ] Node.js 20+ and pnpm installed locally (or run from CI)

---

## Step 1 — Confirm staging env vars are set

```bash
# Verify (values are not shown — just check they are set)
echo "BASE_URL: $NORTHFLOW_BASE_URL"
echo "API_KEY set: $([ -n "$NORTHFLOW_API_KEY" ] && echo YES || echo NO)"
echo "SOURCE_APP: ${NORTHFLOW_SOURCE_APP:-smoke-test}"
```

Copy `docs/deployment/staging-env-template.md` and fill all required values before proceeding.

---

## Step 2 — Run readiness check (read-only)

```bash
NORTHFLOW_BASE_URL=$NORTHFLOW_BASE_URL \
NORTHFLOW_READY_TOKEN=$NORTHFLOW_READY_TOKEN \
NORTHFLOW_API_KEY=$NORTHFLOW_API_KEY \
NORTHFLOW_MERCHANT_ID=$NORTHFLOW_MERCHANT_ID \
pnpm s10:readiness
```

**Expected:** All checks `PASS` or `SKIP`. No `FAIL`.

Checks performed:
1. `GET /health` → `{ ok: true, service: "payment-orchestration-service" }`
2. `GET /version` → returns version + phase fields
3. `GET /ready` → `{ ok: true, database: "configured" }`
4. `GET /v1/merchants/{id}` with valid key → 200
5. Invalid key → 401 UNAUTHORIZED

If any check fails, **stop here** — do not proceed to smoke test until fixed.

---

## Step 3 — Run bootstrap smoke (creates data)

> ⚠️ This step creates real data in staging. Use a unique `SMOKE_EXTERNAL_REF` each run.

```bash
NORTHFLOW_BASE_URL=$NORTHFLOW_BASE_URL \
NORTHFLOW_API_KEY=$NORTHFLOW_API_KEY \
NORTHFLOW_SOURCE_APP=${NORTHFLOW_SOURCE_APP:-smoke-test} \
NORTHFLOW_SMOKE_MERCHANT_NAME="Staging Smoke $(date +%Y%m%d-%H%M)" \
NORTHFLOW_SMOKE_EXTERNAL_REF="staging_smoke_$(date +%s)" \
NORTHFLOW_SMOKE_PROVIDER=fake_gateway \
NORTHFLOW_SMOKE_METHOD=qris \
NORTHFLOW_SMOKE_CURRENCY=IDR \
NORTHFLOW_SMOKE_AMOUNT=10000 \
pnpm s10:smoke
```

**Expected output:** Summary with `FAIL: 0`. SKIP is acceptable for:
- `audit log` — if credential lacks `audit_log:read` scope
- `webhook` — if `NORTHFLOW_SMOKE_WEBHOOK_URL` not set
- `fake confirm` — if `NODE_ENV=production` (dev route absent — expected in production-like staging)
- `refund/void` — if transaction is not yet in a refundable/voidable state

**Not acceptable as SKIP:**
- `readiness` — must PASS
- `merchant` — must PASS
- `intent` — must PASS
- `gateway payment` — must PASS
- `status` — must PASS

---

## Step 4 — Verify auth guards (manual spot-check)

```bash
# Missing key → 401
curl -s -o /dev/null -w "%{http_code}" "$NORTHFLOW_BASE_URL/v1/merchants/mer_any" | grep 401

# Wrong scope → 403
# (Create a credential with no scopes and attempt a scoped call)
```

---

## Step 5 — Record result

Fill in `docs/deployment/staging-smoke-result-template.md` and commit the result file to your deployment record repository (or attach to your deployment ticket).

---

## Step 6 — Gate check before production promotion

All of the following must be true before promoting staging to production:

- [ ] `pnpm s10:readiness` — 0 FAIL
- [ ] `pnpm s10:smoke` — 0 FAIL (SKIP acceptable per above policy)
- [ ] Auth guards confirmed (401 on missing key, 403 on wrong scope)
- [ ] `/v1/dev/fake-gateway/*` returns 404 (if staging is production-mode)
- [ ] No secrets visible in `/health`, `/version`, `/ready` responses
- [ ] Staging result filled in `staging-smoke-result-template.md`
- [ ] Result reviewed and signed off by a second engineer

---

## Rollback trigger

If any required smoke check FAILs:

1. Do **not** promote to production.
2. Identify root cause from FAIL detail in smoke output.
3. Fix, redeploy staging, rerun this runbook from Step 1.
4. If urgent production fix is needed, use the last known-good commit tag.
