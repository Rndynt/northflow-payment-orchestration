# Claude Prompt — S10.3.1 Merchant Webhook Delivery Claim Hardening

You are working in `northflow-payment-orchestration`.

S10.3 implemented merchant outbound webhooks. Review found one production-critical bug in the delivery claiming repository plus a small documentation/test gap. Fix this before any next phase.

## Problem

`apps/service/src/infrastructure/repositories/DrizzleMerchantWebhookDeliveryRepository.ts` currently claims due deliveries like this conceptually:

```ts
UPDATE po_merchant_webhook_deliveries
SET status = 'delivering', attempt_count = attempt_count + 1, ...
WHERE status IN ('queued', 'failed') AND next_attempt_at <= now
RETURNING *

return rows.slice(0, limit)
```

This is wrong. It updates every due delivery in the database, then slices in memory. With 10,000 due rows and `limit = 25`, 10,000 rows become `delivering` while only 25 are processed. The remaining rows can get stuck as `delivering`.

## Hard Rules

- Do not add new webhook features.
- Do not change event type names.
- Do not change provider codes: `manual`, `fake_gateway`, `xendit_sandbox`.
- Do not change HMAC inbound request signing.
- Do not change outbound webhook signature format.
- Do not change existing route paths unless fixing docs only.
- Do not add dashboard work.

## Task A — Fix atomic delivery claim limit

File:

`apps/service/src/infrastructure/repositories/DrizzleMerchantWebhookDeliveryRepository.ts`

Fix `claimDue(input: { now: Date; limit: number })` so the database only updates at most `input.limit` rows.

Required behavior:

- Select at most `limit` due delivery IDs first.
- Then update only those selected IDs to `delivering`.
- Increment `attemptCount` only for selected rows.
- Set `lastAttemptAt` and `updatedAt` only for selected rows.
- Return only selected updated rows.
- Preserve due filter: status is `queued` or `failed`, and `nextAttemptAt <= now`.
- Order claim deterministically, preferably by `nextAttemptAt ASC`, then `createdAt ASC` or `id ASC`.
- If possible on Postgres, use row locking such as `FOR UPDATE SKIP LOCKED` to avoid two workers claiming the same rows concurrently.
- If Drizzle cannot express this cleanly, use a safe raw SQL query through the existing DB adapter pattern.

Expected SQL shape is similar to:

```sql
WITH due AS (
  SELECT id
  FROM po_merchant_webhook_deliveries
  WHERE status IN ('queued', 'failed')
    AND next_attempt_at <= $1
  ORDER BY next_attempt_at ASC, created_at ASC, id ASC
  LIMIT $2
  FOR UPDATE SKIP LOCKED
)
UPDATE po_merchant_webhook_deliveries d
SET status = 'delivering',
    attempt_count = d.attempt_count + 1,
    last_attempt_at = $1,
    updated_at = $1
FROM due
WHERE d.id = due.id
RETURNING d.*;
```

Adapt column/table names to the current Drizzle schema mapping.

## Task B — Add regression test for claim limit

Add or update tests to prove the bug cannot regress.

Required test:

- Seed or simulate at least 3 due deliveries.
- Call `claimDue({ limit: 1 })`.
- Assert exactly 1 row is returned.
- Assert exactly 1 row becomes `delivering` / attemptCount incremented.
- Assert the remaining due rows stay `queued` or `failed`, not `delivering`.

If the repo has DB integration tests, test the Drizzle repository directly. If not, add a focused test around the query/repository using the existing test harness. Do not rely only on the in-memory fake repository because the bug is in the Drizzle implementation.

## Task C — Scope documentation gap

Docs added in S10.3 mention endpoint setup but do not clearly state required auth scopes.

Update:

- `docs/integration/merchant-outbound-webhooks.md`
- `docs/integration/webhook-signature-verification.md` if relevant

Document required scopes:

- `webhook:manage` for create endpoint, disable endpoint, rotate secret, replay
- `webhook:read` for list endpoints and list deliveries

Also mention that the API client must have merchant access for the target `merchantId` with those scopes.

## Task D — Validation report

Create:

`.agents/memory/s10-3-1-webhook-delivery-claim-hardening-validation.md`

Include:

- timestamp
- commit checked
- files changed
- exact claimDue bug found
- chosen SQL/Drizzle fix strategy
- regression tests added
- docs updated
- commands run
- type-check results
- test results
- provider codes unchanged confirmation
- no route/signature/schema behavior change confirmation
- remaining issues

Do not claim command success unless actually run.

## Required validation commands

Run and document:

```bash
pnpm --filter @northflow/payment-orchestration-service type-check
pnpm --filter @northflow/payment-orchestration-core type-check
pnpm --filter @northflow/payment-orchestration-client-sdk type-check
pnpm test
```

## Acceptance Criteria

Complete only when:

- `claimDue(limit)` updates no more than `limit` rows in the database.
- Non-claimed due rows remain `queued` or `failed`.
- Concurrent workers cannot claim the same rows if Postgres locking support is available.
- Regression test covers the exact mass-update bug.
- Webhook docs mention `webhook:manage` and `webhook:read` scopes.
- Provider codes remain unchanged.
- Outbound webhook signature format remains unchanged.
- No new route/db schema behavior is introduced except safe claim query behavior.
- Type-check and tests pass or failures are honestly documented.
- Validation report exists.

Commit and push all changes.
