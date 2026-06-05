# Payment Orchestration — Standalone Repo Target Layout

**Phase:** 8K — SDK/API Contract Freeze + Deployment Readiness  
**Last updated:** 2026-06-05

This document describes the target file layout for the extracted standalone `northflow-payment-orchestration` repository.

---

## Target Repository Layout

```
northflow-payment-orchestration/
│
├── packages/
│   ├── core/                              ← @northflow/payment-orchestration-core
│   │   ├── src/
│   │   │   ├── domain/
│   │   │   │   ├── PaymentMerchant.ts
│   │   │   │   ├── PaymentProviderAccount.ts
│   │   │   │   ├── PaymentIntent.ts
│   │   │   │   ├── PaymentTransaction.ts
│   │   │   │   ├── PaymentProviderEvent.ts
│   │   │   │   ├── PaymentErrors.ts
│   │   │   │   └── PaymentScope.ts
│   │   │   ├── application/
│   │   │   │   ├── contracts.ts
│   │   │   │   ├── ports.ts
│   │   │   │   └── repositories.ts
│   │   │   ├── providers/
│   │   │   │   ├── providerActions.ts
│   │   │   │   └── providerCapabilities.ts
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── client-sdk/                        ← @northflow/payment-orchestration-client-sdk
│       ├── src/
│       │   ├── client.ts
│       │   ├── types.ts
│       │   ├── errors.ts
│       │   └── index.ts
│       ├── package.json
│       └── tsconfig.json
│
├── apps/
│   └── service/                           ← @northflow/payment-orchestration-service
│       ├── src/
│       │   ├── app.ts
│       │   ├── container.ts
│       │   ├── index.ts
│       │   ├── application/
│       │   │   ├── errors.ts
│       │   │   └── use-cases/
│       │   ├── config/
│       │   │   └── env.ts
│       │   ├── infrastructure/
│       │   │   ├── db.ts
│       │   │   ├── schema.ts
│       │   │   ├── providers/
│       │   │   └── repositories/
│       │   ├── middleware/
│       │   │   ├── auth.ts
│       │   │   └── errors.ts
│       │   ├── routes/
│       │   │   ├── health.ts
│       │   │   ├── merchants.ts
│       │   │   ├── providerAccounts.ts
│       │   │   ├── intents.ts
│       │   │   ├── transactions.ts
│       │   │   ├── webhooks.ts
│       │   │   ├── devFakeGateway.ts
│       │   │   └── utils.ts
│       │   └── workers/
│       │       └── run.ts
│       ├── migrations/
│       │   └── 0001_payment_orchestration_initial.sql
│       ├── .env.example
│       ├── Dockerfile
│       ├── drizzle.config.ts
│       ├── package.json
│       └── tsconfig.json
│
├── migrations/                            ← top-level migration convenience alias (optional)
│   └── 0001_payment_orchestration_initial.sql
│
├── docs/
│   ├── payment-orchestration-api-contract.md
│   ├── payment-orchestration-sdk-contract.md
│   ├── payment-orchestration-error-codes.md
│   ├── payment-orchestration-deployment.md
│   ├── payment-orchestration-worker-operations.md
│   ├── payment-orchestration-service-smoke-test.md
│   ├── payment-orchestration-standalone-repo-layout.md
│   └── openapi/
│       └── payment-orchestration.openapi.json
│
├── scripts/
│   └── extraction-check.ts
│
├── docker/
│   └── compose.yml
│
├── .github/
│   └── workflows/
│       ├── ci.yml
│       └── release.yml
│
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── turbo.json
├── README.md
└── CHANGELOG.md
```

---

## Extraction Readiness Checklist

### Package Names

- [ ] `@northflow/payment-orchestration-core` — no `@pos/` prefix
- [ ] `@northflow/payment-orchestration-client-sdk` — no `@pos/` prefix
- [ ] `@northflow/payment-orchestration-service` — no `@pos/` prefix

### Package Exports

- [ ] `core/src/index.ts` exports all public domain types, repository interfaces, and application contracts
- [ ] `client-sdk/src/index.ts` exports `PaymentOrchestrationClient`, error classes, all request/response types
- [ ] Service package does not re-export internals — it is a runnable app, not a library

### Build Outputs

- [ ] `core` has `type-check` script
- [ ] `client-sdk` has `type-check` script
- [ ] `service` has `dev`, `start`, `type-check`, `worker` scripts
- [ ] Optional: `service` has `build` script for compiled output (esbuild)

### TypeScript Path Aliases

- [ ] `tsconfig.base.json` includes `@northflow/payment-orchestration-core` path alias
- [ ] `service/tsconfig.json` resolves `@northflow/payment-orchestration-core` correctly
- [ ] No `@pos/*` path aliases remain in extraction packages

### Migrations Ownership

- [ ] `apps/service/migrations/0001_payment_orchestration_initial.sql` exists
- [ ] Service `drizzle.config.ts` points to service-local migrations directory
- [ ] No dependency on monorepo root migrations for standalone operation

### Env Files

- [ ] `apps/service/.env.example` present with all required vars documented
- [ ] No real secrets in `.env.example`
- [ ] `NODE_ENV`, `PORT`, `DATABASE_URL`, `PAYMENT_ORCHESTRATION_SERVICE_TOKEN`, all provider vars documented

### CI Jobs

- [ ] `ci.yml` — lint, type-check, test on push/PR
- [ ] `release.yml` — build and publish on tag

### Docker Build

- [ ] `apps/service/Dockerfile` present
- [ ] `HEALTHCHECK` configured (`GET /health`)
- [ ] Multi-stage build (builder + runtime)
- [ ] No secrets in Dockerfile

### Versioning / Changelog

- [ ] `CHANGELOG.md` present
- [ ] Packages follow semver
- [ ] Phase 8K is the freeze baseline (v0.3.0+)

### Release Tag Strategy

- Tag format: `v<MAJOR>.<MINOR>.<PATCH>` (e.g. `v0.3.0`)
- Pre-release: `v0.3.0-alpha.1`
- Breaking changes: major version bump

---

## Current Monorepo Source Mapping

| Standalone target | Current monorepo path |
|-------------------|-----------------------|
| `packages/core/` | `packages/payment-orchestration-core/` |
| `packages/client-sdk/` | `packages/payment-orchestration-client-sdk/` |
| `apps/service/` | `apps/payment-orchestration-service/` |
| `docs/` | `docs/payment-orchestration-*.md`, `docs/openapi/` |
| `scripts/extraction-check.ts` | `scripts/payment-orchestration-extraction-check.ts` |
| `apps/service/migrations/` | `apps/payment-orchestration-service/migrations/` |

---

## Notes

- The embedded AuraPoS payment engine (`apps/api/src/`, `packages/application/payments/`, `packages/domain/payments/`, `packages/infrastructure/payments/`) is **not** extracted — it remains in the AuraPoS monorepo.
- The bridge adapter (`packages/application/payments/adapters/PaymentProviderCoreAdapter.ts`) stays in AuraPoS.
- The `@northflow/payment-orchestration-client-sdk` is independently versioned and can be published to npm without bringing in `@northflow/payment-orchestration-core`.
