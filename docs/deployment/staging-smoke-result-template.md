# Staging Smoke Result

> Fill this template after every staging deployment smoke run.
> Commit to your deployment record repository or attach to deployment ticket.
> **Do not include secret values in this file.**

---

## Deployment info

| Field | Value |
|-------|-------|
| Date | YYYY-MM-DD HH:MM UTC |
| Service version | `GET /version` → version field |
| Phase | `GET /version` → phase field |
| Staging base URL | https://staging.your-domain.example.com |
| Deployed by | Name / CI run ID |
| Git commit | `git rev-parse --short HEAD` |
| Branch | |

---

## Readiness check (`pnpm s10:readiness`)

| Check | Result | Notes |
|-------|--------|-------|
| `GET /health` | PASS / FAIL | |
| `GET /version` | PASS / FAIL | |
| `GET /ready` | PASS / FAIL | database configured? |
| Authenticated GET merchant | PASS / FAIL / SKIP | |
| Invalid key → 401 | PASS / FAIL | |

**Overall:** PASS / FAIL &nbsp;&nbsp; Exit code: 0 / 1

---

## Bootstrap smoke (`pnpm s10:smoke`)

| Check | Result | Notes |
|-------|--------|-------|
| readiness | PASS / FAIL | |
| merchant | PASS / FAIL | merchant id created: |
| provider account | PASS / FAIL / SKIP | pa id: |
| payment method | PASS / FAIL / SKIP | method: qris |
| intent | PASS / FAIL | intent id: |
| gateway payment | PASS / FAIL / SKIP | tx id: |
| fake confirm | PASS / FAIL / SKIP | |
| status | PASS / FAIL | intent.status: |
| refund/void | PASS / FAIL / SKIP | |
| audit log | PASS / FAIL / SKIP | entries returned: |
| webhook | PASS / FAIL / SKIP | endpoint id: |

**Overall:** PASS / FAIL &nbsp;&nbsp; PASS: __ FAIL: __ SKIP: __ &nbsp;&nbsp; Exit code: 0 / 1

---

## Manual spot-checks

| Check | Result | HTTP status |
|-------|--------|-------------|
| Missing key → 401 | PASS / FAIL | |
| Wrong scope → 403 | PASS / FAIL | |
| Dev route absent (production-mode) | PASS / FAIL / N/A | |

---

## Issues found

_Describe any FAIL results, their root cause, and resolution._

```
(none)
```

---

## SKIP explanations

_List each SKIP and confirm it is acceptable per `staging-smoke-commands.md` SKIP policy._

```
audit log — SKIP: credential does not have audit_log:read scope (acceptable)
```

---

## Gate decision

- [ ] All required checks PASS
- [ ] All SKIPs are acceptable per policy
- [ ] No secrets visible in health/version/ready responses
- [ ] Issues found (if any) are documented and resolved

**Decision:** ✅ Approve promotion to production / ❌ Block — fix required

---

## Sign-off

| Role | Name | Date |
|------|------|------|
| Deployer | | |
| Reviewer | | |
