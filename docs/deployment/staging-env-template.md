# Staging Environment Template

Copy this file, fill in all required values, and store in your secret manager.
**Never commit filled values to source control.**

---

## Service environment variables

```env
# ── Boot (required) ───────────────────────────────────────────────────────────
NODE_ENV=staging
PORT=3000
DATABASE_URL=postgresql://<db-user>:<db-password>@staging-db-host:5432/northflow_staging

# ── Port aliases (legacy / standalone compat) ─────────────────────────────────
# PAYMENT_ORCHESTRATION_SERVICE_PORT=3000
# PAYMENT_ENGINE_SERVICE_PORT=3000

# ── Auth ──────────────────────────────────────────────────────────────────────
# Staging: legacy token MAY be enabled for bootstrap convenience; disable before prod
PAYMENT_ORCHESTRATION_LEGACY_SERVICE_TOKEN_ENABLED=true
PAYMENT_ORCHESTRATION_SERVICE_TOKEN=<staging-legacy-token-if-needed>

# ── HMAC signed requests ──────────────────────────────────────────────────────
PAYMENT_ORCHESTRATION_SIGNED_REQUESTS_MODE=optional
PAYMENT_ORCHESTRATION_SIGNED_REQUEST_MAX_SKEW_SECONDS=300
PAYMENT_ORCHESTRATION_SIGNED_REQUEST_NONCE_TTL_SECONDS=600

# ── Rate limiting ─────────────────────────────────────────────────────────────
PAYMENT_ORCHESTRATION_RATE_LIMIT_ENABLED=true
PAYMENT_ORCHESTRATION_RATE_LIMIT_CLIENT_GLOBAL_PER_MINUTE=600
PAYMENT_ORCHESTRATION_RATE_LIMIT_CLIENT_ROUTE_PER_MINUTE=120
PAYMENT_ORCHESTRATION_RATE_LIMIT_AUTH_FAILURE_PER_MINUTE=30

# ── CORS ─────────────────────────────────────────────────────────────────────
# Keep false unless explicitly needed for staging integration tests
PAYMENT_ORCHESTRATION_CORS_ENABLED=false
PAYMENT_ORCHESTRATION_CORS_ALLOWED_ORIGINS=

# ── Network / proxy ───────────────────────────────────────────────────────────
# Set true if staging is behind Nginx/Caddy/Cloudflare
PAYMENT_ORCHESTRATION_TRUST_PROXY=false
PAYMENT_ORCHESTRATION_JSON_BODY_LIMIT=256kb

# ── Readiness ─────────────────────────────────────────────────────────────────
PAYMENT_ORCHESTRATION_READY_TOKEN=<generate: openssl rand -hex 32>

# ── Xendit sandbox ────────────────────────────────────────────────────────────
PAYMENT_ORCHESTRATION_XENDIT_SANDBOX_ENABLED=true
PAYMENT_ORCHESTRATION_XENDIT_BASE_URL=https://api.xendit.co
PAYMENT_ORCHESTRATION_XENDIT_CALLBACK_TOKEN=<xendit-staging-callback-token>

# ── Outbound webhooks ─────────────────────────────────────────────────────────
PAYMENT_ORCHESTRATION_OUTBOUND_WEBHOOKS_ENABLED=true
PAYMENT_ORCHESTRATION_OUTBOUND_WEBHOOK_TIMEOUT_MS=10000
PAYMENT_ORCHESTRATION_OUTBOUND_WEBHOOK_MAX_ATTEMPTS=5
PAYMENT_ORCHESTRATION_OUTBOUND_WEBHOOK_RESPONSE_BODY_LIMIT=2048
```

---

## Smoke script environment variables

Set these before running `pnpm s10:readiness` or `pnpm s10:smoke`:

```env
# ── Readiness check ───────────────────────────────────────────────────────────
NORTHFLOW_BASE_URL=https://staging.your-domain.example.com
NORTHFLOW_READY_TOKEN=<same as PAYMENT_ORCHESTRATION_READY_TOKEN above>
NORTHFLOW_API_KEY=nf.staging.<credentialId>.<secret>
NORTHFLOW_MERCHANT_ID=mer_<staging-merchant-id>
NORTHFLOW_SOURCE_APP=<your-source-app>

# ── Bootstrap smoke ───────────────────────────────────────────────────────────
NORTHFLOW_SMOKE_MERCHANT_NAME=Staging Smoke Merchant
NORTHFLOW_SMOKE_EXTERNAL_REF=staging_smoke_<timestamp>
NORTHFLOW_SMOKE_PROVIDER=fake_gateway
NORTHFLOW_SMOKE_METHOD=qris
NORTHFLOW_SMOKE_CURRENCY=IDR
NORTHFLOW_SMOKE_AMOUNT=10000
# NORTHFLOW_SMOKE_WEBHOOK_URL=https://your-webhook-receiver.example.com/northflow
```

---

## Key differences from production

| Setting | Staging | Production |
|---------|---------|------------|
| `NODE_ENV` | `staging` | `production` |
| `LEGACY_SERVICE_TOKEN_ENABLED` | `true` (bootstrap only) | `false` (mandatory) |
| `SIGNED_REQUESTS_MODE` | `optional` | `required` |
| `XENDIT_SANDBOX_ENABLED` | `true` | depends on PSP setup |
| `CORS_ENABLED` | `false` | `false` (always) |
| `/v1/dev/fake-gateway/*` routes | Available (`NODE_ENV != production`) | **Absent** (404) |

---

## Secret handling rules

- Store all `<secret>` values in a backend secret manager (AWS SSM, Vault, GCP Secret Manager).
- Never commit this file with filled values to source control.
- Rotate `NORTHFLOW_API_KEY` using `pnpm s10:smoke --help` → `credential:rotate` after each deployment cycle where compromise is possible.
- `rawSecret` from credential/webhook creation is returned **once only** — store immediately.
