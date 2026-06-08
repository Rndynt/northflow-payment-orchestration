# S10.2 Integration Contract & Merchant Onboarding Validation

## Timestamp

2026-06-08T11:10:41Z

## Git commit checked

Base commit checked before this phase: `4c99c5328f4b29137aedce53502fc06e909a3831`.

## Files changed

- `.agents/memory/s10-2-integration-contract-merchant-onboarding-validation.md`
- `docs/integration/client-integration-contract.md`
- `docs/integration/env-template.md`
- `docs/integration/idempotency-guide.md`
- `docs/integration/merchant-integration-guide.md`
- `docs/integration/payment-lifecycle.md`
- `docs/integration/payment-method-options.md`
- `docs/integration/refund-void.md`
- `docs/integration/rest-quickstart.md`
- `docs/integration/sdk-quickstart.md`
- `docs/integration/security-checklist.md`
- `docs/integration/status-polling.md`
- Three legacy named-consumer integration documents were removed and replaced by generic docs.
- `examples/merchant-backend/README.md`
- `examples/merchant-backend/.env.example`
- `examples/merchant-backend/sdk-checkout-flow.ts`
- `examples/merchant-backend/rest-checkout-flow.md`
- `packages/client-sdk/src/client.ts`
- `roadmap/service/main.md`
- `tests/s10-2-sdk-integration-contract.test.ts`
- `tests/s10-2-rest-contract-docs.test.ts`

## SDK/REST route parity findings

Audited `packages/client-sdk/src/client.ts`, `packages/client-sdk/src/types.ts`, `apps/service/src/routes/*`, and `apps/service/src/app.ts`.

Findings:

- Payment intent, status, refundability, gateway payment, transaction refresh, refund, void, reconcile, merchant, fake gateway, and readiness routes already matched current service mounts.
- Provider account creation/read SDK routes already used merchant-nested service mounts.
- Provider-account method SDK routes were still using old non-nested `/v1/provider-accounts/...` paths. Fixed to call `/v1/merchants/:merchantId/provider-accounts/:providerAccountId/methods...`.
- Signing-key SDK routes were still using old `/v1/signing-keys...` paths. Fixed to call `/v1/api-clients/:clientId/signing-keys...`.
- `refundTransaction` and `voidTransaction` remain deprecated compatibility aliases for official `refundPaymentTransaction` and `voidPaymentTransaction`.

## SDK methods verified

Verified by smoke tests:

- `createPaymentIntent`
- `getPaymentIntentStatus`
- `getRefundability`
- `createGatewayPayment`
- `refreshProviderStatus`
- `getPaymentOptions`
- `refundPaymentTransaction`
- `refundTransaction`
- `voidPaymentTransaction`
- `voidTransaction`
- `reconcilePaymentIntentTotals`
- `createMerchant`
- `getMerchant`
- `createProviderAccount`
- `getProviderAccount`
- `listProviderAccountMethods`
- `upsertProviderAccountMethod`
- `deleteProviderAccountMethod`
- `syncProviderAccountMethods`
- `createSigningKey`
- `listSigningKeys`
- `rotateSigningKey`
- `revokeSigningKey`
- `confirmFakeGatewayPayment`
- `getReadiness`

## REST docs created

- `docs/integration/rest-quickstart.md`
- `examples/merchant-backend/rest-checkout-flow.md`

## Integration docs created

- `docs/integration/merchant-integration-guide.md`
- `docs/integration/sdk-quickstart.md`
- `docs/integration/rest-quickstart.md`
- `docs/integration/env-template.md`
- `docs/integration/payment-lifecycle.md`
- `docs/integration/idempotency-guide.md`
- `docs/integration/payment-method-options.md`
- `docs/integration/status-polling.md`
- `docs/integration/refund-void.md`
- `docs/integration/security-checklist.md`
- Updated `docs/integration/client-integration-contract.md` to be generic and Northflow-only.

## Examples created/skipped with reason

Created:

- `examples/merchant-backend/README.md`
- `examples/merchant-backend/.env.example`
- `examples/merchant-backend/sdk-checkout-flow.ts`
- `examples/merchant-backend/rest-checkout-flow.md`

No requested sample artifact was skipped.

## Commands run

- `pnpm install` (installed missing workspace dependencies required for service type-check/tests in this environment)
- `pnpm --filter @northflow/payment-orchestration-core type-check`
- `pnpm --filter @northflow/payment-orchestration-client-sdk type-check`
- `pnpm --filter @northflow/payment-orchestration-service type-check`
- `pnpm --filter @northflow/payment-orchestration-service test`
- `pnpm test`
- `npx tsx --tsconfig tests/tsconfig.json --test tests/s10-2-sdk-integration-contract.test.ts tests/s10-2-rest-contract-docs.test.ts`
- `grep -R "NEXT_PUBLIC_.*NORTHFLOW\|VITE_.*NORTHFLOW\|EXPO_PUBLIC_.*NORTHFLOW" docs examples packages apps tests -n || true`
- `grep -R "bank_transfer\|qr_code" docs/integration examples packages/client-sdk apps/service tests -n || true`
- `grep -R "merchant outbound webhook is implemented\|callback delivery is implemented" docs/integration examples -n || true`
- `rg -n <legacy named-consumer patterns> roadmap/service/main.md docs/integration examples tests/s10-2-* || true`

## Type-check results

- `pnpm --filter @northflow/payment-orchestration-core type-check`: pass.
- `pnpm --filter @northflow/payment-orchestration-client-sdk type-check`: pass.
- `pnpm --filter @northflow/payment-orchestration-service type-check`: pass after `pnpm install` restored missing dependencies.

## Test results

- `npx tsx --tsconfig tests/tsconfig.json --test tests/s10-2-sdk-integration-contract.test.ts tests/s10-2-rest-contract-docs.test.ts`: pass, 11/11.
- `pnpm --filter @northflow/payment-orchestration-service test`: exit 0; the package does not define a test script, so pnpm produced no test output.
- `pnpm test`: pass, 492/492.

## Known failures

Initial pre-install service type-check and full test attempts failed because dependencies such as `express`, `postgres`, and `drizzle-orm` were missing from `node_modules`. Running `pnpm install` resolved the environment dependency issue. No known remaining failures.

## Security checklist result

Pass. The new docs and examples enforce backend-only API key/signing-secret usage, warn against frontend/public env prefixes, document TLS, least privilege scopes, merchant access grants, credential/key rotation, idempotency, and safe logging.

## Northflow-only search result

S10.2 docs, examples, roadmap, and new tests use generic Northflow merchant terminology. The legacy named-consumer pattern search across `roadmap/service/main.md`, `docs/integration`, `examples`, and `tests/s10-2-*` returned no matches.

## Named external consumer project search result

Removed old named consumer integration documents and replaced the roadmap integration model with generic merchant/backend terminology. Existing historical tests outside S10.2 still include older synthetic source app names for legacy smoke coverage, but S10.2 generated docs/examples/tests do not introduce named external consumer project references.

## Grep check results

- Public frontend env prefix check: no matches.
- Old method name check: matches remain only where explicitly documented as old names not to use, in provider implementation compatibility code, and in historical tests. No docs/examples recommend those names as current method types.
- Merchant outbound webhook implementation claim check: no matches.

## Remaining issues

- Provider adapters and historical tests still contain provider-specific `bank_transfer` strings. This phase did not change provider codes/runtime behavior because that is out of scope.
- `pnpm --filter @northflow/payment-orchestration-service test` is a no-op because the service package has no `test` script.
