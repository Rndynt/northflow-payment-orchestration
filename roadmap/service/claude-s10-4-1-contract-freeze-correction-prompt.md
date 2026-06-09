# Claude Prompt — S10.4.1 Contract Freeze Correction

You are working in `northflow-payment-orchestration`.

S10.4 was merged to `main`, but review found contract-freeze mismatches. This patch must correct the contract documents/tests only where they are inconsistent with actual service/SDK behavior.

## Hard Rules

- Do not add new payment features.
- Do not add dashboard UI.
- Do not add provider integrations.
- Do not change provider codes: `manual`, `fake_gateway`, `xendit_sandbox`.
- Do not change DB schema or migrations.
- Do not change inbound HMAC canonical request signing.
- Do not change outbound merchant webhook signature format.
- Do not reintroduce SDK legacy aliases, `PaymentEngine*`, `Standalone*`, providerAccountId-first overloads, or ID guessing helpers.
- Do not claim SDK covers routes it does not actually implement.

## Problems to Fix

1. `roadmap/service/main.md` official scope list is stale. It does not include webhook scopes and signing-key scopes added by later phases.
2. `docs/security/route-scope-matrix.md` is inaccurate for routes that use `requireAnyScope`. It documents only one required scope even though actual route code allows one-of scopes.
3. OpenAPI security declarations may also be inaccurate for those one-of routes if they show only one scope.
4. `docs/release/v0.4.0-release-readiness.md` claims `PaymentOrchestrationClient` covers all documented routes, but SDK does not expose admin/ops routes such as API client credentials and audit logs. Either add SDK methods or correct the release doc. Prefer correcting the release doc unless SDK already has clear support for those routes.
5. Tests should guard against this contract drift.

## Task A — Update Canonical Scope List

File:

`roadmap/service/main.md`

Update the official authorization scope list to include all current scopes:

- `merchant:create`
- `merchant:read`
- `provider_account:create`
- `provider_account:read`
- `intent:create`
- `intent:read`
- `payment:create`
- `payment:read`
- `payment:refund`
- `payment:void`
- `payment:reconcile`
- `provider_event:reprocess`
- `payment_method:read`
- `payment_method:write`
- `payment_method:sync`
- `audit_log:read`
- `api_client:credential:create`
- `api_client:credential:read`
- `api_client:credential:revoke`
- `api_client:credential:rotate`
- `api_client:signing_key:create`
- `api_client:signing_key:read`
- `api_client:signing_key:rotate`
- `api_client:signing_key:revoke`
- `webhook:manage`
- `webhook:read`

Do not remove existing valid scopes unless proven unused.

## Task B — Correct Route-Scope Matrix for One-Of Scopes

File:

`docs/security/route-scope-matrix.md`

Match actual route guards in `apps/service/src/routes/paymentMethods.ts`.

The following routes must document one-of scopes, not a single required scope:

- `GET /v1/merchants/{merchantId}/provider-accounts/{providerAccountId}/methods`
  - one-of: `payment_method:read` OR `provider_account:read`
- `PUT /v1/merchants/{merchantId}/provider-accounts/{providerAccountId}/methods/{method}`
  - one-of: `payment_method:write` OR `provider_account:create`
- `POST /v1/merchants/{merchantId}/provider-accounts/{providerAccountId}/methods/sync`
  - one-of: `payment_method:sync` OR `provider_account:create`
- `GET /v1/merchants/{merchantId}/payment-methods`
  - one-of: `payment_method:read` OR `provider_account:read` OR `intent:read`
- `GET /v1/payment-intents/{intentId}/payment-options`
  - one-of: `payment_method:read` OR `intent:read`

Keep webhook scope matrix as:

- `webhook:manage` for create/disable/rotate/replay
- `webhook:read` for endpoint list and delivery list

## Task C — Correct OpenAPI Security for One-Of Scopes

Files:

- `docs/openapi/payment-orchestration.openapi.json`
- `docs/payment-orchestration.openapi.json`

For the same one-of routes, OpenAPI security must represent alternatives correctly.

For OpenAPI, one-of scopes should be represented as multiple security requirement objects, for example:

```json
"security": [
  { "apiKey": ["payment_method:read"] },
  { "apiKey": ["provider_account:read"] }
]
```

Do not represent one-of scopes as a single object requiring all scopes.

Make both OpenAPI files identical for these route definitions.

## Task D — Fix Release Readiness Claim

File:

`docs/release/v0.4.0-release-readiness.md`

Do not claim SDK covers all documented routes unless it actually does.

Correct wording to something like:

- SDK covers the merchant/payment/provider-account/payment-method/signing/webhook runtime integration routes it exposes.
- Admin/ops routes such as API client credential lifecycle and audit logs are documented in OpenAPI and remain direct REST/admin usage unless SDK methods exist.

Keep the release readiness checklist honest. Do not overstate coverage.

## Task E — Add/Update Tests

Add or update static contract tests.

Required assertions:

1. `roadmap/service/main.md` includes `webhook:manage`, `webhook:read`, and all `api_client:signing_key:*` scopes.
2. `docs/security/route-scope-matrix.md` documents one-of scope alternatives for payment method routes.
3. OpenAPI represents one-of scope alternatives using separate security requirement objects for those routes.
4. Release readiness doc does not claim `PaymentOrchestrationClient` covers all 34 documented routes unless SDK methods for all routes exist.
5. SDK still does not expose removed methods/aliases:
   - `deleteProviderAccountMethod`
   - `refundTransaction`
   - `voidTransaction`
   - `PaymentEngine*`
   - `Standalone*`

Prefer adding tests to existing S10.4 test files if clean:

- `tests/s10-4-openapi-parity.test.ts`
- `tests/s10-4-sdk-response-shapes.test.ts`

Or add:

- `tests/s10-4-1-contract-freeze-correction.test.ts`

## Task F — Validation Report

Create:

`.agents/memory/s10-4-1-contract-freeze-correction-validation.md`

Include:

- timestamp
- commit checked
- files changed
- exact mismatches fixed
- scope list updates
- one-of route matrix corrections
- OpenAPI security corrections
- release doc correction
- tests added/updated
- commands run
- type-check results
- test results
- provider codes unchanged confirmation
- no route/db/schema/signature behavior change confirmation
- remaining issues

Do not claim command success unless actually run.

## Required Commands

Run and document:

```bash
pnpm --filter @northflow/payment-orchestration-core type-check
pnpm --filter @northflow/payment-orchestration-client-sdk type-check
pnpm --filter @northflow/payment-orchestration-service type-check
pnpm test
```

## Acceptance Criteria

Complete only when:

- `roadmap/service/main.md` official scope list is current.
- Route-scope matrix matches actual one-of route guards.
- OpenAPI security represents one-of scopes correctly.
- Release readiness doc no longer overclaims SDK route coverage.
- Tests guard the corrected contracts.
- Provider codes remain unchanged.
- No route, DB schema, migration, inbound HMAC, or outbound webhook signature behavior changed.
- Type-check and full tests pass or failures are honestly documented.
- Validation report exists.

Commit and push all changes.
