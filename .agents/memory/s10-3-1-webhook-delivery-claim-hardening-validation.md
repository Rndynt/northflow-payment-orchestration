# S10.3.1 Webhook Delivery Claim Hardening Validation

- Timestamp: 2026-06-08T18:32:43Z
- Commit checked before changes: `33df140a1bc4692b7fca75b2982cd794991b4040`

## Files changed

- `apps/service/src/infrastructure/repositories/DrizzleMerchantWebhookDeliveryRepository.ts`
- `tests/s10-3-merchant-outbound-webhooks.test.ts`
- `docs/integration/merchant-outbound-webhooks.md`
- `docs/integration/webhook-signature-verification.md`
- `.agents/memory/s10-3-1-webhook-delivery-claim-hardening-validation.md`

## Exact `claimDue` bug found

`DrizzleMerchantWebhookDeliveryRepository.claimDue` updated every due row with status `queued` or `failed` and `nextAttemptAt <= now`, set all of them to `delivering`, incremented every due row's `attemptCount`, and only then returned `rows.slice(0, input.limit)`. With many due rows, this could mark rows outside the worker batch as `delivering` without processing them.

## Chosen SQL/Drizzle fix strategy

Used a single raw PostgreSQL statement through the existing Drizzle DB adapter:

1. CTE `due` selects only due delivery IDs.
2. The CTE applies deterministic ordering by `next_attempt_at ASC`, `created_at ASC`, `id ASC`.
3. The CTE applies `LIMIT ${limit}` before the update.
4. The CTE uses `FOR UPDATE SKIP LOCKED` so concurrent workers do not claim the same rows on PostgreSQL.
5. The outer `UPDATE ... FROM due` updates only selected IDs and returns only updated rows with camelCase aliases for existing DTO mapping.

## Regression tests added

- Added a focused Drizzle repository regression test that simulates at least three due deliveries, calls `claimDue({ limit: 1 })`, asserts one returned row, asserts only one row becomes `delivering`, and asserts the other due rows remain `queued`/`failed` with unchanged attempt counts.
- Added source-shape assertions that the Drizzle repository uses a `WITH due` CTE, SQL `LIMIT`, `FOR UPDATE SKIP LOCKED`, and does not use the previous `rows.slice(0, input.limit)` post-update pattern.
- Extended docs/provider-code guard test to verify `webhook:manage`, `webhook:read`, and merchant access wording are documented.

## Docs updated

- `docs/integration/merchant-outbound-webhooks.md` now documents required webhook scopes and merchant access for endpoint management and listing operations.
- `docs/integration/webhook-signature-verification.md` now documents backend/admin authorization requirements for webhook endpoint administration.

## Commands run

- `pnpm install` — completed successfully; installed workspace dependencies needed for type-checks/tests.
- `pnpm --filter @northflow/payment-orchestration-service type-check` — initially failed before dependency installation because service dependencies such as `express`, `postgres`, and `drizzle-orm` were unavailable; passed after `pnpm install`.
- `pnpm --filter @northflow/payment-orchestration-core type-check` — passed.
- `pnpm --filter @northflow/payment-orchestration-client-sdk type-check` — passed.
- `npx tsx --tsconfig tests/tsconfig.json --test tests/s10-3-merchant-outbound-webhooks.test.ts` — passed.
- `pnpm test` — passed.

## Type-check results

- `pnpm --filter @northflow/payment-orchestration-service type-check`: passed after installing dependencies.
- `pnpm --filter @northflow/payment-orchestration-core type-check`: passed.
- `pnpm --filter @northflow/payment-orchestration-client-sdk type-check`: passed.

## Test results

- `npx tsx --tsconfig tests/tsconfig.json --test tests/s10-3-merchant-outbound-webhooks.test.ts`: 5 tests passed.
- `pnpm test`: 500 tests passed, 0 failed.

## Provider codes unchanged confirmation

Confirmed provider code definitions remain unchanged:

- `manual`
- `fake_gateway`
- `xendit_sandbox`

## No route/signature/schema behavior change confirmation

- No route paths were changed.
- Inbound HMAC request signing was not changed.
- Outbound merchant webhook signature format was not changed.
- No database schema or migration behavior was changed.
- Event type names were not changed.
- The only runtime behavior change is the safe bounded delivery claim query.

## Remaining issues

None known.
