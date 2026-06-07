# Legacy Payment Parity Migration Report

Date: 2026-06-06

## Files changed

- `apps/service/src/application/use-cases/RefundPaymentTransaction.ts`
- `apps/service/src/application/use-cases/VoidPaymentTransaction.ts`
- `apps/service/src/routes/transactions.ts`
- `apps/service/src/infrastructure/providers/PaymentProviderAdapter.ts`
- `apps/service/src/infrastructure/repositories/DrizzlePaymentTransactionRepository.ts`
- `packages/core/src/application/repositories.ts`
- `packages/client-sdk/src/client.ts`
- `packages/client-sdk/src/types.ts`
- `packages/client-sdk/src/index.ts`
- `tests/payment-orchestration-client-sdk.test.ts`
- `tests/payment-orchestration-refund-void-parity.test.ts`
- `docs/openapi/payment-orchestration.openapi.json`
- `docs/payment-orchestration.openapi.json`
- API/SDK/error/smoke/README docs
- `scripts/extraction-check.ts`
- this report and the parity matrix

## Blockers fixed

1. SDK refund/void methods and types added.
2. Refund idempotency now checks existing merchant/key transaction rows before creating refunds.
3. Refund same-key/same-parent replay returns `idempotentReplay: true`; same key/different context returns `IDEMPOTENCY_CONFLICT`.
4. Void route/use case accepts `idempotencyKey`, persists it on cancellation, and replays matching already-cancelled transactions.
5. Non-manual providers without `refundPayment()` / `cancelPayment()` now return `PROVIDER_REFUND_UNSUPPORTED` / `PROVIDER_CANCEL_UNSUPPORTED` instead of silently succeeding.
6. OpenAPI/API/SDK/error/smoke docs now describe refund/void endpoints, idempotency, error envelope, and provider fallback policy.
7. Extraction check validates refund/void use cases, provider contract methods, SDK methods/types, OpenAPI paths, parity reports, docs unsupported behavior, and legacy import purity.

## Remaining limitations

- Full refund/void race safety relies on the existing database unique index on `(merchant_id, idempotency_key)` because the current repository port does not expose a transaction/lock primitive.
- Xendit sandbox refund/cancel remains unsupported until a real/safe sandbox adapter method is implemented.
- Standalone repository sync is not claimed until a commit is pushed to `https://github.com/Rndynt/northflow-payment-orchestration.git`.
- Legacy payment code was intentionally not deleted in this phase.

## Validation commands and results

| Command | Result | Notes |
| --- | --- | --- |
| `pnpm install` | Passed | Installed standalone workspace dependencies; pnpm warned about ignored esbuild build scripts. |
| `pnpm check` | Passed | Initial pre-install run failed because `turbo` was missing; passed after install and tsconfig compatibility updates. |
| `pnpm build` | Passed | Turbo warned no output files because service build is no-emit type check. |
| `pnpm test` | Passed | 210 tests passed. |
| `pnpm extraction-check` | Passed | 96 checks passed. |
| `pnpm --filter @northflow/payment-orchestration-core type-check` | Passed | No errors. |
| `pnpm --filter @northflow/payment-orchestration-client-sdk type-check` | Passed | No errors. |
| `pnpm --filter @northflow/payment-orchestration-service type-check` | Passed | No errors. |
| `npm run check` from legacy root | Passed | 13/13 packages successful. |

## Standalone sync status

Partially complete. The standalone repo was cloned and a local standalone commit was created: `aef58a5f3350ab8e2190dd665a3c31e50bd9d027` (`fix: complete legacy payment parity hardening`). Push failed because the environment has no GitHub credentials: `fatal: could not read Username for 'https://github.com': No such device or address`. Do not claim standalone sync until this commit is pushed successfully.

## Final decision

`NOT_READY_STANDALONE_SYNC_BLOCKER`

Reason: in-folder SDK/idempotency/provider/docs parity has been implemented, but standalone repository sync has not been proven.
