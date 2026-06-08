# S10.2.1 Clean API Contract Patch

Northflow is not live yet. Remove redundant pre-launch compatibility APIs and keep one strict public contract.

## Scope

- No new feature.
- No dashboard work.
- No database schema change.
- No provider code rename.
- No HMAC canonical format change.
- Provider codes stay: manual, fake_gateway, xendit_sandbox.

## Required cleanup

1. In packages/client-sdk/src/client.ts, keep only merchantId-first provider account methods:
   - listProviderAccountMethods(merchantId, providerAccountId)
   - upsertProviderAccountMethod(merchantId, providerAccountId, input)
   - deleteProviderAccountMethod(merchantId, providerAccountId, method)
   - syncProviderAccountMethods(merchantId, providerAccountId)

2. Remove providerAccountId-first overloads and ID guessing helpers.

3. Remove SDK aliases refundTransaction and voidTransaction. Keep refundPaymentTransaction and voidPaymentTransaction only.

4. Remove SDK PaymentEngine aliases. Keep PaymentOrchestration names only.

5. Audit SDK serviceToken. Public merchant SDK should use apiKey and optional request signing unless serviceToken is still strictly required and documented.

6. Remove active core Standalone aliases from PaymentIntent, PaymentTransaction, ports, and core index exports.

7. Remove service Standalone provider shim files if they only re-export current provider files. Keep PaymentProviderAdapter, FakeGatewayProvider, and ManualProvider.

8. Update active tests, current docs, examples, and scripts to use only strict current names.

9. Add or update tests proving old aliases, old overloads, ID guessing helpers, and Standalone shims are gone from active code.

10. Create .agents/memory/s10-2-1-clean-api-contract-validation.md with files changed, removed aliases, final SDK method list, commands run, type-check/test results, provider codes unchanged, and no route/db/schema change confirmation.

11. Current docs/examples/tests must not present old aliases or providerAccountId-first calls as usable API.

## Required validation

Run:

- pnpm --filter @northflow/payment-orchestration-core type-check
- pnpm --filter @northflow/payment-orchestration-client-sdk type-check
- pnpm --filter @northflow/payment-orchestration-service type-check
- pnpm test

Commit and push all changes.
