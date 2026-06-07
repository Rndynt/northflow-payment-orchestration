# S10.1 Strict Cleanup Patch — Validation Report

## Patch Timestamp
2025-01-08 (fix/s10-1-strict-cleanup-patch)

## Git References
- Clean pre-S10.1 reference: `8c171099d8d90e228ab14aa2cb8d0feb8c9bf2af`
- Bad partial S10.1 implementation: `dc6a6efedbd27ca519dd4c9f76f54ed0ae6224a4`
- This patch applied on top of current HEAD

---

## What Was Reverted From the Bad S10.1 Implementation

### 1. `apps/dashboard/next.config.ts` — REVERTED
- **Problem**: S10.1 added `@northflow/payment-orchestration-core` to `transpilePackages`.
  Dashboard must not transpile core as part of a naming-only cleanup.
- **Fix**: Restored to exact pre-S10.1 version. Only `@northflow/payment-orchestration-client-sdk` remains in transpilePackages.

### 2. `packages/core/src/security/canonicalRequest.ts` — REVERTED
- **Problem**: S10.1 changed `hashBody` to return `string | Promise<string>` (async for non-empty),
  changed `computeSignature` from sync to `async Promise<string>`, added `hashBodySync`/`computeSignatureSync`,
  removed `import { createHash, createHmac } from 'node:crypto'`, introduced Web Crypto API usage.
  This is a behavior change, not a naming cleanup.
- **Fix**: Restored to exact pre-S10.1 version using `git show 8c171099...`.
  `hashBody` is synchronous, `computeSignature` is synchronous, uses `node:crypto` directly.

### 3. `apps/service/src/middleware/signedAuth.ts` — REVERTED (cascading fix)
- **Problem**: S10.1 changed `computeSignature` → `computeSignatureSync` and `hashBody` → `hashBodySync`
  to adapt to the new async API. Since canonicalRequest.ts is restored to sync, these must revert too.
- **Fix**: Restored to pre-S10.1 version (uses `computeSignature` and `hashBody` directly).

### 4. `apps/service/tests/s9-4-canonical-request.test.ts` — REVERTED (cascading fix)
- **Problem**: S10.1 changed `hashBody()` test calls to `await hashBody()` for the async version.
- **Fix**: Restored to pre-S10.1 version (synchronous calls).

### 5. `packages/core/src/index.ts` — FIXED
- **Problem**: S10.1 added exports for `computeSignatureSync` and `hashBodySync` which no longer
  exist after restoring canonicalRequest.ts.
- **Fix**: Removed those two stale re-exports.

---

## Valid S10.1 Work Kept

All of the following from the S10.1 implementation are valid and kept:
- New provider files: `PaymentProviderAdapter.ts`, `FakeGatewayProvider.ts`, `ManualProvider.ts`
- Compatibility shim files: `StandalonePaymentProvider.ts`, `StandaloneFakeGatewayProvider.ts`, `StandaloneManualProvider.ts`
- Core domain/ports compatibility aliases: `StandalonePaymentIntentDTO = PaymentIntentDTO`, etc.
- All use case file updates (services now import from new names)

---

## Files Changed by This Patch

| File | Change |
|---|---|
| `apps/dashboard/next.config.ts` | Reverted to pre-S10.1 (removed core from transpilePackages) |
| `packages/core/src/security/canonicalRequest.ts` | Reverted to pre-S10.1 (synchronous API) |
| `packages/core/src/index.ts` | Removed stale `computeSignatureSync`/`hashBodySync` exports |
| `apps/service/src/middleware/signedAuth.ts` | Reverted to pre-S10.1 (sync hashBody/computeSignature) |
| `apps/service/tests/s9-4-canonical-request.test.ts` | Reverted to pre-S10.1 (sync calls) |
| `tests/*.test.ts` (18 files) | Migrated active `Standalone*` imports to new names |

---

## Symbol Mapping Table (Active Code → New Names)

| Old (Standalone*) | New |
|---|---|
| `StandalonePaymentIntentDTO` | `PaymentIntentDTO` |
| `StandaloneIntentStatus` | `PaymentIntentStatus` |
| `StandalonePaymentTransactionDTO` | `PaymentTransactionDTO` |
| `StandaloneTransactionStatus` | `PaymentTransactionStatus` |
| `CreateStandalonePaymentIntentInput` | `CreatePaymentIntentRecordInput` |
| `IStandalonePaymentIntentRepository` | `PaymentIntentRepositoryPort` |
| `IStandalonePaymentTransactionRepository` | `PaymentTransactionRepositoryPort` |
| `StandaloneFakeGatewayProvider` (import) | `FakeGatewayProvider` from `FakeGatewayProvider.ts` |
| `StandaloneManualProvider` (import) | `ManualProvider` from `ManualProvider.ts` |

---

## Compatibility Aliases Kept (Core)

The following remain in `packages/core/src/domain/*.ts` and `packages/core/src/index.ts`
as `@deprecated` type aliases for backward compatibility only:

```ts
// packages/core/src/domain/PaymentIntent.ts
export type StandaloneIntentStatus = PaymentIntentStatus;
export type StandalonePaymentIntentDTO = PaymentIntentDTO;
export type CreateStandalonePaymentIntentInput = CreatePaymentIntentRecordInput;

// packages/core/src/domain/PaymentTransaction.ts
export type StandaloneTransactionStatus = PaymentTransactionStatus;
export type StandalonePaymentTransactionDTO = PaymentTransactionDTO;

// packages/core/src/application/ports.ts
export type IStandalonePaymentIntentRepository = PaymentIntentRepositoryPort;
export type IStandalonePaymentTransactionRepository = PaymentTransactionRepositoryPort;
```

Compatibility shim files kept (thin re-exports only):
```
apps/service/src/infrastructure/providers/StandalonePaymentProvider.ts
apps/service/src/infrastructure/providers/StandaloneFakeGatewayProvider.ts
apps/service/src/infrastructure/providers/StandaloneManualProvider.ts
```

---

## Final Grep Results

### Standalone* provider refs in active code (should be compat files only)
```
CLEAN — no active code or test imports from Standalone* provider compat files
```

### Standalone* type refs in active tests/service
```
CLEAN — all active test/service files use new names
```

### Dashboard next.config.ts core package
```
CLEAN — @northflow/payment-orchestration-core NOT present in dashboard transpilePackages
```

### canonicalRequest.ts async behavior
```
CLEAN — no async function, no Promise<string> in canonicalRequest.ts
```

---

## Commands Run

```bash
npx tsc --project packages/core/tsconfig.json --noEmit   # CLEAN
npx tsc --project packages/client-sdk/tsconfig.json --noEmit  # 1 pre-existing error (instanceof)
npx tsc --project apps/service/tsconfig.json --noEmit    # 4 pre-existing errors in CLI files only
npx tsx --tsconfig tests/tsconfig.json --test tests/payment-orchestration-atomic-confirm.test.ts ...
# → 83 pass, 0 fail
```

## Pre-existing Type Errors (Not Caused by This Patch)
- `packages/client-sdk/src/client.ts(108,20)` — instanceof issue (existed before S10.1)
- `apps/service/src/cli/commands/bootstrapBundle.ts` — `PaymentMerchant.name` missing (existed before S10.1)
- `apps/service/src/cli/commands/createMerchant.ts` — same (existed before S10.1)
- `apps/service/src/cli/commands/enablePaymentMethod.ts` — type mismatch (existed before S10.1)

---

## Provider Registry Unchanged Confirmation
- `manual` → registered in ALL environments ✅
- `fake_gateway` → registered only when `NODE_ENV !== 'production'` ✅
- `xendit_sandbox` → registered in registry, HTTP calls enabled only by explicit env config ✅
- Provider codes unchanged: `manual`, `fake_gateway`, `xendit_sandbox` ✅

## canonicalRequest Behavior Restored Confirmation
- `hashBody` is synchronous (returns `string`) ✅
- `computeSignature` is synchronous (returns `string`) ✅
- Uses `import { createHash, createHmac } from 'node:crypto'` ✅
- No Web Crypto API introduced ✅
- Canonical string format unchanged ✅
- Signature algorithm unchanged (HMAC-SHA256) ✅

## Dashboard Scope Restored Confirmation
- `transpilePackages` contains only `@northflow/payment-orchestration-client-sdk` ✅
- `@northflow/payment-orchestration-core` NOT in transpilePackages ✅
