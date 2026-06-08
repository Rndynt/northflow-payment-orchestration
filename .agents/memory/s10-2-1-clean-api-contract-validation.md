# S10.2.1 Clean API Contract Validation

Date: 2026-06-08

## Files changed

- `packages/client-sdk/src/client.ts`
- `packages/client-sdk/src/index.ts`
- `packages/client-sdk/src/errors.ts`
- `packages/client-sdk/src/types.ts`
- `packages/core/src/domain/PaymentIntent.ts`
- `packages/core/src/domain/PaymentTransaction.ts`
- `packages/core/src/application/ports.ts`
- `packages/core/src/application/domain.ts`
- `packages/core/src/index.ts`
- `apps/service/src/infrastructure/providers/PaymentProviderAdapter.ts`
- `apps/service/src/infrastructure/providers/FakeGatewayProvider.ts`
- `apps/service/src/infrastructure/providers/ManualProvider.ts`
- `scripts/extraction-check.ts`
- `docs/payment-orchestration-sdk-contract.md`
- `docs/payment-orchestration-hybrid-standalone-architecture.md`
- `docs/integration/client-integration-contract.md`
- `tests/s10-2-sdk-integration-contract.test.ts`
- `tests/s10-2-1-clean-api-contract.test.ts`

## Files removed

- `apps/service/src/infrastructure/providers/StandalonePaymentProvider.ts`
- `apps/service/src/infrastructure/providers/StandaloneManualProvider.ts`
- `apps/service/src/infrastructure/providers/StandaloneFakeGatewayProvider.ts`

## Removed aliases and compatibility APIs

- Removed SDK refund/void method aliases:
  - `refundTransaction`
  - `voidTransaction`
- Removed SDK `PaymentEngine*` aliases:
  - `PaymentEngineClient`
  - `PaymentEngineClientError`
  - `PaymentEngineNetworkError`
  - `PaymentEngineClientConfig`
- Removed provider-account method providerAccountId-first overloads.
- Removed SDK provider/merchant ID guessing helpers:
  - `resolveMerchantProviderAccountArgs`
  - `resolveDeleteProviderAccountMethodArgs`
  - `isLikelyMerchantId`
  - `isLikelyProviderAccountId`
- Removed active core `Standalone*` aliases from payment intent, payment transaction, ports, application domain exports, and core index exports.
- Removed service provider `Standalone*` aliases and shim files.

## Final SDK provider account method list

The client SDK keeps only merchantId-first provider account method APIs:

- `listProviderAccountMethods(merchantId, providerAccountId)`
- `upsertProviderAccountMethod(merchantId, providerAccountId, input)`
- `deleteProviderAccountMethod(merchantId, providerAccountId, method)`
- `syncProviderAccountMethods(merchantId, providerAccountId)`

## serviceToken audit

- Public merchant SDK documentation now presents `apiKey` and optional request signing as the public integration path.
- `serviceToken` remains in the SDK config only for internal/legacy service-token callers and is documented as such in the SDK contract header table.

## Provider codes unchanged

Provider code strings remain unchanged:

- `manual`
- `fake_gateway`
- `xendit_sandbox`

## Route / DB / schema confirmation

- No route changes were made.
- No database schema changes were made.
- No migration files were added or modified.
- No HMAC canonical format changes were made.
- No provider code rename was made.

## Commands run and results

- PASS: `pnpm --filter @northflow/payment-orchestration-core type-check`
- PASS: `pnpm --filter @northflow/payment-orchestration-client-sdk type-check`
- WARN: `pnpm --filter @northflow/payment-orchestration-service type-check` initially failed because workspace dependencies were missing before install.
- PASS: `pnpm install`
- PASS: `pnpm --filter @northflow/payment-orchestration-service type-check`
- PASS: `pnpm test`
- PASS: `pnpm --filter @northflow/payment-orchestration-core type-check && pnpm --filter @northflow/payment-orchestration-client-sdk type-check && pnpm --filter @northflow/payment-orchestration-service type-check`
- PASS: `pnpm extraction-check`
