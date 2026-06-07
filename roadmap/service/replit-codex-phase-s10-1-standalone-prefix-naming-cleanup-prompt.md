# Replit/Codex Prompt - Phase S10.1 Standalone Prefix Naming Cleanup

You are working in the `northflow-payment-orchestration` repository.

This phase implements:

```txt
S10.1 - Standalone Prefix Naming Cleanup
```

## Why this phase exists

The codebase still contains many exported symbols, classes, interfaces, comments, and docs that use the `Standalone*` prefix.

That naming came from the old extraction period where a new standalone payment-orchestration service lived beside an embedded legacy payment engine.

The repository is now already the standalone Northflow Payment Orchestration codebase. Keeping `Standalone*` in public code is confusing because it incorrectly suggests that there is still a separate non-standalone runtime or that `standalone` means `fake_gateway`.

This phase is a pure naming cleanup.

## Hard rule

Do not change runtime behavior.

This phase must be a behavior-preserving refactor only.

Do not implement new payment features.
Do not alter database schema unless there is a compile-critical reason.
Do not change route URLs.
Do not change JSON API response shapes unless a field literally contains `standalone` and is proven internal-only.
Do not change provider codes such as `manual`, `fake_gateway`, or `xendit_sandbox`.
Do not rename package names.
Do not modify unrelated dashboard functionality.

## Northflow-only rule

Keep this phase generic and Northflow-only.

Do not mention named external consumer projects anywhere in generated code comments, docs, tests, examples, validation reports, or roadmap text.

Use generic terms only:

```txt
API client
consumer backend
REST consumer
SDK consumer
external integrator
merchant
provider account
payment method
```

Provider names are allowed only when referring to actual provider adapters or provider codes.

---

# Goal

Remove the confusing `Standalone` prefix from core, SDK, service, tests, and docs where it names Northflow payment-orchestration concepts.

After this phase, code should read as generic Northflow payment orchestration code:

```txt
PaymentIntentDTO
PaymentTransactionDTO
PaymentIntentStatus
PaymentTransactionStatus
PaymentProviderRuntime / PaymentProviderAdapter
FakeGatewayProvider
ManualProvider
PaymentIntentRepositoryPort / PaymentIntentRepository
PaymentTransactionRepositoryPort / PaymentTransactionRepository
```

The exact final names must avoid collisions with existing names.

---

# Required first step - inventory

Before editing, search the whole repository for:

```txt
Standalone
standalone
IStandalone
standalone payment
standalone service
hybrid standalone
standalone provider
```

Create a short mapping section in the validation report with:

```txt
old symbol/name
new symbol/name
files affected
public export? yes/no
compatibility alias kept? yes/no
reason
```

---

# Rename plan

## A. Core package

Target package:

```txt
packages/core
```

Rename public domain/application symbols.

Recommended mapping:

```txt
StandaloneIntentStatus
  -> PaymentIntentStatus

StandalonePaymentIntentDTO
  -> PaymentIntentDTO

CreateStandalonePaymentIntentInput
  -> CreatePaymentIntentRecordInput
```

Important: `CreatePaymentIntentInput` already exists in application contracts. Do not create an export collision in `packages/core/src/index.ts`. Use `CreatePaymentIntentRecordInput` for the domain/repository record input unless there is a better collision-free name.

```txt
StandaloneTransactionStatus
  -> PaymentTransactionStatus

StandalonePaymentTransactionDTO
  -> PaymentTransactionDTO

IStandalonePaymentIntentRepository
  -> PaymentIntentRepositoryPort

IStandalonePaymentTransactionRepository
  -> PaymentTransactionRepositoryPort
```

If exact names already exist, choose a clear collision-free alternative and document it.

Update:

```txt
packages/core/src/domain/PaymentIntent.ts
packages/core/src/domain/PaymentTransaction.ts
packages/core/src/application/ports.ts
packages/core/src/index.ts
packages/core/src/application/repositories.ts if it references Standalone* names
every import site in apps/service and tests
```

## B. Service provider runtime

Target package/app:

```txt
apps/service
```

Rename provider runtime contracts and implementations.

Recommended mapping:

```txt
StandalonePaymentProvider
  -> PaymentProviderAdapter
  or PaymentProviderRuntime

StandaloneProviderStatus
  -> ProviderPaymentStatus

StandaloneCreatePaymentInput
  -> ProviderCreatePaymentInput

StandaloneProviderResult
  -> ProviderPaymentResult

StandaloneProviderWebhookInput
  -> ProviderWebhookInput

StandaloneParsedProviderWebhook
  -> ParsedProviderWebhook

StandaloneProviderStatusInput
  -> ProviderStatusInput

StandaloneProviderStatusResult
  -> ProviderStatusResult

StandaloneProviderCancelInput
  -> ProviderCancelPaymentInput

StandaloneProviderCancelResult
  -> ProviderCancelPaymentResult

StandaloneProviderRefundInput
  -> ProviderRefundPaymentInput

StandaloneProviderRefundResult
  -> ProviderRefundPaymentResult

StandaloneFakeGatewayProvider
  -> FakeGatewayProvider

StandaloneManualProvider
  -> ManualProvider
```

Preferred provider interface name:

```txt
PaymentProviderAdapter
```

Reason: this is an infrastructure adapter to real/simulated payment providers, not a domain provider entity.

Rename files if appropriate:

```txt
apps/service/src/infrastructure/providers/StandalonePaymentProvider.ts
  -> apps/service/src/infrastructure/providers/PaymentProviderAdapter.ts

apps/service/src/infrastructure/providers/StandaloneFakeGatewayProvider.ts
  -> apps/service/src/infrastructure/providers/FakeGatewayProvider.ts

apps/service/src/infrastructure/providers/StandaloneManualProvider.ts
  -> apps/service/src/infrastructure/providers/ManualProvider.ts
```

Update all imports.

Do not change provider codes:

```txt
manual
fake_gateway
xendit_sandbox
```

Do not change provider registration behavior.

Expected registry behavior must remain:

```txt
manual registered in all environments
fake_gateway registered only in non-production
xendit_sandbox registered but HTTP calls enabled only by explicit env config
```

## C. SDK package

Target package:

```txt
packages/client-sdk
```

The SDK should not expose `Standalone*` terminology to consumers.

Search all SDK files:

```txt
packages/client-sdk/src
```

Clean up comments, type references, tests, docs, and public exports.

Do not rename the SDK package.
Do not change public client class names except if they contain `Standalone`.
Do not change request/response JSON shapes unless the property name literally contains `standalone` and is internal-only.

If any SDK type references old core names indirectly, update it.

## D. Tests

Update all tests that reference `Standalone*` symbols or file names.

Do not weaken assertions.

Recommended new test file if needed:

```txt
tests/s10-1-standalone-prefix-cleanup.test.ts
```

Required assertions:

```txt
No exported TypeScript symbol starts with Standalone.
No class/interface/type in packages/core starts with Standalone.
No class/interface/type in apps/service/src/infrastructure/providers starts with Standalone.
No import path under apps/service references Standalone*.ts provider files.
Provider registry behavior remains unchanged.
Core public exports still compile.
SDK public exports still compile.
Existing payment intent/gateway/refund/void tests still pass.
```

Use pragmatic tests. A text-search assertion is acceptable as long as it does not produce false failures for historical docs that are intentionally archived.

## E. Docs

Update current operational docs and roadmap text to avoid confusing `Standalone*` language.

Allowed historical references:

```txt
docs/reports/* legacy/extraction reports may keep historical context if clearly archived
```

Current docs should prefer:

```txt
Northflow service
payment orchestration service
provider adapter
core contracts
SDK
```

Avoid using `standalone` as a runtime concept unless discussing old extraction history.

Update at minimum if affected:

```txt
README.md
docs/payment-orchestration-sdk-contract.md
docs/payment-orchestration-deployment.md
docs/operations/bootstrap-admin-runtime.md
roadmap/service/main.md
```

Do not introduce named external consumer project references.

---

# Compatibility policy

This phase may touch public TypeScript exports.

Preferred approach:

1. Rename the primary symbols to the new names.
2. Add deprecated compatibility type aliases only where needed to avoid breaking internal code during the same phase.
3. Internal code should import/use the new names only.
4. If compatibility aliases are kept, mark them clearly:

```ts
/** @deprecated Use PaymentIntentDTO instead. */
export type StandalonePaymentIntentDTO = PaymentIntentDTO;
```

5. Do not keep deprecated aliases forever unless necessary for SDK/API external compatibility.

For this repo, all internal references should be migrated to the new names in the same phase.

---

# Important distinction to preserve

This refactor must preserve this conceptual distinction:

```txt
standalone
  old extraction-era architecture label; should not remain as primary code naming

fake_gateway
  dev/test provider code; must remain provider code and behavior

manual
  offline/manual/cash provider code; must remain provider code and behavior

xendit_sandbox
  provider adapter code; must remain provider code and behavior
```

Do not rename `fake_gateway` to anything else.
Do not treat `standalone` as a payment method or provider.

---

# Validation commands

Run and document:

```bash
pnpm type-check
pnpm test
pnpm --filter @northflow/payment-orchestration-core type-check
pnpm --filter @northflow/payment-orchestration-client-sdk type-check
pnpm --filter @northflow/payment-orchestration-service type-check
pnpm --filter @northflow/payment-orchestration-service test
```

If workspace commands are noisy, document the exact issue and run the narrowest reliable targeted commands.

Also run repository search and document results:

```bash
grep -R "Standalone" packages/core packages/client-sdk apps/service tests README.md docs roadmap -n || true
grep -R "IStandalone" packages/core packages/client-sdk apps/service tests -n || true
grep -R "StandalonePaymentProvider\|StandaloneFakeGatewayProvider\|StandaloneManualProvider" apps/service tests -n || true
```

The final result should show no remaining active-code references to `Standalone*` except deprecated compatibility aliases if deliberately kept.

---

# Validation report

Create:

```txt
.agents/memory/s10-1-standalone-prefix-naming-cleanup-validation.md
```

The report must include:

```txt
timestamp
git commit checked
files changed
symbol mapping table
file rename table
commands run
pass/fail/skipped results
remaining grep results
compatibility aliases kept, if any
behavior unchanged confirmation
provider registry unchanged confirmation
known pre-existing failures
remaining issues
```

---

# Acceptance criteria

S10.1 is complete only when:

```txt
All active core Standalone* symbols are renamed or deprecated aliases only.
All active service provider Standalone* classes/interfaces/types are renamed or deprecated aliases only.
All service imports use the new provider adapter file/class names.
SDK comments/types do not expose Standalone terminology as current runtime concept.
Provider codes are unchanged: manual, fake_gateway, xendit_sandbox.
Routes are unchanged.
Database schema is unchanged unless strongly justified.
Runtime behavior is unchanged.
Tests pass or failures are honestly documented.
Validation report exists.
Current docs no longer present Standalone as a confusing active concept.
No named external consumer project references are introduced.
```

Commit and push all changes.
