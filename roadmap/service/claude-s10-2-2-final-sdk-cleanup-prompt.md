# Claude Prompt — S10.2.2 Final SDK Cleanup Patch

Work in `northflow-payment-orchestration`.

This patch fixes the remaining issues after S10.2.1. S10.2.1 removed most duplicate SDK/core/service compatibility surfaces, but review found remaining active SDK/core documentation noise and one public SDK auth fallback that should not remain before launch.

Northflow is not live yet. Keep the contract strict and clean.

## Hard Rules

- Do not add features.
- Do not add dashboard work.
- Do not change database schema.
- Do not rename provider codes.
- Do not change route behavior.
- Do not change HMAC canonical format.
- Provider codes remain exactly: `manual`, `fake_gateway`, `xendit_sandbox`.

## Problem Summary

Fix these remaining issues:

1. `serviceToken` still exists in merchant-facing SDK config and is marked deprecated/legacy.
2. `client.ts` still injects `x-payment-orchestration-service-token` when `apiKey` is missing.
3. Active core comments still mention legacy embedded terminology.
4. SDK index docs still say the SDK has no core dependency even though `client.ts` imports canonical signing helpers from core.
5. SDK index example still uses non-generic `consumer-b` naming and tenant-oriented idempotency text.
6. Validation report must be updated after cleanup.

## Task A — Remove serviceToken from public SDK

Files:

- `packages/client-sdk/src/types.ts`
- `packages/client-sdk/src/client.ts`
- `packages/client-sdk/src/index.ts`
- SDK tests
- current docs/examples

Required changes:

- Remove `serviceToken?: string` from `PaymentOrchestrationClientConfig`.
- Remove `x-payment-orchestration-service-token` header injection from SDK client.
- SDK public auth must be `apiKey` plus optional HMAC signing only.
- Update tests/docs/examples to use `apiKey` only.
- Do not remove internal service runtime env/config if the service still uses it. This task is only merchant-facing SDK cleanup.

## Task B — Remove active legacy wording from core comments

Files:

- `packages/core/src/domain/PaymentIntent.ts`
- `packages/core/src/domain/PaymentTransaction.ts`
- any active core file with similar wording

Replace comments like:

- `legacy tenantId`
- `legacy embedded statuses`
- `legacy payments domain`
- `legacy-specific fields`

with current neutral wording:

- `merchantId as owner identity`
- `Northflow-owned status union`
- `external payable references`
- `consumer application fields`

Do not change runtime types or status values.

## Task C — Fix SDK index documentation

File:

- `packages/client-sdk/src/index.ts`

Required changes:

- Remove the stale claim that SDK has no `@northflow/payment-orchestration-core` dependency.
- Mention that the SDK uses core canonical request helpers for request signing.
- Replace `consumer-b`, `tenant-1`, and named sample source-app text with generic examples such as:
  - `checkout-backend`
  - `order_456`
  - `order:order_456:create-intent`

## Task D — Re-run searches

Search active code/tests/current docs/examples/scripts for:

- `serviceToken`
- `x-payment-orchestration-service-token` inside `packages/client-sdk`
- `@deprecated` inside `packages/client-sdk`
- `legacy` inside `packages/core/src` and `packages/client-sdk/src`
- `consumer-b`
- `tenant-1`

Expected:

- No public SDK config or SDK client usage of `serviceToken`.
- No SDK `x-payment-orchestration-service-token` injection.
- No active core/client-sdk comments presenting legacy wording.
- No `consumer-b` / `tenant-1` example in SDK public docs.

Historical roadmap/prompt/report files may still contain old terms as past context.

## Task E — Tests and validation

Update or add tests if existing tests assert `serviceToken` support. Tests must now assert public SDK auth uses `apiKey` and optional signing only.

Create or update:

`.agents/memory/s10-2-2-final-sdk-cleanup-validation.md`

Include:

- files changed
- what was removed
- searches run and results
- commands run
- type-check results
- test results
- provider codes unchanged confirmation
- no route/db/schema change confirmation
- remaining issues

## Required Commands

Run:

- `pnpm --filter @northflow/payment-orchestration-core type-check`
- `pnpm --filter @northflow/payment-orchestration-client-sdk type-check`
- `pnpm --filter @northflow/payment-orchestration-service type-check`
- `pnpm test`

Commit and push all changes.
