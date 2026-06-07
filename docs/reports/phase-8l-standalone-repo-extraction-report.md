# Phase 8L — Standalone Repo Extraction Report

**Date:** 2026-06-05
**Phase:** 8L — Extract Northflow Payment Orchestration as Standalone Repo
**Cleanup:** 8L.1 — In-Repo Standalone Folder Cleanup
**Status:** ✅ Complete

---

## Summary

The Northflow Payment Orchestration system has been fully extracted from the legacy monorepo into a self-contained, type-checkable standalone directory `northflow-payment-orchestration/` within the legacy system workspace. All source files, migrations, tests, docs, and config have been copied, adapted, and validated.

---

## Source Repository

- **Source repo:** `https://github.com/Rndynt/legacy system.git` (legacy monorepo)
- **Source commit:** `96d77ad7f412ff220be90995183d223cc32449c9`
- **Extracted folder:** `northflow-payment-orchestration/` (inside legacy workspace)
- **Intended standalone target:** `https://github.com/Rndynt/northflow-payment-orchestration.git`

---

## Extracted Layout

```
northflow-payment-orchestration/
├── package.json                      root workspace + scripts
├── pnpm-workspace.yaml               packages/* + apps/*
├── turbo.json                        dev / type-check / build pipeline
├── tsconfig.base.json                shared compiler options
├── .env.example                      root env template
├── .gitignore
├── README.md
├── packages/
│   ├── core/                         @northflow/payment-orchestration-core
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/                      ← packages/payment-orchestration-core/src
│   └── client-sdk/                   @northflow/payment-orchestration-client-sdk
│       ├── package.json
│       ├── tsconfig.json
│       └── src/                      ← packages/payment-orchestration-client-sdk/src
├── apps/
│   └── service/                      @northflow/payment-orchestration-service
│       ├── package.json
│       ├── tsconfig.json
│       ├── drizzle.config.ts
│       ├── Dockerfile
│       ├── .env.example
│       └── src/                      ← apps/payment-orchestration-service/src
├── migrations/                       ← apps/payment-orchestration-service/migrations/
├── tests/                            ← apps/api/src/__tests__/payment-orchestration-*.test.ts
│   ├── tsconfig.json
│   └── *.test.ts (19 files)
├── docs/
│   ├── reports/
│   │   └── phase-8l-standalone-repo-extraction-report.md  ← this file
│   ├── openapi/
│   │   └── payment-orchestration.openapi.json
│   ├── payment-orchestration-api-contract.md
│   ├── payment-orchestration-sdk-contract.md
│   ├── payment-orchestration-error-codes.md
│   ├── payment-orchestration-deployment.md
│   ├── payment-orchestration-worker-operations.md
│   ├── payment-orchestration-service-smoke-test.md
│   ├── payment-orchestration-standalone-fakegateway-smoke.md
│   ├── payment-orchestration-standalone-repo-layout.md
│   └── payment-orchestration-hybrid-standalone-architecture.md
└── scripts/
    └── extraction-check.ts
```

---

## Files Copied / Adapted

### Source → Target mappings

| legacy system Source | Standalone Target | Change |
|---|---|---|
| `packages/payment-orchestration-core/src/` | `packages/core/src/` | None (identical copy) |
| `packages/payment-orchestration-client-sdk/src/` | `packages/client-sdk/src/` | None (identical copy) |
| `apps/payment-orchestration-service/src/` | `apps/service/src/` | None (identical copy) |
| `apps/payment-orchestration-service/migrations/` | `migrations/` | None (identical copy) |
| `apps/payment-orchestration-service/.env.example` | `apps/service/.env.example` | Env placeholder cleaned |
| `apps/payment-orchestration-service/Dockerfile` | `apps/service/Dockerfile` | Paths updated (see below) |
| `docs/payment-orchestration-*.md` | `docs/payment-orchestration-*.md` | Copied as-is |
| `docs/openapi/payment-orchestration.openapi.json` | `docs/openapi/payment-orchestration.openapi.json` | Copied as-is |
| `apps/api/src/__tests__/payment-orchestration-*.test.ts` | `tests/*.test.ts` | Import paths adapted |

### Test excluded (legacy system-only)
- `payment-orchestration-core-contract-adapter.test.ts` — imports `@pos/application/payments/adapters/...` and `@pos/infrastructure/payments/...` which don't exist outside the legacy context.

---

## Package / Config Changes

### New root files created
- `package.json` — workspace root with all required scripts (`check`, `build`, `dev`, `dev:service`, `start:service`, `type-check`, `test`, `db:migrate`, `db:generate`, `worker`, `extraction-check`)
- `pnpm-workspace.yaml` — workspace packages declaration
- `turbo.json` — pipeline tasks
- `tsconfig.base.json` — base TypeScript config (CommonJS, ES2020, strict, allowImportingTsExtensions)

### packages/core/tsconfig.json
- Extends `../../tsconfig.base.json` (no path changes needed — core has no workspace imports)

### packages/client-sdk/tsconfig.json
- `paths`: `@northflow/payment-orchestration-core` → `../../packages/core/src` (was `../../packages/payment-orchestration-core/src`)

### apps/service/tsconfig.json
- New file (original service tsconfig used legacy system monorepo root paths)
- `paths`: `@northflow/payment-orchestration-core` → `../../packages/core/src`
- `module: CommonJS`, `moduleResolution: node` (matches original service tsconfig)

### apps/service/package.json
- Added `start` script: `NODE_ENV=production tsx --tsconfig tsconfig.json src/index.ts`
- Added `build` script: `tsc -p tsconfig.json --noEmit`
- Added `db:migrate` and `db:generate` scripts

### tests/tsconfig.json
- New file for running tests from standalone root
- `paths` maps both `@northflow/payment-orchestration-core` and `@northflow/payment-orchestration-client-sdk` to local packages

---

## Import / Path Cleanup

### Test files
All 19 test files had these substitutions applied:
- `../../../payment-orchestration-service/src/` → `../../apps/service/src/`
- `../../../../packages/payment-orchestration-client-sdk/src/` → `../../packages/client-sdk/src/`
- Path checks `apps/payment-orchestration-service/` → `apps/service/`
- Boundary test `SCOPES` array: `packages/payment-orchestration-core` → `packages/core`, etc.

### Source files (no changes needed)
All source files in `packages/core/`, `packages/client-sdk/`, and `apps/service/` were already clean — they only import from `@northflow/payment-orchestration-core` (workspace alias) or local relative paths. No `@pos/*` imports, no `shared/schema` references.

---

## Env Cleanup (Phase 8L.1)

- Replaced `xnd_development_replace_with_real_key` → `replace-with-xendit-sandbox-secret-key` in both `.env.example` files.
- No `.env` file committed.

---

## Docker Build Command (Phase 8L.1)

Dockerfile is at `apps/service/Dockerfile` and copies root workspace files, so it must be built from repo root:

```bash
docker build -f apps/service/Dockerfile -t northflow-payment-orchestration .
```

README and docs updated to reflect this.

---

## Tests / Checks Run

### Type-check (all clean — 0 errors)
```
packages/core    — tsc -p packages/core/tsconfig.json --noEmit     → 0 errors
packages/client-sdk — tsc -p packages/client-sdk/tsconfig.json --noEmit → 0 errors
apps/service     — tsc -p apps/service/tsconfig.json --noEmit      → 0 errors
```

**Note on @types/express isolation:** The standalone repo's own `node_modules` (installed via `pnpm install`) provides `@types/express@4.17.21`. This is important because the root legacy workspace also has `@types/express@5.0.6` installed, which would cause ~10 type errors in route files if picked up.

### Extraction check (Phase 8L)
```
44/44 passed — IN_REPO_STANDALONE_FOLDER_READY_TO_PUSH_TO_PAYMENT_REPO
```

### Extraction check (Phase 8L.1)
See validation section in this phase's report.

---

## Known Limitations

1. **No compiled JS output** — The service uses `tsx` to run TypeScript source directly. There is no `dist/` folder. `pnpm build` runs a full type-check pass instead of emitting JS. This is intentional for the current dev/staging phase.

2. **FakeGateway is dev/test only** — `StandaloneFakeGatewayProvider` is only registered when `NODE_ENV !== 'production'`. Real money movement requires a configured Xendit or production provider.

3. **`payment-orchestration-core-contract-adapter.test.ts` excluded** — This test validates legacy embedded provider adapters and cannot run outside the legacy context.

4. **Integration tests require a live PostgreSQL DB** — Tests that create real DB rows (fakegateway flow, HTTP auth, webhook route tests) require `DATABASE_URL` or `PAYMENT_ORCHESTRATION_DATABASE_URL` to be set.

---

## Final Decision

```
IN_REPO_STANDALONE_FOLDER_READY_TO_PUSH_TO_PAYMENT_REPO
```

---

## Next Steps

1. **Push this folder** to `https://github.com/Rndynt/northflow-payment-orchestration.git` as the initial standalone repo commit.
2. **legacy system cleanup** (future phase) — Remove or archive the legacy embedded payment runtime (`apps/payment-orchestration-service/`, `packages/payment-orchestration-core/`, `packages/payment-orchestration-client-sdk/`, `packages/application/payments/`, `packages/domain/payments/`, `packages/infrastructure/payments/providers/`) once the standalone service is fully production-ready and integrated.
