# S10.4.1 — Contract Freeze Correction Validation

**Branch:** `feat/s10-4-contract-freeze-release-readiness`
**Date:** 2026-06-09
**Prompt:** `roadmap/service/claude-s10-4-1-contract-freeze-correction-prompt.md`
**Commit base:** `f05a3b5` (S10.4 merge)

---

## Files Changed

| File | Change |
|------|--------|
| `roadmap/service/main.md` | Added 6 missing scopes to Official Authorization Scopes list |
| `docs/security/route-scope-matrix.md` | Corrected 5 payment method routes to show one-of scope alternatives |
| `docs/openapi/payment-orchestration.openapi.json` | Fixed security declarations on 5 one-of routes |
| `docs/payment-orchestration.openapi.json` | Synced to match subdirectory file |
| `docs/release/v0.4.0-release-readiness.md` | Removed SDK all-34-routes overclaim; added admin/ops REST-only note |
| `tests/s10-4-openapi-parity.test.ts` | Added OA12–OA14 (3 new assertions for one-of security correctness) |
| `tests/s10-4-1-contract-freeze-correction.test.ts` | New file — 23 assertions for all correction tasks |
| `.agents/memory/s10-4-1-contract-freeze-correction-validation.md` | This file |

---

## Exact Mismatches Fixed

### Task A — Scope List

`roadmap/service/main.md` Official Authorization Scopes was missing 6 scopes added in later phases:

Added:
- `api_client:signing_key:create`
- `api_client:signing_key:read`
- `api_client:signing_key:rotate`
- `api_client:signing_key:revoke`
- `webhook:manage`
- `webhook:read`

Scope list now has 26 entries (was 20).

### Task B — Route-Scope Matrix One-Of

`docs/security/route-scope-matrix.md` Payment Methods table was showing single required scope.
Corrected 5 routes to document one-of alternatives matching `requireAnyScope` middleware:

| Route | Was | Now |
|-------|-----|-----|
| GET /methods | `payment_method:read` | `payment_method:read` OR `provider_account:read` |
| PUT /methods/{method} | `payment_method:write` | `payment_method:write` OR `provider_account:create` |
| POST /methods/sync | `payment_method:sync` | `payment_method:sync` OR `provider_account:create` |
| GET /payment-methods | `payment_method:read` | `payment_method:read` OR `provider_account:read` OR `intent:read` |
| GET /payment-options | `payment_method:read` | `payment_method:read` OR `intent:read` |

Added explanatory note about `requireAnyScope` middleware.

### Task C — OpenAPI Security

Same 5 routes had single-entry security array. Corrected to multiple security requirement objects per OpenAPI 3.x semantics (OR relationship):

Before: `"security": [{ "apiKey": ["payment_method:read"] }]`
After:  `"security": [{ "apiKey": ["payment_method:read"] }, { "apiKey": ["provider_account:read"] }]`

Both `docs/openapi/payment-orchestration.openapi.json` and `docs/payment-orchestration.openapi.json` updated identically.

### Task D — Release Readiness Overclaim

`docs/release/v0.4.0-release-readiness.md` claimed:
> `[x] PaymentOrchestrationClient covers all 34 documented routes`

SDK does NOT cover:
- `POST /v1/api-clients/{clientId}/credentials`
- `GET /v1/api-clients/{clientId}/credentials`
- `POST /v1/api-clients/{clientId}/credentials/rotate`
- `POST /v1/api-clients/{clientId}/credentials/{credentialId}/revoke`
- `GET /v1/audit-logs`
- `GET /v1/merchants/{merchantId}/payment-methods`

Corrected to:
> SDK covers runtime integration routes only.
> Admin/ops routes (API client credential lifecycle, audit logs) are documented in OpenAPI
> for direct REST/admin usage — not exposed by PaymentOrchestrationClient.

---

## Tests Added/Updated

### `tests/s10-4-openapi-parity.test.ts` (updated)
Added assertions OA12–OA14:
- OA12: one-of routes declare multiple security requirement objects
- OA13: each security requirement has exactly one scope
- OA14: non-one-of routes still have exactly one requirement object

### `tests/s10-4-1-contract-freeze-correction.test.ts` (new — 23 assertions)
- SC01–SC04: main.md scope list completeness (26 scopes)
- SC05–SC09: route-scope-matrix one-of documentation
- SC10–SC15: OpenAPI one-of security shape correctness
- SC16–SC17: release readiness doc honesty
- SC18–SC23: SDK removed methods / aliases

---

## Commands Run

```
pnpm --filter @northflow/payment-orchestration-core type-check   → ✅ clean
pnpm --filter @northflow/payment-orchestration-client-sdk type-check → ✅ clean
pnpm --filter @northflow/payment-orchestration-service type-check → ✅ clean
pnpm test → ✅ 549/549 pass, 0 fail (was 523 before S10.4.1)
```

---

## Invariants Confirmed

- Provider codes unchanged: `manual`, `fake_gateway`, `xendit_sandbox` — not touched
- No route behavior changed
- No DB schema or migration changes
- No inbound HMAC canonical request signing changes
- No outbound merchant webhook signature format changes
- No new payment features added
- No dashboard (`apps/dashboard`) changes
- No legacy aliases reintroduced (`PaymentEngine*`, `Standalone*`, providerAccountId-first)

---

## Remaining Issues

None known. All acceptance criteria met.
