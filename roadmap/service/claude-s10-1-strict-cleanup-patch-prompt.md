# Claude Prompt - S10.1 Strict Cleanup Patch

You are working in the `northflow-payment-orchestration` repository.

This is a strict patch for the previously implemented phase:

```txt
S10.1 - Standalone Prefix Naming Cleanup
```

The previous S10.1 implementation is incomplete and contains scope leaks.

Your job is to patch it precisely, not to expand the scope.

---

# Important commit/history references

Use these commits as references before editing.

## Last known reference before S10.1 implementation

```txt
8c171099d8d90e228ab14aa2cb8d0feb8c9bf2af
```

This commit added the original S10.1 prompt. It is the clean reference point before the S10.1 implementation changed files.

Use it for checking what changed:

```bash
git diff --name-status 8c171099d8d90e228ab14aa2cb8d0feb8c9bf2af..HEAD

git diff 8c171099d8d90e228ab14aa2cb8d0feb8c9bf2af..HEAD -- apps/dashboard/next.config.ts

git diff 8c171099d8d90e228ab14aa2cb8d0feb8c9bf2af..HEAD -- packages/core/src/security/canonicalRequest.ts
```

## Current bad/partial S10.1 implementation commit to inspect

```txt
dc6a6efedbd27ca519dd4c9f76f54ed0ae6224a4
```

This commit contains the partial S10.1 implementation that must be patched.

Do not blindly revert the whole commit. Keep the valid rename work. Revert only the scope leaks and non-naming behavior changes.

---

# What went wrong

The previous implementation correctly started the rename from `Standalone*` to generic Northflow names, but it also introduced these problems:

```txt
1. apps/dashboard/next.config.ts was modified even though S10.1 must not touch dashboard.
2. packages/core/src/security/canonicalRequest.ts was changed in behavior/API, even though S10.1 is naming-only.
3. Active tests still import/use Standalone* aliases instead of new names.
4. Standalone*.ts compatibility files still exist, but internal active code/tests must not depend on them.
5. Validation report must honestly list remaining aliases and grep results.
```

---

# Absolute hard rules

Do not change runtime behavior.
Do not change route URLs.
Do not change database schema.
Do not change provider codes.
Do not change package names.
Do not touch unrelated dashboard code.
Do not modify HMAC/canonical request behavior as part of this patch.
Do not add new payment features.

Provider codes must remain exactly:

```txt
manual
fake_gateway
xendit_sandbox
```

`standalone` is not a provider and is not a payment method.

---

# Required patch tasks

## Task 1 - Revert dashboard scope leak

File:

```txt
apps/dashboard/next.config.ts
```

Restore it to the clean pre-S10.1 behavior from commit:

```txt
8c171099d8d90e228ab14aa2cb8d0feb8c9bf2af
```

The dashboard must not transpile core as part of S10.1.

Expected shape:

```ts
import type { NextConfig } from "next";

const devDomain = process.env.NEXT_PUBLIC_REPLIT_DEV_DOMAIN;

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@northflow/payment-orchestration-client-sdk"],
  allowedDevOrigins: devDomain ? [devDomain, `*.${devDomain}`] : [],
};

export default nextConfig;
```

Do not touch other dashboard files.

## Task 2 - Revert canonicalRequest behavior leak

File:

```txt
packages/core/src/security/canonicalRequest.ts
```

S10.1 is a naming cleanup. It must not change S9.4 signed request behavior.

Restore the behavior/API from commit:

```txt
8c171099d8d90e228ab14aa2cb8d0feb8c9bf2af
```

Specifically:

```txt
hashBody must remain synchronous if it was synchronous before S10.1.
computeSignature must remain synchronous if it was synchronous before S10.1.
Do not introduce Web Crypto async behavior in this patch.
Do not change canonical string format.
Do not change signature algorithm.
Do not change exported constant values.
```

Use:

```bash
git show 8c171099d8d90e228ab14aa2cb8d0feb8c9bf2af:packages/core/src/security/canonicalRequest.ts
```

Then apply only necessary non-behavior comment cleanup if any.

## Task 3 - Keep valid provider rename, but migrate active imports

Keep the new provider adapter names:

```txt
PaymentProviderAdapter
FakeGatewayProvider
ManualProvider
```

New primary files should be:

```txt
apps/service/src/infrastructure/providers/PaymentProviderAdapter.ts
apps/service/src/infrastructure/providers/FakeGatewayProvider.ts
apps/service/src/infrastructure/providers/ManualProvider.ts
```

Compatibility files may remain only as thin deprecated re-exports:

```txt
apps/service/src/infrastructure/providers/StandalonePaymentProvider.ts
apps/service/src/infrastructure/providers/StandaloneFakeGatewayProvider.ts
apps/service/src/infrastructure/providers/StandaloneManualProvider.ts
```

Allowed content pattern:

```ts
/** @deprecated Use FakeGatewayProvider from ./FakeGatewayProvider.ts instead. */
export { FakeGatewayProvider as StandaloneFakeGatewayProvider } from './FakeGatewayProvider.ts';
```

But internal active code and tests must not import from those compatibility files.

Search and fix:

```bash
grep -R "StandalonePaymentProvider\|StandaloneFakeGatewayProvider\|StandaloneManualProvider" apps/service tests -n
```

Allowed remaining matches:

```txt
compatibility alias files only
validation report
old prompt file
archived historical docs/reports only if clearly historical
```

## Task 4 - Migrate active core/test type usage

Core can keep deprecated compatibility aliases if needed, but active code/tests must use new names.

Replace active test/code imports and annotations:

```txt
StandalonePaymentIntentDTO -> PaymentIntentDTO
StandaloneIntentStatus -> PaymentIntentStatus
StandalonePaymentTransactionDTO -> PaymentTransactionDTO
StandaloneTransactionStatus -> PaymentTransactionStatus
CreateStandalonePaymentIntentInput -> CreatePaymentIntentRecordInput
IStandalonePaymentIntentRepository -> PaymentIntentRepositoryPort
IStandalonePaymentTransactionRepository -> PaymentTransactionRepositoryPort
```

Search and fix active files:

```bash
grep -R "StandalonePaymentIntentDTO\|StandaloneIntentStatus\|StandalonePaymentTransactionDTO\|StandaloneTransactionStatus\|CreateStandalonePaymentIntentInput\|IStandalone" packages/core packages/client-sdk apps/service tests -n
```

Allowed remaining matches:

```txt
packages/core deprecated compatibility aliases only
validation report
old prompt file
archived historical docs/reports only if clearly historical
```

Do not leave active tests importing old aliases.

## Task 5 - Validate provider registry behavior unchanged

Provider registry behavior must remain:

```txt
manual registered in every environment
fake_gateway registered only when NODE_ENV !== production
xendit_sandbox registered in registry but HTTP calls enabled only by explicit env config
```

Do not rename provider codes.

Run or update tests to assert this behavior.

## Task 6 - Validation report must be honest

Update:

```txt
.agents/memory/s10-1-standalone-prefix-naming-cleanup-validation.md
```

The report must include:

```txt
patch timestamp
git commit checked
exact files changed by this patch
what was reverted from the bad S10.1 implementation
symbol mapping table
compatibility aliases kept
final grep results
commands run
test/type-check results
known failures if any
provider registry unchanged confirmation
canonicalRequest behavior restored confirmation
dashboard scope restored confirmation
```

Do not claim full pass unless commands were actually run.

---

# Required final verification commands

Run these:

```bash
pnpm --filter @northflow/payment-orchestration-core type-check
pnpm --filter @northflow/payment-orchestration-client-sdk type-check
pnpm --filter @northflow/payment-orchestration-service type-check
pnpm --filter @northflow/payment-orchestration-service test
pnpm test
```

If a command cannot run due to environment or pre-existing issue, document the exact failure and run narrower tests.

Also run grep checks:

```bash
grep -R "StandalonePaymentIntentDTO\|StandaloneIntentStatus\|StandalonePaymentTransactionDTO\|StandaloneTransactionStatus\|CreateStandalonePaymentIntentInput\|IStandalone" packages/core packages/client-sdk apps/service tests -n || true

grep -R "StandalonePaymentProvider\|StandaloneFakeGatewayProvider\|StandaloneManualProvider" apps/service tests -n || true

grep -R "@northflow/payment-orchestration-core" apps/dashboard/next.config.ts -n || true
```

Expected:

```txt
No active code/test imports should use Standalone*.
Dashboard next.config.ts should not contain @northflow/payment-orchestration-core.
Compatibility aliases are allowed only in compatibility alias files or core alias exports.
Archived docs/prompts/reports may mention Standalone only as historical context.
```

---

# Acceptance criteria

This patch is complete only when:

```txt
apps/dashboard/next.config.ts is restored to pre-S10.1 behavior.
packages/core/src/security/canonicalRequest.ts is restored to pre-S10.1 behavior/API.
Active service imports use PaymentProviderAdapter/FakeGatewayProvider/ManualProvider.
Active tests use new names, not Standalone* aliases.
Provider codes remain unchanged.
Provider registry behavior remains unchanged.
No route/db/schema behavior changed.
Validation report is updated and honest.
Type-check/tests pass or failures are honestly documented.
```

Commit and push all changes.
