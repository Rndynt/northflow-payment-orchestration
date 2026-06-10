# Runtime Environment Reference

All environment variables consumed by `northflow-payment-orchestration` service.
Values are sourced from `apps/service/src/config/env.ts` — the single authoritative config loader.

---

## Boot-required variables

The service will start with missing values below, but payment processing will fail at runtime.

| Variable | Alias | Default | Required for | Notes |
|----------|-------|---------|--------------|-------|
| `DATABASE_URL` | `PAYMENT_ORCHESTRATION_DATABASE_URL` | — | DB access | PostgreSQL connection string. **Backend secret.** |
| `NODE_ENV` | — | `development` | Environment mode | `production` disables dev routes and flips legacy token default to `false` |
| `PORT` | `PAYMENT_ORCHESTRATION_SERVICE_PORT`, `PAYMENT_ENGINE_SERVICE_PORT` | `3000` | HTTP listener | First non-empty value wins |

---

## Authentication

| Variable | Default | Notes |
|----------|---------|-------|
| `PAYMENT_ORCHESTRATION_LEGACY_SERVICE_TOKEN_ENABLED` | `true` in non-prod, `false` in production | **Must be `false` in production.** Enables the global service token bypass for dev/migration only |
| `PAYMENT_ORCHESTRATION_SERVICE_TOKEN` | — | Legacy global token value. Ignored when `LEGACY_SERVICE_TOKEN_ENABLED=false`. **Backend secret. Never log.** |

> Production default: `PAYMENT_ORCHESTRATION_LEGACY_SERVICE_TOKEN_ENABLED=false`.
> All production traffic must use per-client API credentials (`nf.<env>.<credentialId>.<secret>`).

---

## HMAC signed requests (S9.4)

| Variable | Default | Notes |
|----------|---------|-------|
| `PAYMENT_ORCHESTRATION_SIGNED_REQUESTS_MODE` | `optional` in non-prod, `required` in production | `disabled` / `optional` / `required`. Production should be `required`. |
| `PAYMENT_ORCHESTRATION_SIGNED_REQUEST_MAX_SKEW_SECONDS` | `300` | Replay protection window (5 min). |
| `PAYMENT_ORCHESTRATION_SIGNED_REQUEST_NONCE_TTL_SECONDS` | `600` | Nonce store TTL. Must be ≥ `MAX_SKEW_SECONDS * 2`. |

---

## Rate limiting

| Variable | Default | Notes |
|----------|---------|-------|
| `PAYMENT_ORCHESTRATION_RATE_LIMIT_ENABLED` | `true` | Set to `false` only in isolated dev/CI where limiting is not needed. |
| `PAYMENT_ORCHESTRATION_RATE_LIMIT_CLIENT_GLOBAL_PER_MINUTE` | `600` | Per-client overall request budget per minute. |
| `PAYMENT_ORCHESTRATION_RATE_LIMIT_CLIENT_ROUTE_PER_MINUTE` | `120` | Per-client per-route budget per minute. |
| `PAYMENT_ORCHESTRATION_RATE_LIMIT_AUTH_FAILURE_PER_MINUTE` | `30` | Per-IP auth failure budget per minute (brute-force protection). |

---

## CORS

| Variable | Default | Notes |
|----------|---------|-------|
| `PAYMENT_ORCHESTRATION_CORS_ENABLED` | `false` | **Keep `false` in production.** Northflow is backend-to-backend only. |
| `PAYMENT_ORCHESTRATION_CORS_ALLOWED_ORIGINS` | `""` (empty) | Comma-separated origins. Only relevant when CORS is enabled. |

---

## Network / proxy

| Variable | Default | Notes |
|----------|---------|-------|
| `PAYMENT_ORCHESTRATION_TRUST_PROXY` | `false` | `true` / `false` / comma-separated IP list / hop count. Set to match your reverse proxy setup exactly — incorrect trust proxy exposes real IP spoofing. |
| `PAYMENT_ORCHESTRATION_JSON_BODY_LIMIT` | `256kb` | Express JSON body parser size cap. Increase only if provider payloads require it. |

---

## Readiness endpoint

| Variable | Default | Notes |
|----------|---------|-------|
| `PAYMENT_ORCHESTRATION_READY_TOKEN` | `""` (public) | If set, `GET /ready` requires `x-nf-ready-token: <token>` header. **Backend secret.** Protect in production via reverse proxy origin firewall if unset. |

---

## Provider: Xendit Sandbox

| Variable | Default | Notes |
|----------|---------|-------|
| `PAYMENT_ORCHESTRATION_XENDIT_SANDBOX_ENABLED` | `false` | Must be `true` to allow HTTP calls to Xendit API. |
| `PAYMENT_ORCHESTRATION_XENDIT_BASE_URL` | `https://api.xendit.co` | Override for Xendit mock/proxy in CI. |
| `PAYMENT_ORCHESTRATION_XENDIT_CALLBACK_TOKEN` | — | Xendit webhook callback verification token. Never logged — reported only as `configured`/`unconfigured` in `/ready`. **Backend secret.** |

---

## Merchant outbound webhooks (S10.3)

| Variable | Default | Notes |
|----------|---------|-------|
| `PAYMENT_ORCHESTRATION_OUTBOUND_WEBHOOKS_ENABLED` | `true` | Set `false` to disable webhook delivery worker entirely. |
| `PAYMENT_ORCHESTRATION_OUTBOUND_WEBHOOK_TIMEOUT_MS` | `10000` | Per-delivery HTTP timeout (ms). |
| `PAYMENT_ORCHESTRATION_OUTBOUND_WEBHOOK_MAX_ATTEMPTS` | `5` | Max delivery attempts per event per endpoint. |
| `PAYMENT_ORCHESTRATION_OUTBOUND_WEBHOOK_RESPONSE_BODY_LIMIT` | `2048` | Max response body bytes to store per delivery attempt. |

---

## Complete `.env` template

Copy this to your deployment secret manager and fill in real values. Never commit filled values.

```env
# ── Boot required ────────────────────────────────────────────────────────────
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://user:password@host:5432/northflow_prod

# ── Auth ──────────────────────────────────────────────────────────────────────
PAYMENT_ORCHESTRATION_LEGACY_SERVICE_TOKEN_ENABLED=false

# ── HMAC signed requests ──────────────────────────────────────────────────────
PAYMENT_ORCHESTRATION_SIGNED_REQUESTS_MODE=required
PAYMENT_ORCHESTRATION_SIGNED_REQUEST_MAX_SKEW_SECONDS=300
PAYMENT_ORCHESTRATION_SIGNED_REQUEST_NONCE_TTL_SECONDS=600

# ── Rate limiting ─────────────────────────────────────────────────────────────
PAYMENT_ORCHESTRATION_RATE_LIMIT_ENABLED=true
PAYMENT_ORCHESTRATION_RATE_LIMIT_CLIENT_GLOBAL_PER_MINUTE=600
PAYMENT_ORCHESTRATION_RATE_LIMIT_CLIENT_ROUTE_PER_MINUTE=120
PAYMENT_ORCHESTRATION_RATE_LIMIT_AUTH_FAILURE_PER_MINUTE=30

# ── Network ───────────────────────────────────────────────────────────────────
PAYMENT_ORCHESTRATION_CORS_ENABLED=false
PAYMENT_ORCHESTRATION_TRUST_PROXY=false
PAYMENT_ORCHESTRATION_JSON_BODY_LIMIT=256kb
PAYMENT_ORCHESTRATION_READY_TOKEN=<generate-with-openssl-rand-hex-32>

# ── Xendit sandbox ────────────────────────────────────────────────────────────
PAYMENT_ORCHESTRATION_XENDIT_SANDBOX_ENABLED=false
PAYMENT_ORCHESTRATION_XENDIT_BASE_URL=https://api.xendit.co
PAYMENT_ORCHESTRATION_XENDIT_CALLBACK_TOKEN=<xendit-callback-token>

# ── Outbound webhooks ─────────────────────────────────────────────────────────
PAYMENT_ORCHESTRATION_OUTBOUND_WEBHOOKS_ENABLED=true
PAYMENT_ORCHESTRATION_OUTBOUND_WEBHOOK_TIMEOUT_MS=10000
PAYMENT_ORCHESTRATION_OUTBOUND_WEBHOOK_MAX_ATTEMPTS=5
PAYMENT_ORCHESTRATION_OUTBOUND_WEBHOOK_RESPONSE_BODY_LIMIT=2048
```

---

## Secret redline policy

**NEVER expose these values in logs, responses, docs, or sample output:**

- `DATABASE_URL` — full connection string including credentials
- `PAYMENT_ORCHESTRATION_SERVICE_TOKEN` — legacy global token
- `PAYMENT_ORCHESTRATION_READY_TOKEN` — readiness endpoint token
- `PAYMENT_ORCHESTRATION_XENDIT_CALLBACK_TOKEN` — Xendit webhook secret
- Any API client raw credential (`nf.<env>.<credentialId>.<secret>`)
- Any signing key raw secret
- Any merchant outbound webhook raw secret
- Any provider account credentials

The `/ready` endpoint intentionally reports `callbackTokenConfigured: true/false` — never the token value itself.
