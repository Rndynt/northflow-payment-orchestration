# Production Redline Checklist

**Real production traffic is blocked until every item below is checked.**

Any unchecked item is a production blocker. Do not route live merchant traffic to Northflow
until all redlines pass.

---

## Runtime readiness

- [ ] `GET /health` → `{ ok: true }` with HTTP 200
- [ ] `GET /version` → returns service name, version, phase
- [ ] `GET /ready` → `{ ok: true, database: "configured" }` with HTTP 200
  - [ ] `/ready` is either token-protected (`PAYMENT_ORCHESTRATION_READY_TOKEN` is set) or blocked at reverse proxy

---

## Migrations

- [ ] `pnpm db:migrate` completed without errors on the production database
- [ ] All 10 migration files applied (0000 through 0010)
- [ ] Database connection confirmed via `/ready` → `database: "configured"`

---

## Authentication

- [ ] `PAYMENT_ORCHESTRATION_LEGACY_SERVICE_TOKEN_ENABLED=false` in production
- [ ] API key auth working: valid credential → 200 on protected route
- [ ] Invalid / expired / revoked key → `401 UNAUTHORIZED`
- [ ] `PAYMENT_ORCHESTRATION_SIGNED_REQUESTS_MODE=required` in production (or `optional` with documented exception)
- [ ] Signed request verification working end-to-end

---

## Authorization guards

- [ ] Merchant access guard working: credential not granted access → `403 MERCHANT_ACCESS_DENIED`
- [ ] Scope guard working: credential missing scope → `403 SCOPE_DENIED`
- [ ] SourceApp mismatch rejected: `403 SOURCE_APP_MISMATCH` when sourceApp in body ≠ credential's registered sourceApp

---

## Provider codes (must be unchanged)

- [ ] `manual` provider code present and unchanged
- [ ] `fake_gateway` provider code present and unchanged (dev/test only)
- [ ] `xendit_sandbox` provider code present and unchanged
- [ ] No new production PSP credentials connected before sandbox smoke test passes

---

## Smoke test

- [ ] `pnpm s10:smoke` passed in sandbox/staging with `fake_gateway`
- [ ] Full payment flow (create intent → gateway payment → confirm → status) verified
- [ ] Refund or void tested where applicable
- [ ] Audit log entries written for all above actions

---

## Audit logs

- [ ] Audit log writes confirmed: `GET /v1/audit-logs` returns entries for smoke test actions
- [ ] Audit logs do not include raw secrets, tokens, or provider credentials
- [ ] `Authorization` header value not logged anywhere

---

## Rate limiting

- [ ] `PAYMENT_ORCHESTRATION_RATE_LIMIT_ENABLED=true` in production (or documented exception)
- [ ] Rate limit headers visible in responses (`X-RateLimit-*` or `Retry-After`)
- [ ] Auth failure rate limit active (`PAYMENT_ORCHESTRATION_RATE_LIMIT_AUTH_FAILURE_PER_MINUTE=30`)

---

## CORS and network

- [ ] `PAYMENT_ORCHESTRATION_CORS_ENABLED=false` in production
- [ ] Service port (default 3000) NOT directly accessible from the public internet — only via reverse proxy
- [ ] `PAYMENT_ORCHESTRATION_TRUST_PROXY` set correctly to match proxy topology (not `false` if behind Nginx/Cloudflare)
- [ ] Origin firewall / IP allowlist configured at reverse proxy: only consumer app servers can reach Northflow
- [ ] `/v1/dev/fake-gateway/*` routes return 404 in `NODE_ENV=production`

---

## Docs / swagger exposure

- [ ] No OpenAPI / Swagger UI exposed publicly in production without authentication
- [ ] `docs/` directory not served by the application in production

---

## Secret leak check

- [ ] `GET /health` response contains no secrets
- [ ] `GET /version` response contains no secrets
- [ ] `GET /ready` response contains no secrets (only `database: "configured/unconfigured"`, provider flags)
- [ ] Application logs contain no `DATABASE_URL`, API keys, raw secrets, or tokens
- [ ] No credential values visible in environment variable dumps or deployment configs committed to source control

---

## Rollback plan

- [ ] Previous known-good commit tag or container image identified and documented
- [ ] Rollback procedure tested in staging: redeploy previous version
- [ ] DB rollback snapshot available if schema changes are included
- [ ] Consumer app team notified of rollback plan

---

## Explicit production redlines (hard stops)

These must never be true in production:

```
❌ Do not allow browser/frontend direct access to Northflow service API.
   Northflow is backend-to-backend only. CORS must remain disabled.

❌ Do not use the global legacy service token in production.
   PAYMENT_ORCHESTRATION_LEGACY_SERVICE_TOKEN_ENABLED must be false.

❌ Do not connect real PSP production credentials before smoke test passes in sandbox.
   Use fake_gateway or xendit_sandbox in all pre-production testing.

❌ Do not onboard real merchant production traffic before API key auth,
   merchant access guard, sourceApp, scope, and audit checks all pass.

❌ Do not expose the OpenAPI/Swagger docs publicly in production without authentication.

❌ Do not commit DATABASE_URL, API keys, raw credentials, webhook secrets,
   or provider tokens to source control.

❌ Do not run migrations in production before verifying they passed in staging.
```

---

## Sign-off

| Check | Owner | Status | Date |
|-------|-------|--------|------|
| Migrations applied | | | |
| Legacy token disabled | | | |
| Auth end-to-end | | | |
| Merchant access guard | | | |
| Scope guard | | | |
| Smoke test passed | | | |
| Audit logs confirmed | | | |
| Rate limit enabled | | | |
| CORS disabled | | | |
| No secret leaks | | | |
| Rollback plan documented | | | |
