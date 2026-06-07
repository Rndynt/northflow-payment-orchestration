# S9.4 Final Cleanup Prompt - No External Project References

Work in the `northflow-payment-orchestration` repository.

This is the final cleanup for S9.4. Do not rework the whole HMAC implementation. Fix only the remaining blockers that made S9.4 not final.

## Non-negotiable rule

Northflow must not contain named external consumer project references in active code comments, docs, prompts, reports, tests, examples, file names, function names, exported helper names, or public contracts.

Use generic names only:

```txt
Consumer A
Consumer B
Consumer C
API client
consumer backend
REST consumer
SDK consumer
external integrator
```

Provider names such as FakeGateway, Manual, Xendit, Midtrans are allowed when they refer to payment providers.

## Required fixes

### 1. Fix `packages/core/src/domain/PaymentScope.ts`

This file still contains named external project references and a compatibility helper with a project-specific name.

Required changes:

- Remove all named external consumer project references from comments.
- Rename `createAuraPosPaymentScope` to a generic helper name, for example `createLegacyTenantPaymentScope` or `createConsumerTenantPaymentScope`.
- Replace hard-coded project-specific `sourceApp` with a generic parameter or a generic default such as `consumer-a`.
- Update all exports/imports/tests that reference the old helper name.
- Do not leave the old helper exported as an alias.
- Do not leave comments saying the old project name was intentionally retained.

### 2. Rename integration docs that still use project-specific filenames

Rename these files to generic names:

```txt
docs/integration/aurapos-rest-integration.md   -> docs/integration/consumer-a-rest-integration.md
docs/integration/transity-sdk-integration.md   -> docs/integration/consumer-b-sdk-integration.md
docs/integration/kioskoin-rest-integration.md  -> docs/integration/consumer-c-rest-integration.md
```

Update all links/references to the renamed files.

### 3. Clean all active text references

Search and remove all active references to these old names, all case variants:

```txt
AuraPoS
aurapos
Transity
transity
Kioskoin
kioskoin
```

Apply this to:

```txt
README.md
docs/**
roadmap/**
.agents/memory/**
packages/**
apps/**
tests/**
scripts/**
```

Do not use a whitelist exception for old migration/history comments. Replace with generic wording.

### 4. Fix S9.4 validation report

Update:

```txt
.agents/memory/s9-4-validation.md
```

Required changes:

- Remove the note that old references were intentionally left unchanged.
- Add a section proving zero remaining old project-name references.
- List the exact search commands used.
- State that `PaymentScope.ts` helper was renamed and no old alias remains.
- State that integration doc filenames were renamed.

### 5. Keep existing S9.4 security patch intact

Do not undo these completed fixes:

```txt
production signed request default = required
non-production default = optional
strict 32-byte signing encryption key handling
no padding or truncation
shared canonical builder between service and client package
nonce replay protection
invalid signed request does not fall back to bearer
```

### 6. Tests and validation

Run and document:

```bash
pnpm type-check
pnpm test
pnpm db:generate
pnpm db:migrate
pnpm --filter @northflow/payment-orchestration-service type-check
pnpm --filter @northflow/payment-orchestration-client-sdk type-check
```

Also run repository searches and document results:

```bash
grep -Rni "AuraPoS\|aurapos\|Transity\|transity\|Kioskoin\|kioskoin" README.md docs roadmap .agents packages apps tests scripts || true
```

Expected result:

```txt
No matches for old external consumer project names.
```

## Final acceptance

The patch is complete only if all are true:

```txt
PaymentScope.ts has no named external consumer project references.
No exported helper has a project-specific name.
Integration doc filenames are generic.
All links to renamed docs are updated.
No active file contains old external consumer project names.
S9.4 validation report no longer contains exceptions.
All tests/type-checks are run and documented honestly.
```

Commit and push all changes.
