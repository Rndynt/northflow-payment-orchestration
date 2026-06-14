# S10.6 — Staging Deployment Runtime Smoke Validation

**Branch:** `feat/s10-6-staging-deployment-smoke-validation`
**Prompt:** `roadmap/service/claude-s10-6-staging-deployment-runtime-smoke-validation-prompt.md`
**Date:** 2026-06-11

---

## Files Created / Modified

| File | Change |
|------|--------|
| `docs/deployment/staging-runtime-smoke-runbook.md` | New — step-by-step staging validation runbook |
| `docs/deployment/staging-env-template.md` | New — all env vars for staging deployment + smoke scripts |
| `docs/deployment/staging-smoke-commands.md` | New — quick-reference command guide + SKIP policy + CI integration |
| `docs/deployment/staging-smoke-result-template.md` | New — fillable result template for deployment records |
| `tests/s10-6-staging-deployment-smoke-validation.test.ts` | New — 59 static assertions (T01–T09) |
| `tests/s10-5-1-smoke-runtime-contract-fix.test.ts` | Fixed pre-existing failing assertions (F2b, F3b.1–F3b.4) |

---

## S10.6 Artifact Summary

### Task A — Staging runbook (`staging-runtime-smoke-runbook.md`)
6-step procedure: env check → readiness → smoke → auth spot-check → result recording → gate decision.
Includes rollback trigger, SKIP policy, must-PASS requirements.

### Task B — Staging env template (`staging-env-template.md`)
All actual env vars from `apps/service/src/config/env.ts`:
`DATABASE_URL`, `NODE_ENV`, `PORT`, `PAYMENT_ORCHESTRATION_LEGACY_SERVICE_TOKEN_ENABLED`,
`PAYMENT_ORCHESTRATION_SIGNED_REQUESTS_MODE`, `PAYMENT_ORCHESTRATION_RATE_LIMIT_*`,
`PAYMENT_ORCHESTRATION_CORS_ENABLED`, `PAYMENT_ORCHESTRATION_TRUST_PROXY`,
`PAYMENT_ORCHESTRATION_READY_TOKEN`, `PAYMENT_ORCHESTRATION_XENDIT_*`,
`PAYMENT_ORCHESTRATION_OUTBOUND_WEBHOOKS_*`. Staging vs production difference table included.
Placeholder syntax used for all secret values (no hardcoded credentials).

### Task C — Smoke commands reference (`staging-smoke-commands.md`)
`pnpm s10:readiness` and `pnpm s10:smoke` with all env vars, manual curl probes,
auth guard checks (401/403), dev route check, audit log check, CI YAML pattern,
exit code table, SKIP/must-PASS policy tables.

### Task D — Smoke result template (`staging-smoke-result-template.md`)
Fillable template: deployment info, readiness result table, smoke result table (all 11 checks),
manual spot-checks, issue tracking, SKIP explanations, gate decision, sign-off rows.
Note: "Do not include secret values in this file."

### Task E — Tests (`s10-6-staging-deployment-smoke-validation.test.ts`)
59 assertions across 9 describe groups:
- T01 (8): staging runbook
- T02 (6): env template correctness + no hardcoded secrets
- T03 (9): smoke commands reference
- T04 (8): result template completeness
- T05 (7): smoke script S10.5.1 contract correctness (PUT, intent.status, refundability, audit log, tx.id, IIFE)
- T06 (4): package scripts
- T07 (8): all 8 deployment docs exist
- T08 (4): no forbidden content
- T09 (4): provider codes unchanged

### Pre-existing test fix
`tests/s10-5-1-smoke-runtime-contract-fix.test.ts` F2b and F3b.1–F3b.4 assertions
were using step-comment markers (`// ── Step N:`) that don't exist in the main branch
smoke script format. Fixed to match actual smoke script patterns.

---

## Results

```
pnpm type-check (core, client-sdk, service)  → ✅ clean
pnpm test                                     → ✅ 789/789 pass, 0 fail (was 730)
pnpm s10:readiness --help                     → ✅ works
pnpm s10:smoke --help                         → ✅ works
```

## Note: No live staging run

Per prompt: "No live staging environment is required for this phase."
The S10.6 work is documentation, runbook, and static test coverage.
Actual live staging execution must be performed by the operator using this runbook.

## Invariants Confirmed
- No service routes changed
- No DB/schema changes
- Provider codes unchanged: `fake_gateway`, `xendit_sandbox`, `manual`
- No dashboard implementation
- No new payment features
