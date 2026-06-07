# Replit/Codex Prompt - Phase S9.3 Network-Level Service Protection

You are working in the `northflow-payment-orchestration` repository.

S1-S5 service security is complete. S6-S7 client integration is complete. S7.5 payment method options is complete. S8 service audit log is complete. S9.1 API key rotation is complete. S9.2 rate limit and abuse protection is complete.

This prompt implements:

```txt
S9.3 — Network-Level Service Protection
```

Do not implement dashboard UI.
Do not implement provider webhook roadmap expansion.
Do not implement HMAC signed requests in this phase.
Do not implement mTLS/private-network certificate handling in code.
Do not weaken S1-S9.2 authentication, merchant access, sourceApp enforcement, scope authorization, payment methods, audit log, key rotation, or rate limiting.

---

# Goal

Protect the Northflow Payment Orchestration service from unnecessary public exposure.

S9.3 is the perimeter/security-ops layer for the service API.

The service already has application-level protection:

```txt
API client credentials
merchant isolation
scope authorization
sourceApp enforcement
payment method validation
audit logs
key rotation
rate limit
```

S9.3 adds network-level and HTTP hardening:

```txt
trusted proxy handling
strict CORS policy
security headers
request size limit policy
health/readiness exposure policy
unknown path handling
production docs/swagger disable policy
Cloudflare/origin firewall deployment checklist
```

---

# Part A - Documentation

Create:

```txt
docs/security/network-protection.md
```

The document must explain the recommended production network model for `northflow.space`.

## Required topics

### 1. Subdomain layout

Document a recommended layout like:

```txt
internal service API:
  <hard-to-guess-service-subdomain>.northflow.space

management dashboard:
  dashboard.northflow.space or console.northflow.space

provider webhooks:
  webhook.northflow.space
```

Explain clearly:

- hard-to-guess service subdomain reduces casual scanning only
- it is not a security boundary
- real security is API auth, rate limit, Cloudflare/proxy, origin firewall, and no direct public port

### 2. Cloudflare / reverse proxy model

Recommended flow:

```txt
consumer backend -> Cloudflare/proxy -> Northflow origin
```

Prohibit direct origin exposure:

```txt
attacker -> origin-ip:port
```

Document:

```txt
Cloudflare proxy ON
origin firewall allow Cloudflare IP ranges only
no direct public service port
HTTPS only
no public swagger/docs in production
```

### 3. Origin firewall checklist

Document VPS/firewall requirements:

```txt
allow inbound HTTP/HTTPS only from reverse proxy/Cloudflare or local gateway
block direct access to service port
block unknown exposed ports
restrict SSH separately
```

Do not hard-code Cloudflare IP ranges in the app. This belongs in infrastructure/firewall docs.

### 4. CORS policy

Explain that Northflow internal service API is backend-to-backend.

Consumer browser frontends must not call it directly.

Production CORS should be:

```txt
disabled by default or strict allowlist only
```

Allowed origins must be env-configurable if CORS is enabled.

### 5. Health/version/readiness policy

Document exposure rules:

```txt
/health can remain public and minimal if needed by platform
/version should not expose secrets/build internals
/ready should be protected or internal-only in production
```

If code protection for `/ready` is added, document the token/header or internal-only policy.

### 6. Request size and security headers

Document:

```txt
JSON body size limit
security headers
cache-control for API responses
content-type protections
x-powered-by disabled
```

### 7. Deployment checklist

Include a final checklist for Replit/Coolify/VPS/Nginx/Cloudflare style deployment.

---

# Part B - App-Level HTTP Hardening

Inspect current Express app setup.

Implement safe service-level hardening where it fits the codebase.

## B1 - Disable x-powered-by

Add:

```ts
app.disable('x-powered-by')
```

Acceptance:

- `X-Powered-By` is not present in HTTP responses.

## B2 - Security headers middleware

Add a small middleware or use a dependency already present in the repo if appropriate.

Do not add a heavy dependency unnecessarily.

Minimum headers:

```txt
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: no-referrer
Cache-Control: no-store
```

Optional if safe:

```txt
Cross-Origin-Resource-Policy: same-site
```

Do not set a CSP that breaks JSON APIs or health checks unless carefully tested.

Acceptance:

- protected API responses include the headers.
- health/version/ready responses should also include safe headers if middleware is global.

## B3 - CORS policy

Add explicit CORS behavior.

Preferred implementation without new dependency:

- If CORS is disabled, do not emit `Access-Control-Allow-Origin`.
- If enabled, allow only configured origins.
- Handle `OPTIONS` preflight for allowed origins.
- Reject disallowed origins or return no CORS headers consistently.

Suggested env vars:

```txt
PAYMENT_ORCHESTRATION_CORS_ENABLED=false
PAYMENT_ORCHESTRATION_CORS_ALLOWED_ORIGINS=https://console.northflow.space,https://dashboard.northflow.space
```

Rules:

- Production default should be disabled.
- Development may remain disabled unless explicitly enabled.
- Do not use wildcard `*` in production.
- Do not allow arbitrary Origin reflection.

Acceptance:

- no CORS header by default.
- allowed configured origin receives `Access-Control-Allow-Origin`.
- disallowed origin does not receive allow header.
- OPTIONS preflight works for allowed origin.

## B4 - Trusted proxy config

Add env-controlled trusted proxy configuration.

Suggested env:

```txt
PAYMENT_ORCHESTRATION_TRUST_PROXY=false
```

Support values:

```txt
false
true
loopback
linklocal
uniquelocal
```

or equivalent Express-supported values if the current codebase has a preferred config shape.

Acceptance:

- default does not trust arbitrary proxies.
- config can enable trusted proxy behind Cloudflare/Nginx.
- docs explain this must be paired with origin firewall/reverse proxy.

## B5 - Request size limit policy

Current JSON body limit may already exist. Verify and document it.

If needed, make it env-configurable:

```txt
PAYMENT_ORCHESTRATION_JSON_BODY_LIMIT=256kb
```

Rules:

- keep safe default around 256kb unless existing tests require otherwise.
- do not increase size unnecessarily.
- webhooks raw body capture must still work.

Acceptance:

- body limit is documented.
- oversized JSON returns expected 413 or Express body parser error response.

## B6 - Unknown path handling

Add clean 404 handler for unknown paths.

Response should preserve service error envelope style.

Expected error code:

```txt
NOT_FOUND
```

Acceptance:

- unknown `/v1/...` path returns structured 404.
- unknown non-`/v1` path returns structured 404 or minimal 404 consistently.
- no stack trace leaks in production.

## B7 - Ready endpoint protection policy

Inspect existing health/version/ready router.

Implement one of these options and document it:

Option 1 — route remains public but minimal:

```txt
/ready exposes no secrets and only safe readiness info
```

Option 2 — production protection:

```txt
PAYMENT_ORCHESTRATION_READY_TOKEN optional token
x-nf-ready-token: <token>
```

Preferred for production:

- if `PAYMENT_ORCHESTRATION_READY_TOKEN` is set, `/ready` requires it.
- if unset, keep current behavior but document that reverse proxy/origin firewall should restrict it.

Rules:

- do not expose DB URL, provider secrets, API keys, or raw environment config.
- do not break platform health checks unless token is explicitly configured.

Acceptance:

- `/ready` contains no secrets.
- token-protected mode works when env token is set.
- tests cover both public/default and protected mode if implemented.

---

# Part C - Configuration

Update service config loader:

```txt
apps/service/src/config/env.ts
```

Add only necessary env fields.

Recommended additions:

```txt
corsEnabled
corsAllowedOrigins
trustProxy
jsonBodyLimit
readyTokenConfigured or readyToken
```

Suggested env names:

```txt
PAYMENT_ORCHESTRATION_CORS_ENABLED
PAYMENT_ORCHESTRATION_CORS_ALLOWED_ORIGINS
PAYMENT_ORCHESTRATION_TRUST_PROXY
PAYMENT_ORCHESTRATION_JSON_BODY_LIMIT
PAYMENT_ORCHESTRATION_READY_TOKEN
```

Rules:

- do not log secrets.
- if storing ready token in config, never expose it in `/version`, `/ready`, logs, or audit metadata.
- validate unsafe configs in production, such as wildcard CORS if enabled.

---

# Part D - Tests

Add tests for S9.3.

Recommended test file:

```txt
tests/s9-3-network-level-service-protection.test.ts
```

Required tests:

## Security headers

```txt
X-Powered-By is absent
X-Content-Type-Options = nosniff
X-Frame-Options = DENY
Referrer-Policy = no-referrer
Cache-Control = no-store
```

## CORS

```txt
CORS disabled by default -> no Access-Control-Allow-Origin
CORS enabled + allowed origin -> returns allow header
CORS enabled + disallowed origin -> no allow header or blocked according to implementation
OPTIONS preflight works for allowed origin
wildcard origin is not allowed in production if you implement validation
```

## Trusted proxy config

```txt
trust proxy default is disabled
trust proxy can be enabled/configured from env
```

## Request limit / body parser

```txt
oversized JSON returns 413 or structured error
normal JSON still works
```

## Ready protection

```txt
/ready exposes no secrets
/ready protected mode rejects missing/wrong token if token configured
/ready protected mode accepts correct token if token configured
```

## Unknown paths

```txt
unknown /v1 route returns structured 404 NOT_FOUND
unknown non-v1 route does not expose stack traces
```

---

# Part E - Documentation Updates

Update:

```txt
roadmap/service/main.md
```

Mark S9.3 as implemented only after this phase is actually implemented.

Add/confirm future sequence remains:

```txt
S9.4 — Signed Requests / HMAC
S9.5 — mTLS / Private Network
```

Do not reintroduce old S9 numbering conflicts.

---

# Part F - Validation Report

Create:

```txt
.agents/memory/s9-3-network-level-service-protection-validation.md
```

Must include:

```txt
timestamp
git commit checked
files changed
commands run
pass/fail/skipped results
known pre-existing failures
remaining issues
security headers result
CORS behavior result
trusted proxy result
ready endpoint result
unknown path result
deployment checklist status
```

Run:

```bash
pnpm type-check
pnpm test
```

Also run service-specific check if root workspace is noisy:

```bash
pnpm --filter @northflow/payment-orchestration-service type-check
```

No DB migration is expected for S9.3. If you add a migration, explain why.

Do not fake validation results. If a command cannot run, document the exact reason.

---

# Implementation Rules

1. Do not weaken existing auth, scope, merchant access, rate limit, or audit behavior.
2. Do not expose secrets in health/version/ready responses.
3. Do not reflect arbitrary CORS origins.
4. Do not use wildcard CORS in production.
5. Do not trust arbitrary proxies by default.
6. Do not increase JSON body size unnecessarily.
7. Do not break provider webhook raw body capture.
8. Do not add dashboard-specific auth/RBAC.
9. Do not implement HMAC in this phase.
10. Do not implement mTLS certificate handling in this phase.
11. Keep docs practical for Cloudflare/Nginx/VPS/Coolify/Replit deployments.

---

# Expected Final State

After S9.3:

```txt
docs/security/network-protection.md exists
x-powered-by is disabled
safe security headers are applied
CORS is explicit and disabled/strict by default
trusted proxy is configurable and disabled by default
request body limit is documented/configurable
/ready exposure policy is implemented and documented
unknown paths return clean structured 404
Cloudflare/origin firewall checklist is documented
S9.3 tests pass
validation report is committed
```

Commit and push all changes.
