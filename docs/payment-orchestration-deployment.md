# Payment Orchestration Service — Deployment Guide

**Phase:** 8K — SDK/API Contract Freeze + Deployment Readiness  
**Last updated:** 2026-06-05

This guide covers how to install, configure, and run the `@northflow/payment-orchestration-service` standalone service.

---

## Prerequisites

- Node.js 20+
- pnpm 10+
- PostgreSQL (local, Neon serverless, or any standard Postgres)
- Environment variables configured (see `.env.example`)

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NODE_ENV` | No | `development` | Runtime environment. Set to `production` in production. |
| `PAYMENT_ORCHESTRATION_SERVICE_PORT` | No | `5100` | Port the service listens on. Avoid 5000 (reserved for legacy API). |
| `PAYMENT_ORCHESTRATION_DATABASE_URL` | **Yes** | — | PostgreSQL connection string. Falls back to `DATABASE_URL`. |
| `PAYMENT_ORCHESTRATION_SERVICE_TOKEN` | **Yes** (prod) | — | Service-to-service auth token for `/v1/...` routes. Falls back to `PAYMENT_ENGINE_SERVICE_TOKEN`. |
| `PAYMENT_ORCHESTRATION_FAKEGATEWAY_WEBHOOK_SECRET` | Yes (prod) | — | HMAC-SHA256 secret for FakeGateway webhook signature verification. Required in production. |
| `PAYMENT_ORCHESTRATION_XENDIT_SANDBOX_ENABLED` | No | `false` | Set to `true` to enable Xendit HTTP calls. |
| `PAYMENT_ORCHESTRATION_XENDIT_BASE_URL` | No | `https://api.xendit.co` | Xendit API base URL. |
| `PAYMENT_ORCHESTRATION_XENDIT_CALLBACK_TOKEN` | No | — | Xendit webhook callback token (x-callback-token header). Reported as configured/unconfigured only. |

### Credential env vars (via credentialsRef)

Provider account credentials are stored as **env var names** (not raw secrets) in the `credentials_ref` column. At runtime the service reads `process.env[credentialsRef]`. Example:

| Variable | Description |
|----------|-------------|
| `PAYMENT_ORCHESTRATION_XENDIT_SANDBOX_SECRET_KEY` | Xendit sandbox secret key. Name stored as `credentialsRef` in provider account row. |

---

## Install

```bash
# From monorepo root
pnpm install
```

---

## Type-Check

```bash
pnpm --filter @northflow/payment-orchestration-core type-check
pnpm --filter @northflow/payment-orchestration-service type-check
pnpm --filter @northflow/payment-orchestration-client-sdk type-check
```

---

## Run Tests

```bash
# All payment-orchestration tests
node_modules/.bin/tsx --tsconfig apps/api/tsconfig.node.json --test \
  apps/api/src/__tests__/payment-orchestration-*.test.ts

# Phase 8K contract freeze tests only
node_modules/.bin/tsx --tsconfig apps/api/tsconfig.node.json --test \
  apps/api/src/__tests__/payment-orchestration-8k-contract-freeze.test.ts
```

---

## Start Service

```bash
# Development (monorepo)
NODE_ENV=development \
  PAYMENT_ORCHESTRATION_SERVICE_TOKEN=dev-token \
  PAYMENT_ORCHESTRATION_DATABASE_URL=postgresql://... \
  node_modules/.bin/tsx --tsconfig apps/payment-orchestration-service/tsconfig.json \
  apps/payment-orchestration-service/src/index.ts

# Via workspace script
pnpm --filter @northflow/payment-orchestration-service dev

# Production (Docker)
docker build -f apps/payment-orchestration-service/Dockerfile -t payment-orchestration-service .
docker run -p 5100:5100 \
  -e NODE_ENV=production \
  -e PAYMENT_ORCHESTRATION_DATABASE_URL=postgresql://... \
  -e PAYMENT_ORCHESTRATION_SERVICE_TOKEN=<strong-token> \
  -e PAYMENT_ORCHESTRATION_FAKEGATEWAY_WEBHOOK_SECRET=<strong-secret> \
  payment-orchestration-service
```

---

## Run Migrations

The service runs migrations automatically at startup via `runMigrationAsync()`. To run standalone:

```bash
# Apply standalone migrations
psql $PAYMENT_ORCHESTRATION_DATABASE_URL \
  -f apps/payment-orchestration-service/migrations/0001_payment_orchestration_initial.sql
```

---

## Workers

Workers run without Express. They construct the standalone container, execute the operation, emit JSON results, and exit.

### expire-stale

Expires payment transactions and intents that have passed their `expiresAt` timestamp.

```bash
pnpm --filter @northflow/payment-orchestration-service worker -- expire-stale --limit 100
```

### reconcile-intent

Recomputes intent totals from actual transaction state (crash-recovery).

```bash
pnpm --filter @northflow/payment-orchestration-service worker -- reconcile-intent \
  --merchant-id <MERCHANT_ID> --intent-id <INTENT_ID>
```

### reprocess-provider-events

Replays stored provider events that were not successfully processed.

```bash
pnpm --filter @northflow/payment-orchestration-service worker -- reprocess-provider-events \
  --older-than-minutes 5 --limit 100
```

### all-safe

Runs all local-safe workers: `expire-stale` + `reprocess-provider-events`. Does NOT require provider network calls.

```bash
pnpm --filter @northflow/payment-orchestration-service worker -- all-safe --limit 100
```

---

## Run Extraction Check

Validates the service is extraction-ready (schema ownership, standalone migrations, forbidden import checks, etc.).

```bash
pnpm payment-orchestration:extraction-check
```

---

## Health Checks

After starting the service:

```bash
BASE=http://localhost:5100

# Liveness
curl $BASE/health
# { "ok": true, "service": "payment-orchestration-service" }

# Version metadata
curl $BASE/version
# { "service": "...", "version": "0.3.0", "phase": "8K", ... }

# Readiness (DB, providers, xendit config)
curl $BASE/ready
# { "ok": true, "service": "...", "providers": { ... }, "database": "configured" }
```

---

## Deployment Notes

- The service runs on port `5100` by default. Port `5000` is reserved for the legacy API.
- Webhook route (`POST /v1/webhooks/:provider`) intentionally bypasses service-token auth. Provider identity is verified via HMAC signature.
- Set `PAYMENT_ORCHESTRATION_FAKEGATEWAY_WEBHOOK_SECRET` in production to enforce signed webhooks.
- `credentialsRef` must always be an env var name, never a raw secret. Never store raw API keys in the database.
- Workers have no built-in scheduler. Run them from a platform cron, queue worker, or maintenance script.
