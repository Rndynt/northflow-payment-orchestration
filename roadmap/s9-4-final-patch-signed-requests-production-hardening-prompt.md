# S9.4 Final Patch Prompt

Work in the northflow-payment-orchestration repository.

This is the final S9.4 patch. Do not split it into another hardening phase.

## Rules

- Keep all output generic and Northflow-only.
- Do not use named external app or consumer examples anywhere.
- Use only generic terms such as API client, consumer backend, REST consumer, SDK consumer, and external integrator.
- Do not implement dashboard work.
- Do not implement provider webhook expansion.
- Do not implement mTLS or private network work.
- Do not weaken existing security behavior.

## Required fixes

Complete all of these in one patch:

1. Remove named external app/project references from active comments, docs, prompts, examples, reports, tests, and roadmap text.
2. Replace or delete obsolete S9.4 prompt wording that uses named consumer examples.
3. Make signed request mode default to required in production and optional outside production when the env var is unset.
4. Update all S9.4 docs so they match the real mode defaults.
5. Create the formal report at `.agents/memory/s9-4-validation.md`.
6. Make protected key handling strict. Invalid or weak key material must fail closed. Do not silently pad, truncate, or accept weak material.
7. Ensure the service and client package share the same canonical request builder behavior. Remove divergent duplicated logic where possible.
8. Verify invalid signed fields never fall back to bearer auth.
9. Verify nonce replay protection is atomic and tested.
10. Update `roadmap/service/main.md` with completed S9.4 status and signing key scopes.

## Required official scopes

```txt
api_client:signing_key:create
api_client:signing_key:read
api_client:signing_key:rotate
api_client:signing_key:revoke
```

## Required validation report

Create `.agents/memory/s9-4-validation.md` with:

```txt
timestamp
git commit checked
files changed
migration result
commands run
pass/fail/skipped results
known pre-existing failures
remaining issues
Northflow-only cleanup result
external reference search result
signed request mode result
production default result
protected key handling result
nonce replay result
shared canonical builder result
client package signing result
route behavior result
audit/redaction result
```

## Required commands

Run and document:

```bash
pnpm type-check
pnpm test
pnpm db:generate
pnpm db:migrate
pnpm --filter @northflow/payment-orchestration-service type-check
pnpm --filter @northflow/payment-orchestration-client-sdk type-check
```

If root workspace is noisy, document it honestly and still run targeted S9.4 tests.

## Final acceptance

S9.4 is complete only when:

```txt
No named external app/project examples remain in active Northflow text.
Production default is required.
Non-production default is optional.
Docs match code.
Weak protected key material is rejected.
Service and client package share canonical request behavior.
Invalid signed fields never fall back to bearer auth.
Nonce replay is rejected and tested.
Formal validation report exists.
All command results are documented honestly.
```

Commit and push all changes.
