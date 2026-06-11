# S10.5.1 — Smoke Script Runtime Contract Fix Validation

**Branch:** `feat/s10-5-1-smoke-script-runtime-contract-fix`
**Prompt:** `roadmap/service/claude-s10-5-1-smoke-script-runtime-contract-fix-prompt.md`
**Date:** 2026-06-11

---

## Runtime Mismatches Fixed

| # | Bug | Fix |
|---|-----|-----|
| 1 | Payment method upsert called with `post()` (wrong HTTP verb) | Added `put()` helper; step 4 now uses `PUT /v1/merchants/{merchantId}/provider-accounts/{providerAccountId}/methods/{method}` |
| 2 | Status parsed from `data.status` (field does not exist at top level) | Now parses `statusData.intent?.status` per actual service shape `{ intent: {id, status,...}, latestTransaction, isTerminal, requiresAction, canRetryPayment }` |
| 3 | Refundability used fictional `.refundable` / `.voidable` booleans | Now reads actual contract `{ totalRefundable, currency, transactions:[{transactionId, amountRefundable,...}] }`; finds candidate via `transactions.find(t => t.amountRefundable > 0)` |
| 4 | Audit log cast `data as unknown[]` (shape is `{ entries:[], total, limit, offset }`) | Now reads `(data as {entries?: unknown[]}).entries` with `Array.isArray` guard |
| 5 | Top-level `await` incompatible with CJS tsconfig | Wrapped all async steps in `void (async () => { ... })()` IIFE in both scripts |

---

## Task A — Request helper (fixed)
`request(method: 'GET'|'POST'|'PUT', path, body?, merchantId?)` — single helper supporting all three verbs.
- Sends `Authorization: Bearer`, `x-source-app`, `x-payment-merchant-id` (when present)
- Unwraps `{ ok: true, data: X }` envelope
- `get()`, `post()`, `put()` wrappers delegate to `request()`

## Task B — PUT fix
Step 4 changed from `post(...)` → `put(...)` on `/methods/${SMOKE_METHOD}`.

## Task C — Status parsing fix
`statusData.intent?.status` — fails clearly with message `intent.status missing — unexpected shape` if absent.

## Task D — Refundability fix
- Reads `rData.transactions` array with `Array.isArray` guard
- Finds candidate with `t.amountRefundable > 0`
- Uses `Math.min(candidate.amountRefundable, SMOKE_AMOUNT)` as safe refund amount
- Falls back to void attempt when no refundable candidate (not covered by refundability endpoint)
- SKIP with `totalRefundable=0` message when nothing applicable

## Task E — Audit log fix
Reads `auditData.entries` (array) and `auditData.total` from actual `{ entries, total, limit, offset }` shape.

## Task F — Tests added
`tests/s10-5-1-smoke-runtime-contract-fix.test.ts` — 38 assertions (F1–F9):
- F1: PUT helper exists
- F2: upsert uses PUT not POST
- F3: status from intent.status
- F4: refundability uses actual contract
- F5: audit log uses entries not raw array
- F6: secrets masked
- F7: provider codes unchanged
- F8: --help flags work
- F9: request() helper contract

---

## Commands Run

```
pnpm --filter @northflow/payment-orchestration-core type-check     → ✅ clean
pnpm --filter @northflow/payment-orchestration-client-sdk type-check → ✅ clean
pnpm --filter @northflow/payment-orchestration-service type-check  → ✅ clean
pnpm test                                                          → ✅ 728/728 pass, 0 fail
pnpm s10:readiness --help                                          → ✅ help text displayed
pnpm s10:smoke --help                                              → ✅ help text displayed
```

---

## Invariants Confirmed

- ✅ Provider codes unchanged: `fake_gateway`, `xendit_sandbox`, `manual`
- ✅ No service route behavior changed
- ✅ No DB schema or migration changes
- ✅ No SDK public API breaking changes
- ✅ No HMAC/signature changes
- ✅ No dashboard implementation added
- ✅ No new payment features
- ✅ No new provider integrations

## Remaining Issues

None.
