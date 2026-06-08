# S10.2.2 Final SDK Cleanup Validation

Date: 2026-06-08

## Files changed

- `packages/client-sdk/src/types.ts`
- `packages/client-sdk/src/client.ts`
- `packages/client-sdk/src/index.ts`
- `packages/core/src/domain/PaymentIntent.ts`
- `packages/core/src/domain/PaymentTransaction.ts`
- `packages/core/src/domain/PaymentMerchant.ts`
- `packages/core/src/domain/PaymentErrors.ts`
- `packages/core/src/application/contracts.ts`
- `packages/core/src/application/repositories.ts`
- `packages/core/src/providers/providerActions.ts`
- `packages/core/src/index.ts`
- `docs/payment-orchestration-sdk-contract.md`
- `docs/openapi/payment-orchestration.openapi.json`
- `docs/payment-orchestration.openapi.json`
- `tests/payment-orchestration-client-sdk.test.ts`
- `tests/payment-orchestration-8k-contract-freeze.test.ts`
- `tests/payment-orchestration-s7-client-integration-smoke.test.ts`

## What was removed

- Removed merchant-facing `PaymentOrchestrationClientConfig.serviceToken` from the client SDK public config type.
- Removed SDK client injection of `x-payment-orchestration-service-token` when `apiKey` is absent.
- Removed SDK `@deprecated` public JSDoc in `packages/client-sdk`.
- Removed stale SDK documentation claiming no core dependency; SDK docs now state request signing uses core canonical request helpers.
- Removed public SDK examples using `consumer-b` / `tenant-1`; examples now use `checkout-backend`, `order_456`, and `order:order_456:create-intent`.
- Replaced active core comments that described Northflow concepts in legacy embedded terminology with neutral current wording.
- Updated current SDK/OpenAPI docs to present `Authorization: Bearer <apiKey>` as protected route auth.

## Searches run and results

Command group:

```bash
rg -n "serviceToken" packages/client-sdk/src packages/core/src tests docs examples scripts --glob '!roadmap/**' --glob '!docs/reports/**' || true
rg -n "x-payment-orchestration-service-token" packages/client-sdk || true
rg -n "@deprecated" packages/client-sdk || true
rg -n "legacy" packages/core/src packages/client-sdk/src || true
rg -n "consumer-b" packages/client-sdk/src docs/payment-orchestration-sdk-contract.md docs/integration examples tests/s10-2-* roadmap/service/main.md 2>/dev/null || true
rg -n "tenant-1" packages/client-sdk/src docs/payment-orchestration-sdk-contract.md docs/integration examples tests/s10-2-* roadmap/service/main.md 2>/dev/null || true
```

Results:

- `serviceToken`: no occurrences in `packages/client-sdk/src`; remaining occurrences are service runtime config/tests only.
- `x-payment-orchestration-service-token` inside `packages/client-sdk`: no matches.
- `@deprecated` inside `packages/client-sdk`: no matches.
- `legacy` inside `packages/client-sdk/src`: no matches.
- `legacy` inside `packages/core/src`: only the runtime audit actor value `packages/core/src/domain/AuditLog.ts:10: | 'legacy_client'`; no active core comments retain legacy embedded terminology.
- `consumer-b` in SDK public docs/examples checked above: no matches. Older S7 tests still retain synthetic consumer labels as historical smoke-test data.
- `tenant-1` in SDK public docs/examples checked above: no matches.

## Commands run

- `pnpm install` — completed successfully to restore workspace dependencies; emitted peer/build-script warnings but installed dependencies.
- `pnpm --filter @northflow/payment-orchestration-core type-check` — pass.
- `pnpm --filter @northflow/payment-orchestration-client-sdk type-check` — pass.
- `pnpm --filter @northflow/payment-orchestration-service type-check` — initially failed before install because service dependencies were missing; passed after `pnpm install`.
- `pnpm test` — pass: 495 tests passed, 0 failed.

## Type-check results

- Core package: pass.
- Client SDK package: pass.
- Service package: pass after dependency installation.

## Test results

- Full workspace test command `pnpm test`: pass (`# tests 495`, `# pass 495`, `# fail 0`).

## Provider codes unchanged confirmation

Confirmed provider code declarations remain exactly:

- `apps/service/src/infrastructure/providers/ManualProvider.ts`: `manual`
- `apps/service/src/infrastructure/providers/FakeGatewayProvider.ts`: `fake_gateway`
- `apps/service/src/infrastructure/providers/XenditSandboxProvider.ts`: `xendit_sandbox`

## No route/db/schema change confirmation

- No route files were modified.
- No DB migration files were modified.
- No schema files were modified.
- HMAC canonical request helpers and signing format were not changed.

## Remaining issues

- No S10.2.2 cleanup issues remain.
- Internal service runtime `serviceToken` configuration and tests remain intentionally unchanged because this patch only removes the merchant-facing SDK fallback.
- `legacy_client` remains as an audit actor runtime value and was not renamed to avoid changing runtime values.
