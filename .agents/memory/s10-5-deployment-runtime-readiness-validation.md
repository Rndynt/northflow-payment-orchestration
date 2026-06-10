# S10.5 — Deployment Runtime Readiness + Bootstrap Smoke Test Validation

**Branch:** `feat/s10-5-deployment-runtime-readiness`
**Prompt:** `roadmap/service/claude-s10-5-deployment-runtime-readiness-bootstrap-smoke-test-prompt.md`
**Date:** 2026-06-10

---

## Files Created

| File | Purpose |
|------|---------|
| `docs/deployment/runtime-environment.md` | All env vars, defaults, secret redline policy, full .env template |
| `docs/deployment/deployment-checklist.md` | Per-target deploy checklists (local, Replit, VPS+Nginx, Coolify, Docker, Cloudflare), universal post-deploy checks, rollback checklist |
| `docs/deployment/bootstrap-operator-guide.md` | 12-step bootstrap order: migrations → client → credential → merchant → grant → PA → methods → webhook → readiness → smoke → go-live |
| `docs/deployment/production-redline-checklist.md` | Hard-stop pre-production checklist + explicit redlines |
| `scripts/s10-5-runtime-readiness-check.ts` | Read-only post-deploy probe: /health, /version, /ready, authenticated GET, invalid-key rejection. Masks secrets. `pnpm s10:readiness` |
| `scripts/s10-5-bootstrap-smoke.ts` | Full fake_gateway payment flow: merchant → PA → method → intent → gateway payment → confirm → status → refund/void → audit log → webhook. `pnpm s10:smoke` |
| `tests/s10-5-deployment-runtime-readiness.test.ts` | 85 static assertions (T01–T09) verifying all artifacts |
| `package.json` (modified) | +`s10:readiness`, +`s10:smoke` scripts |
| `.agents/memory/s10-5-deployment-runtime-readiness-validation.md` | This file |

---

## Env Vars Documented (sourced from `apps/service/src/config/env.ts`)

Boot: `DATABASE_URL`, `NODE_ENV`, `PORT`
Auth: `PAYMENT_ORCHESTRATION_LEGACY_SERVICE_TOKEN_ENABLED`, `PAYMENT_ORCHESTRATION_SERVICE_TOKEN`
HMAC: `PAYMENT_ORCHESTRATION_SIGNED_REQUESTS_MODE`, `_MAX_SKEW_SECONDS`, `_NONCE_TTL_SECONDS`
Rate: `PAYMENT_ORCHESTRATION_RATE_LIMIT_ENABLED`, `_CLIENT_GLOBAL_PER_MINUTE`, `_CLIENT_ROUTE_PER_MINUTE`, `_AUTH_FAILURE_PER_MINUTE`
CORS: `PAYMENT_ORCHESTRATION_CORS_ENABLED`, `_CORS_ALLOWED_ORIGINS`
Network: `PAYMENT_ORCHESTRATION_TRUST_PROXY`, `_JSON_BODY_LIMIT`, `_READY_TOKEN`
Xendit: `PAYMENT_ORCHESTRATION_XENDIT_SANDBOX_ENABLED`, `_XENDIT_BASE_URL`, `_XENDIT_CALLBACK_TOKEN`
Webhooks: `PAYMENT_ORCHESTRATION_OUTBOUND_WEBHOOKS_ENABLED`, `_TIMEOUT_MS`, `_MAX_ATTEMPTS`, `_RESPONSE_BODY_LIMIT`

---

## Invariants Confirmed

- No route/middleware/domain/schema changed
- Provider codes unchanged: `fake_gateway`, `xendit_sandbox`, `manual`
- No dashboard changes
- No new payment features
- Dev fake-gateway route still gated by `nodeEnv !== 'production'`
- Scripts mask secrets — no raw key printing

## Test Results

```
pnpm type-check  →  ✅ clean (core, client-sdk, service)
pnpm test        →  ✅ 690/690 pass, 0 fail (was 605)
```
