---
name: S6-S7 Client Integration Validation
description: Validation results for Phase S6 (Client Integration Contract) and S7 (Integration Smoke Tests).
---

## Result: PASS

- **Date**: 2026-06-07
- **S7 smoke tests**: 35/35 pass (0 fail)
- **Full suite**: 284/284 pass (0 fail)
- **Type-check service**: clean
- **Type-check SDK**: clean
- **Type-check dashboard**: 2 pre-existing errors (TS2430, TS5097) — unrelated to S6/S7 work

---

## S6: Client Integration Contract

### SDK changes (packages/client-sdk)
- `types.ts`: Added `apiKey?: string` to `PaymentOrchestrationClientConfig`
- `client.ts`: Constructor now prefers `Authorization: Bearer <apiKey>` over legacy `x-payment-orchestration-service-token`; backward-compat for `serviceToken` preserved
- `index.ts`: JSDoc updated — recommended usage shows `apiKey`; legacy `serviceToken` usage documented as deprecated dev-only

### Docs created (docs/integration/)
- `client-integration-contract.md` — frozen contract covering auth model, identity mapping, scope table, error codes, idempotency rules, sourceApp enforcement
- `consumer-a-rest-integration.md` — Consumer A REST walkthrough: merchant → PA → intent → gateway payment → status → refund/void
- `consumer-b-sdk-integration.md` — Consumer B SDK walkthrough using `PaymentOrchestrationClient` with `apiKey`
- `consumer-c-rest-integration.md` — Consumer C REST walkthrough: merchant → PA → intent → gateway payment → status

---

## S7: Integration Smoke Tests

File: `tests/payment-orchestration-s7-client-integration-smoke.test.ts`

### S7.1 — Seed
- 3 API clients seeded per describe block (consumer-a, consumer-b, consumer-c) using `generateCredential` and in-memory repos
- Per-client credential format: `nf.live.<credentialId>.<secret>`

### S7.2 — Positive smoke flows (15 tests)
| Suite | Tests | Result |
|-------|-------|--------|
| Consumer A REST | AP1-AP6: merchant → PA → intent → gateway payment → status → void | ✅ |
| Consumer B SDK | TR1-TR5: same flow via `PaymentOrchestrationClient` with `apiKey` | ✅ |
| Consumer C REST | KK1-KK5: merchant → PA → intent → gateway payment → status (OTC) | ✅ |

Key assertions:
- `VoidPaymentTransaction` properly wired — requires_action → cancelled confirmed
- `RefundPaymentTransaction` and `VoidPaymentTransaction` constructor: `(transactionRepo, intentRepo, providerAccountRepo, providerRegistry)` — no idempotency repo

### S7.3 — Negative isolation (12 tests)
| Test | Assertion |
|------|-----------|
| N01-N06 | Cross-app merchant access → 403 MERCHANT_ACCESS_DENIED |
| N07-N09 | sourceApp spoof (consumer-a→consumer-b, consumer-b→consumer-c, consumer-c→consumer-a) → 403 SOURCE_APP_MISMATCH |
| N10 | Client without `payment:refund` scope → 403 SCOPE_DENIED |
| N11 | Client without `payment:void` scope → 403 SCOPE_DENIED |
| N12 | Client without `provider_account:create` scope → 403 SCOPE_DENIED |

### S7.4 — REST vs SDK parity (7 tests)
| Test | Assertion |
|------|-----------|
| P01 | SDK sends `Authorization: Bearer <apiKey>` — not legacy header |
| P02 | Legacy `serviceToken` uses `x-payment-orchestration-service-token` |
| P03 | SDK injects `merchantId` from config into POST body |
| P04 | SDK throws `PaymentOrchestrationClientError` with `status=401, code=UNAUTHORIZED` |
| P05 | SDK throws `PaymentOrchestrationClientError` with `code=MERCHANT_ACCESS_DENIED` |
| P06 | SDK throws `PaymentOrchestrationClientError` with `code=SCOPE_DENIED` |
| P07 | SDK passes `sourceApp` through in request body |

---

## Auth Model (Confirmed Working)

- Primary: `Authorization: Bearer nf.<env>.<credentialId>.<secret>`
- Alternative: `x-nf-api-key: nf.<env>.<credentialId>.<secret>`
- Legacy: `x-payment-orchestration-service-token` — disabled in S7 containers (`legacyServiceTokenEnabled: false`)

## Confirmed Scope Names
```
merchant:create, merchant:read
provider_account:create, provider_account:read
intent:create, intent:read
payment:create, payment:refund, payment:void
```
