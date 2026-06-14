# Staging Smoke Commands Reference

Quick-reference for all commands used during staging validation.
For the full procedure, see `staging-runtime-smoke-runbook.md`.

---

## Readiness check (read-only, no data created)

```bash
NORTHFLOW_BASE_URL=https://staging.your-domain.example.com \
NORTHFLOW_READY_TOKEN=<ready-token> \
NORTHFLOW_API_KEY=nf.staging.<cred>.<secret> \
NORTHFLOW_MERCHANT_ID=mer_xxx \
pnpm s10:readiness
```

Or with `--help`:
```bash
pnpm s10:readiness -- --help
# (or directly): npx tsx scripts/s10-5-runtime-readiness-check.ts --help
```

**Expected:** All `PASS` or `SKIP`. Exit code 0.

---

## Bootstrap smoke (creates data in staging)

```bash
NORTHFLOW_BASE_URL=https://staging.your-domain.example.com \
NORTHFLOW_API_KEY=nf.staging.<cred>.<secret> \
NORTHFLOW_SOURCE_APP=aura_pos \
NORTHFLOW_SMOKE_MERCHANT_NAME="Staging Smoke $(date +%Y%m%d-%H%M)" \
NORTHFLOW_SMOKE_EXTERNAL_REF="staging_$(date +%s)" \
NORTHFLOW_SMOKE_PROVIDER=fake_gateway \
NORTHFLOW_SMOKE_METHOD=qris \
NORTHFLOW_SMOKE_CURRENCY=IDR \
NORTHFLOW_SMOKE_AMOUNT=10000 \
pnpm s10:smoke
```

**Expected:** `FAIL: 0`. SKIP acceptable for audit log, webhook, refund/void. Exit code 0.

---

## Manual health probes

```bash
BASE=https://staging.your-domain.example.com
KEY=nf.staging.<cred>.<secret>

# Health — no auth required
curl -s "$BASE/health" | python3 -m json.tool

# Version — no auth required
curl -s "$BASE/version" | python3 -m json.tool

# Readiness — token required if configured
curl -s -H "x-nf-ready-token: $READY_TOKEN" "$BASE/ready" | python3 -m json.tool
```

---

## Manual auth guard checks

```bash
# Missing key → expect 401
curl -s -o /dev/null -w "Status: %{http_code}\n" "$BASE/v1/merchants/mer_any"

# Valid key, wrong scope → expect 403
curl -s -o /dev/null -w "Status: %{http_code}\n" \
  -H "Authorization: Bearer $KEY_WITH_NO_SCOPES" \
  -H "x-payment-merchant-id: $MER_ID" \
  "$BASE/v1/payment-intents"

# Valid key, valid scope, valid merchant → expect 200 or 404
curl -s \
  -H "Authorization: Bearer $KEY" \
  -H "x-payment-merchant-id: $MER_ID" \
  "$BASE/v1/merchants/$MER_ID" | python3 -m json.tool
```

---

## Dev route check (should be 404 in production-mode staging)

```bash
# Should return 404 if NODE_ENV=production
curl -s -o /dev/null -w "Status: %{http_code}\n" \
  -X POST \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{}' \
  "$BASE/v1/dev/fake-gateway/transactions/probe/confirm"
```

---

## Audit log check

```bash
# Requires audit_log:read scope
curl -s \
  -H "Authorization: Bearer $KEY" \
  "$BASE/v1/audit-logs?limit=5" | python3 -m json.tool
# Expect: { ok: true, data: { entries: [...], total: N, limit: 5, offset: 0 } }
```

---

## CI integration pattern

Add to CI pipeline after deploy step:

```yaml
- name: Staging readiness check
  env:
    NORTHFLOW_BASE_URL: ${{ secrets.STAGING_BASE_URL }}
    NORTHFLOW_READY_TOKEN: ${{ secrets.STAGING_READY_TOKEN }}
    NORTHFLOW_API_KEY: ${{ secrets.STAGING_API_KEY }}
    NORTHFLOW_MERCHANT_ID: ${{ secrets.STAGING_MERCHANT_ID }}
  run: pnpm s10:readiness

- name: Staging smoke test
  env:
    NORTHFLOW_BASE_URL: ${{ secrets.STAGING_BASE_URL }}
    NORTHFLOW_API_KEY: ${{ secrets.STAGING_API_KEY }}
    NORTHFLOW_SOURCE_APP: smoke-ci
    NORTHFLOW_SMOKE_EXTERNAL_REF: smoke_ci_${{ github.run_id }}
    NORTHFLOW_SMOKE_PROVIDER: fake_gateway
    NORTHFLOW_SMOKE_AMOUNT: "10000"
  run: pnpm s10:smoke
```

---

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | All required checks passed (SKIP is OK) |
| 1 | One or more required checks FAILED |

---

## SKIP policy

| Check | Acceptable SKIP reason |
|-------|------------------------|
| `audit log` | Credential missing `audit_log:read` scope |
| `webhook` | `NORTHFLOW_SMOKE_WEBHOOK_URL` not set |
| `fake confirm` | `NODE_ENV=production` — dev route absent (expected) |
| `refund/void` | Transaction not in refundable/voidable state at test time |
| `provider account` | Blocked by earlier merchant FAIL — cascading |

| Check | Must PASS — SKIP is a failure |
|-------|-------------------------------|
| `readiness` | Service must be reachable and healthy |
| `merchant` | Create must succeed — auth + DB must work |
| `intent` | Payment intent creation must succeed |
| `gateway payment` | Gateway payment must succeed |
| `status` | Status read must succeed and return `intent.status` |
