# Northflow Payment Orchestration

Northflow Payment Orchestration is a standalone payment orchestration service for merchant payment intents, provider accounts, webhook processing, reconciliation, worker operations, and typed SDK/API integration.

## Packages

| Package | Path | Description |
|---|---|---|
| `@northflow/payment-orchestration-core` | `packages/core/` | Domain types, DTOs, repository contracts |
| `@northflow/payment-orchestration-client-sdk` | `packages/client-sdk/` | Typed HTTP client SDK |
| `@northflow/payment-orchestration-service` | `apps/service/` | Express REST service + workers |

## Quick Start

```bash
# Install dependencies
pnpm install

# Set environment variables
cp .env.example .env
# Edit .env with your DATABASE_URL and PAYMENT_ORCHESTRATION_SERVICE_TOKEN

# Run database migrations
pnpm db:migrate

# Start the service (development)
pnpm dev:service
```

## Scripts

| Script | Description |
|---|---|
| `pnpm check` | Type-check all packages |
| `pnpm build` | Build all packages (type-check only — tsx runs TS source directly, no JS emit) |
| `pnpm dev:service` | Start service in development mode (hot reload via tsx) |
| `pnpm start:service` | Start service in production mode |
| `pnpm test` | Run all unit tests |
| `pnpm db:migrate` | Apply database migrations |
| `pnpm db:generate` | Generate new migration from schema changes |
| `pnpm worker` | Run background workers (expiry + reconciliation) |
| `pnpm extraction-check` | Validate standalone repo structure and boundary purity |

> **Note on build**: The service uses `tsx` to run TypeScript source directly without emitting compiled JS.
> `pnpm build` runs a full type-check pass (`tsc --noEmit`) as the build validation step.

## Running Tests

```bash
# Run all tests from repo root (requires DATABASE_URL env var for integration tests)
pnpm test

# Run individual test file
npx tsx --tsconfig tests/tsconfig.json --test tests/payment-orchestration-schema-mappers.test.ts
```

## Database Migrations

```bash
pnpm db:migrate    # apply migrations
pnpm db:generate   # generate new migration from schema changes
```

## Environment Variables

See `.env.example` for all required variables. Key ones:

- `PAYMENT_ORCHESTRATION_DATABASE_URL` — PostgreSQL connection string
- `PAYMENT_ORCHESTRATION_SERVICE_TOKEN` — service-to-service auth token
- `PAYMENT_ORCHESTRATION_SERVICE_PORT` — HTTP port (default: 5100)
- `PAYMENT_ORCHESTRATION_FAKEGATEWAY_WEBHOOK_SECRET` — webhook HMAC secret

## API

Service runs on port 5100 by default. See `docs/payment-orchestration-api-contract.md`.

Authentication: all routes except `/v1/webhooks/:provider` require header:
```
x-payment-orchestration-service-token: <your-token>
```

## Docker

Build from the repo root (the Dockerfile copies root workspace files):

```bash
docker build -f apps/service/Dockerfile -t northflow-payment-orchestration .

docker run -p 5100:5100 \
  -e PAYMENT_ORCHESTRATION_DATABASE_URL=... \
  -e PAYMENT_ORCHESTRATION_SERVICE_TOKEN=... \
  northflow-payment-orchestration
```

## Project History

This service was extracted from the [AuraPoS](https://github.com/Rndynt/AuraPoS) monorepo (Phase 8L).
The AuraPoS source areas remain intact as a fallback until the standalone service is fully production-ready.

## Version

Phase: **8L.1** — Standalone repo cleanup
Config version: `0.3.0` (8K)
