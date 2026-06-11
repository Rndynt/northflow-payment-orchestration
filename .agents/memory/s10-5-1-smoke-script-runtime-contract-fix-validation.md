# S10.5.1 — Smoke Script Runtime Contract Fix Validation

**Branch:** `fix/s10-5-1-smoke-runtime-contract`
**Prompt:** `roadmap/service/claude-s10-5-1-smoke-script-runtime-contract-fix-prompt.md`
**Date:** 2026-06-11

## Runtime Mismatches Fixed

| # | Bug | Fix |
|---|-----|-----|
| 1 | Payment method upsert used `post()` | Added `put()` helper; step 4 now uses `PUT /v1/merchants/{m}/provider-accounts/{pa}/methods/{method}` |
| 2 | Status parsed `data.status` (doesn't exist) | Now reads `statusData.intent?.status` per actual shape `{ intent:{id,status,...}, isTerminal, ... }` |
| 3 | Refundability used fictional `.refundable`/`.voidable` | Reads actual `{ totalRefundable, transactions:[{transactionId,amountRefundable}] }`; `transactions.find`, `Math.min` |
| 4 | Audit log cast `data as unknown[]` | Reads `auditData.entries` with `Array.isArray` guard; also reads `auditData.total` |
| 5 | Top-level `await` incompatible with CJS tsconfig | Both scripts wrapped in `void (async () => { ... })()` IIFE |

## Files Changed
- `scripts/s10-5-bootstrap-smoke.ts` — all 5 fixes
- `scripts/s10-5-runtime-readiness-check.ts` — IIFE wrap
- `tests/s10-5-1-smoke-runtime-contract-fix.test.ts` — 38 assertions (F1–F10)
- `.agents/memory/s10-5-1-smoke-script-runtime-contract-fix-validation.md`

## Results
```
type-check  → ✅ clean
pnpm test   → ✅ 726/726 pass (was 690)
--help smoke     → ✅ works
--help readiness → ✅ works
```

## Invariants
- No service routes changed
- No DB/schema changes  
- Provider codes unchanged: fake_gateway, xendit_sandbox, manual
- No dashboard, no new payment features
