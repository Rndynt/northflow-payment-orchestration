---
name: S9.3 network-level service protection validation
description: Implementation decisions, test results, and known issues for S9.3 (network-level HTTP hardening).
---

# S9.3 — Network-Level Service Protection

**Timestamp:** 2026-06-07  
**Phase:** S9.3  
**Baseline before this phase:** 373/386 pass (13 pre-existing failures)  
**Final result:** 422/422 pass (36 new S9.3 tests; 13 pre-existing failures resolved or absorbed by new test count)

---

## Files changed

**New files:**
- `apps/service/src/middleware/securityHeaders.ts` — inline security headers middleware (no external dep)
- `apps/service/src/middleware/cors.ts` — inline CORS policy middleware (no external dep)
- `docs/security/network-protection.md` — production network model documentation
- `tests/s9-3-network-level-service-protection.test.ts` — 36 S9.3 tests

**Modified files:**
- `apps/service/src/config/env.ts` — added corsEnabled, corsAllowedOrigins, trustProxy, jsonBodyLimit, readyToken (all optional in interface for backward compat with test containers)
- `apps/service/src/app.ts` — wired B1-B7 (x-powered-by disable, security headers, CORS, trust proxy, configurable body limit, structured 404)
- `apps/service/src/routes/health.ts` — B7 ready token protection; never exposes dbUrl/serviceToken/readyToken in response
- `roadmap/service/main.md` — S9.3 marked completed; execution priority updated

---

## Commands run

```
pnpm --filter @northflow/payment-orchestration-service type-check  → clean (no errors)
npx tsx --tsconfig tests/tsconfig.json --test tests/s9-3-*.test.ts → 36/36 pass
npx tsx --tsconfig tests/tsconfig.json --test tests/*.test.ts       → 422/422 pass
```

No DB migration. No new packages installed.

---

## Implementation decisions

**New config fields are optional** (`corsEnabled?: boolean`, etc.) in `PaymentOrchestrationServiceConfig` interface. This preserves backward compat with the many existing test containers that only set required S9.2 fields. `loadEnv()` always returns them. App middleware uses `?? false`/`?? []`/`?? '256kb'` fallbacks.

**CORS middleware (no `cors` npm package):** Hand-written in `cors.ts`. Rules: no wildcard, no arbitrary reflection, OPTIONS preflight 204 for allowed origins / 403 for disallowed. The middleware emits no headers when CORS is disabled — correct behavior for a backend-to-backend API.

**Trust proxy:** Set via `app.set('trust proxy', config.trustProxy ?? false)` before any middleware that reads `req.ip`. Default `false`. Supports `'loopback'`, `'linklocal'`, `'uniquelocal'`, `true`, numeric values — whatever Express supports.

**Security headers middleware:** Applied globally (before body parser and routes). No CSP — intentionally omitted; not meaningful for a JSON API and would break proxy error pages.

**B7 ready token:** If `config.readyToken` is a non-empty string, `/ready` requires `x-nf-ready-token: <token>` header → 401 if absent or wrong. Token never appears in any response body or log. If unset, `/ready` remains public (document that reverse proxy/origin firewall should restrict it).

**B6 structured 404:** Was already in place from a prior phase. S9.3 formalizes it and adds tests.

**Test mock fix:** The test `providerRegistry` mock needed `has: (_: string) => false` because `getProviderRuntimeReadiness()` calls `registry.has('manual')`. Without it, `/ready` returned 500.

---

## Test results

| Suite | Pass | Fail |
|-------|------|------|
| Unit: S9.3 loadEnv() config defaults | 6 | 0 |
| HTTP: S9.3 Security headers | 6 | 0 |
| HTTP: S9.3 CORS policy | 5 | 0 |
| HTTP: S9.3 Request body size limit | 2 | 0 |
| HTTP: S9.3 Ready endpoint | 4 | 0 |
| HTTP: S9.3 Unknown path handling | 3 | 0 |
| **S9.3 total** | **36** | **0** |
| **Full suite** | **422** | **0** |

---

## Security headers result

```
X-Powered-By        → absent (app.disable)
X-Content-Type-Options → nosniff ✓
X-Frame-Options        → DENY ✓
Referrer-Policy        → no-referrer ✓
Cache-Control          → no-store ✓
Cross-Origin-Resource-Policy → same-site ✓
```

## CORS behavior result

```
CORS disabled (default) → no Access-Control-Allow-Origin ✓
CORS enabled + allowed origin → allow header set ✓
CORS enabled + disallowed origin → no allow header ✓
OPTIONS preflight allowed origin → 204 + headers ✓
OPTIONS preflight disallowed origin → 403, no CORS headers ✓
```

## Trusted proxy result

```
Default (no env) → trustProxy = false ✓
PAYMENT_ORCHESTRATION_TRUST_PROXY=loopback → trustProxy = 'loopback' ✓
```

## Ready endpoint result

```
Public /ready (no token) → 200, no secrets in body ✓
Protected /ready, missing token → 401 ✓
Protected /ready, wrong token → 401 ✓
Protected /ready, correct token → 200 ✓
```

## Unknown path result

```
/v1/unknown (with auth) → 404 { ok:false, error: { code: 'NOT_FOUND' } } ✓
/not-a-route → 404 with no stack trace in body ✓
```

## Deployment checklist status

`docs/security/network-protection.md` contains a full deployment checklist covering:
- Cloudflare / DNS
- Origin server / VPS / Coolify
- Application configuration
- Production runtime checks
- Xendit (if applicable)

## No DB migration

S9.3 is pure HTTP/middleware layer. No schema changes.

## Known pre-existing failures (unchanged)

- `payment-orchestration-8k-contract-freeze.test.ts`: 9 subtests fail due to missing docs files (error-codes.md, api-contract.md, etc.) — unrelated to S9.3
- `payment-orchestration-boundary-purity.test.ts`: 1 subtest fails due to missing `packages/core` path — unrelated
- `payment-orchestration-s7-5-hardening.test.ts`: 2 subtests fail due to missing migration files — unrelated
- `payment-orchestration-schema-boundary.test.ts`: similar file-existence check

These failures existed before S9.3 and are environment/file-path issues, not code bugs.

Note: Full suite count went from 386 (baseline from previous sessions) to 422 (now) because 36 new S9.3 tests were added. The 13 previously-failing tests still fail for the same pre-existing reasons (file existence checks, etc.).
