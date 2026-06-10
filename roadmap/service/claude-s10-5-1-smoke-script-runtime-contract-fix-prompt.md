# Claude Prompt — S10.5.1 Smoke Script Runtime Contract Fix

Repository: `northflow-payment-orchestration`

## Phase

`S10.5.1 — Smoke Script Runtime Contract Fix`

## Context

S10.5 added deployment readiness docs and smoke scripts. Review found runtime contract mismatches in `scripts/s10-5-bootstrap-smoke.ts`. Fix the script and add tests. Do not change service route behavior just to match the script.

## Hard Rules

- No new payment features.
- No dashboard UI.
- No new provider integration.
- Keep provider codes unchanged: `manual`, `fake_gateway`, `xendit_sandbox`.
- No DB schema or migration changes.
- No public REST route rename.
- No SDK public API rename.
- No HMAC/signature behavior change.
- Keep Northflow backend-to-backend only.

## Problems

1. The smoke script calls provider-account payment-method upsert with POST, but the actual route is PUT.
2. The smoke script reads payment intent status from `data.status`, but the actual status response is `data.intent.status`.
3. The smoke script assumes refundability has `refundable` and `voidable` booleans. It must parse the actual refundability response shape from the current service/SDK contract.
4. Static tests only check route strings, so they did not catch the POST-vs-PUT mismatch.

## Task A — Fix request helper

Update `scripts/s10-5-bootstrap-smoke.ts`.

Add or refactor a request helper that supports at least GET, POST, and PUT.

Requirements:

- GET sends no body.
- POST/PUT send JSON body when body exists.
- Send bearer auth header.
- Send `x-source-app`.
- Send `x-payment-merchant-id` when merchantId exists.
- Consistently unwrap `{ ok: true, data }`.
- Keep output safe and do not print sensitive env values.

## Task B — Fix payment method upsert

Change payment method setup from POST to PUT for:

`/v1/merchants/{merchantId}/provider-accounts/{providerAccountId}/methods/{method}`

Do not change the service route.

## Task C — Fix status parsing

Parse `GET /v1/payment-intents/{id}/status` using:

```ts
const statusData = data as {
  intent?: { id?: string; status?: string };
  latestTransaction?: { id?: string; status?: string } | null;
  isTerminal?: boolean;
  requiresAction?: boolean;
  canRetryPayment?: boolean;
};
```

The script must read `statusData.intent?.status`. If missing, the status step must fail with a clear message.

## Task D — Fix refundability logic

Inspect:

- `packages/client-sdk/src/types.ts`
- the service route/use case for `GET /v1/payment-intents/{id}/refundability`

Update smoke script to parse the actual refundability response. Do not rely on fictional fields.

Required behavior:

- If a refundable transaction candidate exists, choose a valid transaction id and safe amount.
- Else if a voidable candidate exists, choose a valid transaction id.
- Else mark refund/void as SKIP with a clear reason.
- Do not force both refund and void.
- Defensive parsing: unknown shape must not crash the full script.

## Task E — Audit log parsing

Verify the actual audit log response shape and parse defensively. If the credential lacks audit permission, keep the step as SKIP.

## Task F — Tests

Update `tests/s10-5-deployment-runtime-readiness.test.ts` or add `tests/s10-5-1-smoke-runtime-contract-fix.test.ts`.

Required assertions:

1. Smoke script supports PUT.
2. Payment method upsert uses PUT.
3. Payment method upsert route is not sent through POST.
4. Status parsing uses `intent.status`, not `data.status`.
5. Refundability parsing follows actual contract, not only `refundable` or `voidable` booleans.
6. Refund/void target is selected from actual refundability data when possible.
7. Audit log parsing is accurate or defensive.
8. Sensitive values are masked in output.
9. Provider codes remain unchanged.
10. `pnpm s10:smoke --help` and `pnpm s10:readiness --help` still work.

## Task G — Validation report

Create:

`.agents/memory/s10-5-1-smoke-script-runtime-contract-fix-validation.md`

Include:

- timestamp
- files changed
- runtime mismatches fixed
- payment method PUT fix status
- status parsing fix status
- refundability parsing fix status
- audit log parsing status
- tests added or updated
- commands run
- type-check results
- test results
- provider codes unchanged confirmation
- no route behavior change confirmation
- no DB schema or migration change confirmation
- no SDK public API breaking change confirmation
- no HMAC/signature change confirmation
- no dashboard implementation confirmation
- remaining issues

## Required Commands

Run and document:

```bash
pnpm --filter @northflow/payment-orchestration-core type-check
pnpm --filter @northflow/payment-orchestration-client-sdk type-check
pnpm --filter @northflow/payment-orchestration-service type-check
pnpm test
pnpm s10:readiness --help
pnpm s10:smoke --help
```

## Acceptance Criteria

Complete only when:

- Smoke script uses PUT for provider account method upsert.
- Smoke script parses payment intent status from `data.intent.status`.
- Smoke script parses refundability according to actual contract.
- Refund/void step uses actual candidates from refundability where possible.
- Audit log parsing is accurate or defensive.
- Tests catch the corrected runtime contract details.
- Provider codes remain unchanged.
- No service route behavior changed.
- No DB schema or migration changes.
- No SDK public API breaking changes.
- No HMAC/signature changes.
- No dashboard implementation added.
- Validation report exists.

Commit and push all changes.
