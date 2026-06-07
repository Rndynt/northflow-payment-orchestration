# Payment Orchestration — Hybrid Standalone Architecture

**Phase:** 8B — Core Contract Adoption (current)
**Previous phase:** 8A — Hybrid Standalone Extraction Scaffold (Hardened)
**Status:** Provider contracts converged. SDK renamed. Adapter helpers added. Embedded engine unchanged.
**Date:** 2026-06-05
**Naming:** `@northflow/payment-orchestration-*`

---

## Overview

The legacy payment engine began as an embedded subsystem inside `apps/api`.
Phases 1–7 progressively hardened it (multi-provider, partial payments, refunds,
voiding, Phase 7A resilience hardening).

Phase 8A introduces the **Hybrid Standalone** extraction pattern: a new standalone
service is scaffolded alongside the embedded engine under the `@northflow` namespace.
The embedded engine remains fully operational. A smooth migration across Phases 8B–8E
gradually shifts traffic to the standalone service.

The standalone system is intentionally branded `@northflow/payment-orchestration-*`
rather than `@pos/payment-engine-*` because it is designed to be reusable by
Consumer backends, photography apps, and future projects — not tied to any
single product.

---

## Monorepo Layout

```
packages/
  payment-orchestration-core/        ← Framework-agnostic contracts (NEW, Phase 8A)
    src/
      domain/                        ← Domain types (merchantId-centric)
        PaymentScope.ts
        PaymentMerchant.ts
        PaymentProviderAccount.ts
        PaymentIntent.ts
        PaymentTransaction.ts
        PaymentErrors.ts
      application/                   ← Use-case input/output contracts + port interfaces
        contracts.ts
        ports.ts
      providers/                     ← Provider action + capability contracts
        providerActions.ts
        providerCapabilities.ts
      index.ts                       ← Public API surface

  payment-orchestration-client-sdk/  ← Typed HTTP client (NEW, Phase 8A)
    src/
      client.ts                      ← PaymentEngineClient (fetch-compatible)
      types.ts                       ← Request/response shapes (self-contained)
      errors.ts                      ← PaymentEngineClientError, PaymentEngineNetworkError
      index.ts                       ← Public API surface

apps/
  payment-orchestration-service/     ← Standalone Express service (NEW, Phase 8A skeleton)
    src/
      config/env.ts                  ← Environment variable loader (dual-env-var support)
      routes/health.ts               ← GET /health, GET /version
      routes/intents.ts              ← POST /v1/payment-intents (501 placeholder)
                                        GET  /v1/payment-intents/:id/status (501)
                                        GET  /v1/payment-intents/:id/refundability (501)
                                        POST /v1/payment-intents/:id/gateway-payments (501)
      routes/webhooks.ts             ← POST /v1/webhooks/:provider (501 placeholder)
      container.ts                   ← DI container (Phase 8A: config only)
      app.ts                         ← Express application factory
      index.ts                       ← Entry point (port 5100)

  api/                               ← Existing legacy API (UNCHANGED, port 5000)
    src/payments/                    ← Embedded payment engine (UNCHANGED through Phase 8E)
```

---

## Package Names

| Package | Name |
|---------|------|
| Core contracts | `@northflow/payment-orchestration-core` |
| Standalone service | `@northflow/payment-orchestration-service` |
| HTTP client SDK | `@northflow/payment-orchestration-client-sdk` |

Do NOT use `@pos/payment-engine-*` for the standalone packages — those names are
legacy and have been replaced in Phase 8A hardening.

---

## Identity Model Change

### Embedded (current)
```
tenantId → payment intent → transactions
```

The embedded engine uses `tenantId` (the legacy system-specific slug) as the primary
payment owner identity. This couples the payment engine to legacy multi-tenant
auth model.

### Standalone (target)
```
merchantId → payment intent → transactions
```

The standalone engine uses `merchantId` as the primary payment owner. A merchant
maps to a commercial entity — decoupled from any source application's auth model.

### Migration Bridge
`createLegacyTenantPaymentScope()` in `payment-orchestration-core` provides
a temporary compatibility adapter that maps legacy `tenantId` → standalone
`merchantId`. This bridge is used during Phases 8B–8E and removed in Phase 8F.

---

## Service Boundaries (Phase 8A → 8E)

| Phase | Embedded Engine | Standalone Service | Client SDK       |
|-------|----------------|--------------------|------------------|
| 8A    | 100% traffic   | 0% (skeleton only) | Types + client   |
| 8B    | 100% traffic   | Provider migration | Internal testing |
| 8C    | 95% traffic    | 5% shadow traffic  | Validation       |
| 8D    | 50% traffic    | 50% traffic        | consumers + others |
| 8E    | 0% (deprecated)| 100% traffic       | All consumers    |

---

## API Routes (Phase 8A)

### Operational
```
GET  /health                                           → 200 { ok: true, service: 'payment-orchestration-service' }
GET  /version                                          → 200 { service, version, phase }
```

### Placeholder (501 Not Implemented — Phase 8D target)
```
POST /v1/payment-intents                               → 501
GET  /v1/payment-intents/:id/status                   → 501
GET  /v1/payment-intents/:id/refundability            → 501  ← added in Phase 8A hardening
POST /v1/payment-intents/:id/gateway-payments         → 501
POST /v1/webhooks/:provider                           → 501
```

### Future Routes (Phase 8D+)
```
POST /v1/payment-intents/:id/refund                   → Phase 8D
POST /v1/payment-intents/:id/void                     → Phase 8D
```

---

## Environment Variables

### Port
| Variable | Description |
|----------|-------------|
| `PAYMENT_ORCHESTRATION_SERVICE_PORT` | Preferred. Port for the standalone service. |
| `PAYMENT_ENGINE_SERVICE_PORT` | Backwards-compat alias. |
| `PORT` | Generic fallback. |
| *(default)* | `5100` |

### Service Token
| Variable | Description |
|----------|-------------|
| `PAYMENT_ORCHESTRATION_SERVICE_TOKEN` | Preferred. Auth token for service-to-service calls. |
| `PAYMENT_ENGINE_SERVICE_TOKEN` | Backwards-compat alias during monorepo transition. |

---

## Design Principles

### No Embedded Dependencies
`packages/payment-orchestration-core` and `apps/payment-orchestration-service` MUST NOT import:
- `@pos/domain` (legacy order domain)
- `@pos/application` (the legacy system use cases)
- `@pos/infrastructure` (the legacy system DB repositories)
- legacy session middleware or tenant resolution

These packages are independently versioned and standalone by design.

### Client SDK Self-Containment
`packages/payment-orchestration-client-sdk` MUST NOT import from
`@northflow/payment-orchestration-core`. It is independently versioned for portability
(can be published to npm separately, used by consumer backends without bringing in the core package).

### Port-Based Design
Infrastructure concerns (DB, secrets, external HTTP) are behind port interfaces
(`IPaymentMerchantRepository`, `IStandalonePaymentIntentRepository`, etc.).
Use cases depend only on these interfaces — never on concrete implementations.

### Backwards Compatibility
The embedded legacy payment engine at `apps/api/src/payments/` is **unchanged**.
All existing `/api/payment-engine/...` routes continue to work normally.
No DB migrations are required in Phase 8A.

---

## Port (Default 5100)

The standalone service runs on port `5100` by default.
Set `PAYMENT_ORCHESTRATION_SERVICE_PORT` (or legacy `PAYMENT_ENGINE_SERVICE_PORT`) to override.
Port `5000` is reserved for `apps/api`.

---

## Running the Standalone Service (Phase 8A)

```bash
# From monorepo root
PAYMENT_ORCHESTRATION_SERVICE_PORT=5100 \
  npx tsx --tsconfig apps/payment-orchestration-service/tsconfig.json \
  apps/payment-orchestration-service/src/index.ts

# Or via workspace script
pnpm --filter @northflow/payment-orchestration-service dev
```

Expected output:
```
[payment-orchestration-service] Phase 8A listening on port 5100 (NODE_ENV=development)
  GET http://localhost:5100/health
  GET http://localhost:5100/version

  Placeholder routes (501 Not Implemented):
  POST http://localhost:5100/v1/payment-intents
  GET  http://localhost:5100/v1/payment-intents/:id/status
  GET  http://localhost:5100/v1/payment-intents/:id/refundability
  POST http://localhost:5100/v1/webhooks/:provider
```

---

## Type-Check Commands

```bash
# payment-orchestration-core
pnpm --filter @northflow/payment-orchestration-core type-check

# payment-orchestration-client-sdk
pnpm --filter @northflow/payment-orchestration-client-sdk type-check

# payment-orchestration-service
pnpm --filter @northflow/payment-orchestration-service type-check
```

---

## Phase 8B — Core Contract Adoption

### What changed in Phase 8B

**SDK rename (Task 1)**

The primary public class and error names in `@northflow/payment-orchestration-client-sdk`
were renamed from `PaymentEngine*` to `PaymentOrchestration*`:

| Before (deprecated) | After (primary) |
|---------------------|-----------------|
| `PaymentEngineClient` | `PaymentOrchestrationClient` |
| `PaymentEngineClientError` | `PaymentOrchestrationClientError` |
| `PaymentEngineNetworkError` | `PaymentOrchestrationNetworkError` |
| `PaymentEngineClientConfig` | `PaymentOrchestrationClientConfig` |

Deprecated aliases remain exported for backward compatibility and are marked `@deprecated`.

**Correct SDK usage (Phase 8B+):**

```ts
import { PaymentOrchestrationClient } from '@northflow/payment-orchestration-client-sdk';

const client = new PaymentOrchestrationClient({
  baseUrl: 'http://localhost:5100',
  serviceToken: process.env.PAYMENT_ORCHESTRATION_SERVICE_TOKEN,
  merchantId: 'my-merchant-id',
  sourceApp: 'consumer-a',
});
```

**Core capability contract extension (Task 5)**

`PaymentProviderCapabilities` in `@northflow/payment-orchestration-core` was extended
with three optional fields to align with the embedded `ProviderCapabilities`:

| New optional field | Maps from embedded | Meaning |
|-------------------|--------------------|---------|
| `supportsMultiplePartialRefund?` | `supportsMultiplePartialRefund` | Provider allows multiple partial refunds per tx |
| `canReturnImmediateSuccess?` | `canReturnImmediateSuccess` | Provider may settle synchronously from createPayment() |
| `canReturnImmediateFailure?` | `canReturnImmediateFailure` | Provider may reject synchronously from createPayment() |

**Provider adapter (Task 2/3)**

A new adapter module bridges embedded and core provider contracts:

```text
packages/application/payments/adapters/PaymentProviderCoreAdapter.ts
```

Exported helpers:

```ts
toCoreProviderAction(embedded: ProviderAction): PaymentProviderAction
toCoreProviderActions(embedded: ProviderAction[]): PaymentProviderAction[]
toCoreProviderCapabilities(embedded: ProviderCapabilities): PaymentProviderCapabilities
```

Key mapping decisions:
- `canCancel` → `supportsCancel`, `canRefund` → `supportsRefund` (rename only, no behavior change)
- `url` field in core: set to `value` for `WEB_URL` descriptor, `null` otherwise
- `supportedMethods` in core: always `[]` (embedded has no direct equivalent)
- `expiresAt` and `metadata` from embedded `ProviderAction` are **not** propagated to core DTO
  (core is a portable DTO; callers needing those fields retain the original embedded action)

**tsconfig path alias added**

`@northflow/payment-orchestration-core` was added to:
- `tsconfig.base.json` (inherited by all packages)
- `apps/api/tsconfig.json` (overrides base paths; needs explicit entry)
- `apps/api/tsconfig.node.json` (used by test runner)

**Contract compatibility tests (Task 4)**

```text
apps/api/src/__tests__/payment-orchestration-core-contract-adapter.test.ts
```

14 tests across 4 suites. All pass. Covers:
- FakeGateway: qris, va, redirect, payment_code, immediate_success, immediate_failure
- Xendit (mocked): redirect, QR, VA
- Capability mapping: FakeGateway, Xendit sandbox, Manual
- Edge cases: null value, metadata/expiresAt not propagated

### What did NOT change in Phase 8B

- Runtime traffic: still 100% embedded legacy API (`apps/api`)
- No DB schema additions
- `apps/payment-orchestration-service` remains a skeleton (no real use cases wired)
- Embedded `/api/payment-engine/...` routes remain the runtime source of truth
- FakeGateway scenarios unchanged
- Xendit sandbox adapter behavior unchanged
- Provider codes unchanged (`fake_gateway`, `xendit_sandbox`, `manual`)
- No provider-level refund/cancel
- No POS UI changes; no order adapter
- Legacy order payment flow untouched

---

## Phase 8C — Standalone DB Schema + Repository Boundary

### What changed in Phase 8C

**Standalone schema (Task 1)**

Six new `payment_orchestration_*` tables added to `shared/schema.ts` under a clearly
separated section. These tables are the persistence boundary for the standalone service.
No existing embedded payment engine tables were modified.

| Table | Purpose |
|-------|---------|
| `payment_orchestration_merchants` | Primary merchant identity (standalone, not tenant-bound) |
| `payment_orchestration_provider_accounts` | Links merchants to payment providers (credentials by reference only) |
| `payment_orchestration_intents` | Standalone payment intents with external the legacy system refs |
| `payment_orchestration_transactions` | Individual payment/refund/void transactions |
| `payment_orchestration_provider_events` | Inbound provider webhooks (nullable merchantId until resolved) |
| `payment_orchestration_idempotency_keys` | Idempotency tracking for Phase 8D use cases |

Key design decisions:
- `merchant_id` is the primary owner identity — **not** `tenant_id`
- `external_tenant_id` exists only as a source-app reference (correlation, not ownership)
- `credentials_ref` is an opaque string pointing to env/secret-manager — raw API keys are never stored
- All partial unique indexes applied via Drizzle `uniqueIndex().where()` for correctness
- `payment_orchestration_provider_events.merchant_id` is nullable: real provider webhooks carry no merchant header; backfilled after `provider_reference` resolves to a known transaction

**Migration file (Task 5)**

Migration file generated:

```text
migrations/0022_payment_orchestration_standalone.sql
```

Contains only `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS` statements
for the 6 new `payment_orchestration_*` tables. Does not touch any existing table.

To apply in a dev environment:
```bash
psql $DATABASE_URL -f migrations/0022_payment_orchestration_standalone.sql
# or let the server auto-apply on next startup via runMigrationAsync()
```

**Core repository port interfaces (Task 2)**

Six repository interfaces added to:

```text
packages/payment-orchestration-core/src/application/repositories.ts
```

Exported from `packages/payment-orchestration-core/src/index.ts`:

```ts
PaymentMerchantRepository
PaymentProviderAccountRepository
PaymentIntentRepository
PaymentTransactionRepository
PaymentProviderEventRepository
PaymentIdempotencyRepository
```

All interfaces use `merchantId` as primary owner identity. No `tenantId` in any interface.

**Service infrastructure repository skeletons (Task 3)**

Six skeleton classes created in:

```text
apps/payment-orchestration-service/src/infrastructure/repositories/
  DrizzlePaymentMerchantRepository.ts
  DrizzlePaymentProviderAccountRepository.ts
  DrizzlePaymentIntentRepository.ts
  DrizzlePaymentTransactionRepository.ts
  DrizzlePaymentProviderEventRepository.ts
  DrizzlePaymentIdempotencyRepository.ts
```

All implement the core port interfaces with full method signatures.
Methods throw `Error('Not implemented until Phase 8D')` — this is intentional.
Phase 8D will wire real Drizzle queries.

**DB row ↔ core DTO mappers (Task 4)**

Pure-function mappers in:

```text
apps/payment-orchestration-service/src/infrastructure/repositories/mappers.ts
```

```ts
mapMerchantRow(row: MerchantRow): PaymentMerchant
mapProviderAccountRow(row: ProviderAccountRow): PaymentProviderAccount
mapIntentRow(row: IntentRow): StandalonePaymentIntentDTO
mapTransactionRow(row: TransactionRow): StandalonePaymentTransactionDTO
mapProviderEventRow(row: ProviderEventRow): PaymentProviderEventDTO
mapIdempotencyKeyRow(row: IdempotencyKeyRow): PaymentIdempotencyKeyDTO
```

Rules enforced:
- snake_case DB → camelCase DTO
- `merchantId` preserved in all standalone DTOs
- No `tenantId` in any mapper output
- Nullable fields defaulted explicitly (`?? null`, `?? {}`)
- `credentialsRef` preserved as opaque string; never stripped

**Tests (Task 6)**

```text
apps/api/src/__tests__/payment-orchestration-schema-mappers.test.ts
```

56 tests across 7 suites. **All pass.** No live DB required.

Covers all 7 acceptance criteria from the prompt:
1. Merchant row → `PaymentMerchant` with `id`/`displayName`
2. Provider account row → no raw credentials exposed
3. Intent row → all 6 external ref fields mapped correctly
4. Transaction row → provider ref/action fields mapped safely
5. Provider event row → nullable `merchantId` supported before resolution
6. Idempotency key row → status/resource snapshot mapped correctly
7. No mapper output includes `tenantId`

### What did NOT change in Phase 8C

- No existing embedded `payment_engine_*`, `payment_intents`, `payment_transactions`,
  `payment_allocations`, or `payment_provider_events` tables modified
- No legacy order payment flow touched (`/api/orders/:id/payments`, `order_payments` table)
- `apps/payment-orchestration-service` routes remain 501 skeleton — no real use cases wired
- Embedded `/api/payment-engine/...` remains the runtime source of truth for all live payments
- FakeGateway behavior unchanged
- Xendit sandbox adapter behavior unchanged
- No provider-level refund/cancel implemented
- No POS UI changes; no order adapter; no split bill; no customer ledger
- No client SDK consumption (Phase 8E)

---

## Phase 8D — Real Use-Case Wiring

### What changed in Phase 8D

Phase 8D upgrades the standalone service from a Phase 8A skeleton (all `/v1/...` routes → 501) to a fully functional payment microservice.

#### Foundation
- `src/config/env.ts` — added `dbUrl` (resolves `PAYMENT_ORCHESTRATION_DATABASE_URL` → `DATABASE_URL`), phase updated to `'8D'`
- `src/infrastructure/db.ts` — `createPoDb(dbUrl)`: Drizzle/postgres.js connection, pool max 3, `prepare: false` for NeonDB/PgBouncer compatibility
- `src/infrastructure/providers/StandaloneFakeGatewayProvider.ts` — 7-scenario FakeGateway (qris, redirect, va, payment_code, immediate_success, immediate_failure, pending_expiry)
- `src/infrastructure/providers/providerRegistry.ts` — registers FakeGateway in non-production; empty in production
- `src/middleware/auth.ts` — dual-header service token: `x-payment-orchestration-service-token` (primary) + `x-payment-engine-service-token` (compat alias)
- `src/middleware/errors.ts` — global Express error handler, sanitizes 5xx messages

#### Real Repository Implementations (6 files)
All 6 `Drizzle*Repository.ts` files now execute real Drizzle ORM queries against `payment_orchestration_*` tables. Uses `as any` cast at mapper call sites to bridge Drizzle's `unknown`-typed jsonb columns.

#### Use Cases (9 files — updated Phase 8E)
| Class | Key rule |
|-------|----------|
| `CreateMerchant` | Idempotent: returns existing if `sourceApp+externalRef` match |
| `CreateProviderAccount` | Verifies merchant exists (404 if not) |
| `CreatePaymentIntent` | Validates positive integer amountDue; supports idempotency key |
| `CreateGatewayPayment` | Rejects overpayment (`OVERPAYMENT_REJECTED`); updates intent immediately on `succeeded` |
| `ConfirmFakeGatewayPayment` | Dev-only (`FORBIDDEN_IN_PRODUCTION` in production); atomic conditional UPDATE (Phase 8D.1) |
| `GetPaymentIntentStatus` | Returns `isTerminal`, `requiresAction`, `canRetryPayment` computed fields |
| `GetRefundability` | Sums succeeded incoming txns minus outgoing refund txns by `parentTransactionId` |
| `HandleProviderWebhook` | Phase 8E: parses FakeGateway webhook, deduplicates by `event_id`, atomically updates TX+intent |
| `ReconcilePaymentIntentTotals` | Phase 8E: recomputes intent totals from actual TX state; manual crash-recovery safety tool |
| `intentStatusHelper.ts` | `computeIntentStatus(amountDue, amountPaid)`: 0→requires_payment, partial→partially_paid, equal→paid, over→overpaid |

#### Routes (updated Phase 8E)
| Method | Path | Auth | Notes |
|--------|------|------|-------|
| POST | `/v1/merchants` | service token | CreateMerchant |
| GET | `/v1/merchants/:id` | service token | Direct repo read |
| POST | `/v1/merchants/:merchantId/provider-accounts` | service token | CreateProviderAccount |
| GET | `/v1/merchants/:merchantId/provider-accounts/:id` | service token | Direct repo read |
| POST | `/v1/payment-intents` | service token | CreatePaymentIntent |
| GET | `/v1/payment-intents/:id/status` | service token | GetPaymentIntentStatus |
| GET | `/v1/payment-intents/:id/refundability` | service token | GetRefundability |
| POST | `/v1/payment-intents/:id/gateway-payments` | service token | CreateGatewayPayment |
| POST | `/v1/payment-intents/:id/reconcile` | service token | ReconcilePaymentIntentTotals (Phase 8E) |
| POST | `/v1/webhooks/:provider` | **none** (provider sig) | HandleProviderWebhook — bypasses service-token auth (Phase 8E) |
| POST | `/v1/dev/fake-gateway/transactions/:id/confirm` | service token | ConfirmFakeGatewayPayment (non-prod only) |

**Webhook route auth bypass (Phase 8E):**  
`POST /v1/webhooks/:provider` is registered in `app.ts` **before** `app.use('/v1', auth)` so it does NOT require a service token. Provider identity is verified via payload signature inside each webhook handler (`FakeGatewayWebhookHandler`). This is intentional — payment providers push events server-to-server without knowledge of the service token.

- FakeGateway unsigned webhook is **dev/test convenience only** (no secret configured).
- Production FakeGateway webhook **requires** `PAYMENT_ORCHESTRATION_FAKEGATEWAY_WEBHOOK_SECRET` env var.
- Missing header when secret is configured → `WEBHOOK_SIGNATURE_MISSING` (401).
- Wrong signature → `WEBHOOK_SIGNATURE_INVALID` (401).
- No secret in production → `WEBHOOK_SECRET_REQUIRED` (403).

All other `/v1/...` routes remain service-token protected.

#### SDK
`@northflow/payment-orchestration-client-sdk` updated with 5 new methods: `createMerchant`, `getMerchant`, `createProviderAccount`, `getProviderAccount`, `confirmFakeGatewayPayment`. 6 new request/response types exported.

#### Tests
`apps/api/src/__tests__/payment-orchestration-service-fakegateway-flow.test.ts` — 14 scenarios, in-memory repos, real use-case classes. All 14 pass. Run:
```bash
npx tsx --tsconfig apps/api/tsconfig.node.json --test \
  apps/api/src/__tests__/payment-orchestration-service-fakegateway-flow.test.ts
```

### What did NOT change in Phase 8D
- Embedded legacy payment engine (`apps/api/src/payment-engine/`) — still active
- Xendit/real provider wiring — Phase 8F+
- No Drizzle migrations auto-run at startup; run manually via `psql $DATABASE_URL -f migrations/...`
- No POS UI changes

---

### Phase 8D.1 + 8E — Atomic Confirm + Webhook Ingestion + Reconciliation

**Phase 8D.1 — Atomic Confirm (TOCTOU fix):**
- `ConfirmFakeGatewayPayment` now uses `markSucceededIfConfirmable()` — a conditional `UPDATE … WHERE status IN ('requires_action','pending') RETURNING *`.
- Two concurrent confirms cannot both succeed: the first caller gets `changed=true` and updates intent totals; the second gets `changed=false` and detects the already-confirmed state idempotently.
- Failed idempotency-key policy: `CreateGatewayPayment` throws `IDEMPOTENCY_PREVIOUSLY_FAILED` (409) when the existing key has `status=failed`; client must supply a new key.

**Phase 8E — Standalone Webhook Ingestion:**
- `POST /v1/webhooks/fake_gateway` implemented via `HandleProviderWebhook` + `FakeGatewayWebhookHandler`.
- Webhook route registered **before** service-token auth middleware — no service token required.
- Provider verification via optional HMAC SHA-256 signature (`x-fakegateway-signature` header); `timingSafeEqual` used for constant-time comparison.
- Idempotent by `event_id`: duplicate events return `idempotentReplay=true` and do not re-credit the intent.
- Merchant resolved from `providerReference → TX → intentId → merchantId`; `x-payment-merchant-id` request header is ignored in webhook flow to prevent header-spoofing.

**Phase 8E — Reconciliation Safety:**
- `ReconcilePaymentIntentTotals` use case recomputes intent totals from actual transaction state.
- Fixes drift caused by crash between `TX succeeded` and `intent totals/status` update.
- Not a scheduled worker — called explicitly via `POST /v1/payment-intents/:id/reconcile` (service-token protected) or programmatically after crash recovery.
- Returns `before`/`after` snapshots and `changed: boolean`.
- No scheduled reconciliation cron yet (Phase 8F+).

**What did NOT change in Phase 8D.1 + 8E:**
- Embedded legacy payment engine — unchanged.
- Legacy order payment flow — unchanged.
- No client SDK consumption yet.
- No Midtrans/Stripe adapter.
- No provider-level refund/cancel.
- No scheduled cron/worker.
- No live Xendit dependency added.

---


## Phase 8F — Standalone Readiness + Parity Closure

Phase 8F audits embedded the legacy system payment-engine capabilities against the standalone Northflow Payment Orchestration runtime and closes small safe parity gaps without integrating the legacy system with the SDK.

### Phase 8F Artifacts

| Artifact | Purpose |
|---|---|
| `docs/reports/payment-orchestration-phase-8f-parity-matrix.md` | Capability-by-capability embedded vs standalone parity matrix. |
| `docs/reports/payment-orchestration-phase-8f-readiness-decision.md` | Explicit readiness decision for the next integration phase. |
| `docs/reports/payment-orchestration-phase-8f-standalone-readiness-report.md` | Final inventory, commands run, limitations, and guardrail confirmations. |

### What Is Ready

- Standalone FakeGateway development flow: merchant, provider account, intent, gateway payment, dev confirm, webhook, status, refundability, and reconciliation.
- Service-token auth for `/v1` routes, with webhook auth bypass only for provider-signed webhook routes.
- Merchant-scoped standalone data model using `merchantId` plus `sourceApp`/`externalTenantId`/external payable references.
- SDK coverage for existing FakeGateway/dev service routes remains useful, but source-application integration is deferred until standalone extraction readiness is proven.
- Smoke and report documentation sufficient for a controlled FakeGateway/dev integration phase.

### What Is Not Ready

- Production provider migration is not ready.
- Provider-level refund/cancel is not implemented in standalone.
- Full schema relocation out of `shared/schema.ts` is not complete; Phase 8I adds a service-local bridge only.
- Provider-event replay adapters are not implemented; Phase 8I safely skips unsafe reprocess attempts.
- API/error contract freeze and deployment readiness still need hardening.

### Deferred Phases

| Phase | Deferred Work |
|---|---|
| 8G+8H | Boundary Purity + Provider Runtime Completion. |
| 8I | Operations Layer + Runtime Readiness. |
| 8J | SDK/API Contract Freeze + Deployment Readiness. |
| 8K | Extraction Simulation. |
| 8L | Extract to Standalone Repo/Package. |
| 8M | Integrate consumer backends after extraction simulation is stable. |

### Explicit Integration Warning

client SDK integration is **not performed before extraction readiness**. Phase 8F and later 8G/8H/8I work close standalone parity, provider runtime, and operations gaps first. The embedded payment runtime and legacy order payment flow remain intentionally unchanged.

### Phase 8F Readiness Decision

```text
READY_FOR_STANDALONE_EXTRACTION_PREPARATION
```

This historical Phase 8F decision has been superseded by the standalone-first roadmap. Source applications integrate only after service/package boundary, provider runtime, operations, and extraction simulation are stable.

---

## Next Phases

| Phase | Description |
|-------|-------------|
| 8D    | ✅ Full use-case wiring in payment-orchestration-service |
| 8D.1  | ✅ Atomic confirm (TOCTOU fix) + failed-key policy |
| 8E    | ✅ Standalone webhook ingestion + reconciliation safety + hardening |
| 8F    | ✅ Standalone Readiness + Parity Closure |
| 8G+8H | ✅ Boundary Purity + Provider Runtime Completion |
| 8I    | ✅ Operations Layer + Runtime Readiness |
| 8J    | SDK/API Contract Freeze + Deployment Readiness |
| 8K    | Extraction Simulation |
| 8L    | Extract to Standalone Repo/Package |
| 8M    | Integrate consumer backends |

---

## Phase 8G+8H — Boundary Purity + Provider Runtime Completion

Phase 8G+8H moves the near-term target from consumer integration readiness to standalone extraction readiness. The standalone-first decision labels are now:

```text
STANDALONE_BOUNDARY_AND_PROVIDER_RUNTIME_READY
NOT_READY_BOUNDARY_LEAKS
NOT_READY_PROVIDER_RUNTIME_GAPS
NOT_READY_RUNTIME_TEST_FAILURES
```

### Boundary Updates

- `packages/payment-orchestration-core`, `packages/payment-orchestration-client-sdk`, and `apps/payment-orchestration-service` were audited for forbidden legacy runtime coupling.
- Runtime source has no `@pos/*`, `apps/api`, embedded payment-provider, order, session, or frontend imports.
- The known extraction blocker is schema ownership: the service-local schema bridge still re-exports `payment_orchestration_*` Drizzle tables from `shared/schema.ts` while the service remains inside the legacy monorepo.
- The schema extraction plan is documented in `docs/reports/payment-orchestration-schema-extraction-plan.md`.

### Provider Runtime Updates

- A standalone provider runtime contract now covers create payment, webhook parsing, status polling, capability flags, provider actions, and provider errors.
- `fake_gateway` remains dev/test only and supports deterministic polling plus webhook ingestion.
- `xendit_sandbox` now has an isolated standalone sandbox provider with injectable HTTP client, opaque `credentialsRef` secret resolution, sanitized raw provider responses, webhook parser/verifier, and mocked tests.
- `POST /v1/payment-transactions/:id/refresh-provider-status` provides service-token protected on-demand polling foundation. It is not a scheduled worker.
- Provider refund/cancel is contract/design only in this phase; no real provider refund/cancel money movement is implemented.

### Standalone-First Roadmap

| Phase | Target |
|---|---|
| 8G+8H | Boundary Purity + Provider Runtime Completion |
| 8I | Operations Layer + Worker Readiness |
| 8J | SDK/API Contract Freeze + Deployment Readiness |
| 8K | Extraction Simulation |
| 8L | Extract to Standalone Repo/Package |
| 8M | Integrate consumer backends |

client SDK consumption and embedded runtime deprecation are explicitly deferred until after standalone extraction readiness is proven.

## Phase 8I Update — Standalone Runtime Readiness + Operations Layer

Phase 8I keeps the roadmap standalone-first:

| Phase | Focus |
|---|---|
| 8I | Operations Layer + Runtime Readiness |
| 8J | SDK/API Contract Freeze + Deployment Readiness |
| 8K | Extraction Simulation |
| 8L | Extract to Standalone Repo/Package |
| 8M | Integrate consumer backends |

Standalone extraction comes first. Source applications integrate only after the service/package boundary, provider runtime, operations, and extraction simulation are stable.

### Runtime readiness endpoint

The standalone service now exposes:

```text
GET /ready
```

The response contains non-secret readiness metadata only:

```json
{
  "ok": true,
  "service": "payment-orchestration-service",
  "providers": {
    "fake_gateway": { "registered": true, "configured": true, "enabled": true },
    "xendit_sandbox": { "registered": true, "configured": false, "enabled": false }
  },
  "database": "configured",
  "xenditSandbox": {
    "enabled": false,
    "callbackTokenConfigured": true
  }
}
```

No service token, database URL, callback token, provider secret, or raw environment value is returned.

### Xendit sandbox runtime policy

Xendit sandbox HTTP is disabled unless explicitly enabled by environment:

| Environment variable | Purpose |
|---|---|
| `PAYMENT_ORCHESTRATION_XENDIT_SANDBOX_ENABLED` | Must be `true` before the standalone runtime uses native `fetch` for Xendit sandbox HTTP. Any other value keeps HTTP disabled. |
| `PAYMENT_ORCHESTRATION_XENDIT_BASE_URL` | Optional base URL. Defaults to `https://api.xendit.co`. |
| `PAYMENT_ORCHESTRATION_XENDIT_CALLBACK_TOKEN` | Optional webhook callback token. Read only for verification/configured status; never returned by `/ready`. |

`credentialsRef` continues to be an opaque environment variable name stored in provider-account rows. The provider resolves `process.env[credentialsRef]` at runtime and does not persist raw credentials.

When Xendit sandbox HTTP is disabled, provider create/status calls fail with stable code:

```text
PROVIDER_HTTP_CLIENT_UNCONFIGURED
```

Tests inject mock HTTP clients and do not call live Xendit endpoints.

### Schema boundary module

The service now owns a local schema import boundary at:

```text
apps/payment-orchestration-service/src/infrastructure/schema.ts
```

For Phase 8I this is a low-risk re-export bridge from `shared/schema.ts`, not a full schema relocation. Standalone repositories import payment-orchestration tables through this service-local module so extraction simulation has one boundary to replace later.

### Operations use cases and workers

Phase 8I adds operations foundations callable without starting Express:

```text
apps/payment-orchestration-service/src/application/use-cases/ExpireStalePaymentTransactions.ts
apps/payment-orchestration-service/src/application/use-cases/ReprocessProviderEvents.ts
apps/payment-orchestration-service/src/workers/reconcile.ts
apps/payment-orchestration-service/src/workers/expireStale.ts
```

No cron scheduler is registered in this phase. Future deployments may schedule these worker modules via platform cron, queue workers, or a process supervisor after extraction simulation validates runtime packaging.

Known limitation: provider-event reprocess does not reconstruct signed provider raw bodies or double-apply provider mutations. It safely skips events without replayable parsed payload or without a provider-specific replay adapter and returns summary counts/reasons.

## Phase 8J standalone extraction completion

Phase 8J promotes the standalone service schema from a re-export bridge to service-local ownership:

- `apps/payment-orchestration-service/src/infrastructure/schema.ts` is now the source of truth for `payment_orchestration_*` Drizzle table definitions.
- Root `shared/schema.ts` retains compatibility definitions for current monorepo type-checks and existing root migrations, but standalone repositories import the service-local schema module.
- Standalone migration ownership starts at `apps/payment-orchestration-service/migrations/0001_payment_orchestration_initial.sql`; the root migration `migrations/0023_payment_orchestration_transaction_expires_at.sql` is compatibility-only.
- Payment transactions now have transaction-level `expiresAt`; operations expire pending/requires_action transactions by transaction expiry first, then fall back to intent-level expiry.
- Verified webhook payloads are persisted as `parsedPayload` for safe reprocess. Reprocess supports stored `fake_gateway` and `xendit_sandbox` payloads without re-verifying signatures and skips already processed events to avoid double credit.
- `apps/payment-orchestration-service/src/workers/run.ts` provides a no-Express JSON worker runner for `expire-stale`, `reconcile-intent`, `reprocess-provider-events`, and `all-safe`.
- `scripts/payment-orchestration-extraction-check.ts` simulates extraction guardrails for forbidden imports, schema ownership, migrations, worker entry points, ready endpoint, package files, and unwanted build/log/assets.

Final Phase 8J decision: `READY_TO_EXTRACT_TO_STANDALONE_REPO`. Next phase: `8K — SDK/API Contract Freeze + Deployment Readiness`.
