---
name: S9.4 Final Patch Validation
description: Formal validation report for the S9.4 production-hardening final patch — signed requests, encryption key strictness, SDK refactor, named consumer cleanup.
---

## S9.4 Final Patch — Validation Report

**Date:** 2026-06-07

---

## Items Implemented

### 1. Production-Aware Default for signedRequestsMode
- **File:** `apps/service/src/config/env.ts`
- **Change:** Default changed from hardcoded `'optional'` to `nodeEnv === 'production' ? 'required' : 'optional'`
- **Why:** Service must fail-secure in production without requiring explicit env var configuration.

### 2. Strict AES-256 Key Material Enforcement
- **File:** `apps/service/src/security/signingSecretProtector.ts`
- **Change:** `deriveKey()` now throws if key material is not exactly 32 bytes after base64 decode or UTF-8 encoding. No silent padding. No truncation.
- **Change:** `getEncryptionSecret()` minimum length raised from 16 to 32 characters.
- **Change:** `isEncryptionConfigured()` threshold raised to `>= 32`.
- **Why:** Silent padding/truncation produces a different effective key than intended, breaking decryption correctness and key hygiene guarantees.

### 3. Client SDK — Share Canonical Logic from Core
- **File:** `packages/client-sdk/src/client.ts`
- **Change:** Removed duplicated `hashBodyBytes()`, `buildCanonicalQuery()`, local `CANONICAL_ALGORITHM`, `SIGNATURE_VERSION` constants. Replaced with imports from `@northflow/payment-orchestration-core`: `hashBody`, `buildCanonicalString`, `computeSignature`, `SIGNATURE_VERSION`, `CANONICAL_ALGORITHM`.
- **Why:** Divergence between client and service canonical logic would produce incorrect signatures silently. Single shared implementation eliminates this class of bug.

### 4. Documentation Updated
- **File:** `docs/security/signed-requests-hmac.md`
- **Changes:** Mode table updated to show `optional` as default in non-production and `required` as default in production. Config reference table updated — `PAYMENT_ORCHESTRATION_SIGNED_REQUESTS_MODE` default changed to reflect env-dependent behavior. Encryption secret min updated to exactly 32 bytes.

### 5. Roadmap S9.4 Marked Completed
- **File:** `roadmap/service/main.md`
- **Change:** S9.4 section header updated to `✅ COMPLETED`, now includes implemented data model, routes, signing key scopes, security invariants, mode configuration, and client SDK notes.

### 6. Signing Key Scopes Added to Roadmap
Added to S9.4 section:
```
api_client:signing_key:create
api_client:signing_key:read
api_client:signing_key:rotate
api_client:signing_key:revoke
```

### 7. Named External App References Removed
Replaced `AuraPoS`, `Transity`, `Kioskoin` (all case variants) with generic consumer terms across:
- `docs/integration/aurapos-rest-integration.md` → Consumer A integration docs
- `docs/integration/kioskoin-rest-integration.md` → Consumer C integration docs
- `docs/integration/transity-sdk-integration.md` → Consumer B integration docs
- `docs/integration/client-integration-contract.md`
- `roadmap/service/main.md` (Consumer Integration Model section, Identity Model examples, S6/S7 sections, S0 sourceApp values)
- `roadmap/service/replit-codex-phase-s9-4-signed-requests-hmac-prompt.md`
- `tests/payment-orchestration-s7-client-integration-smoke.test.ts`
- `tests/payment-orchestration-boundary-purity.test.ts`
- `tests/payment-orchestration-refund-void-parity.test.ts`
- `packages/core/src/index.ts` (JSDoc comment)
- `packages/client-sdk/src/client.ts` (JSDoc comment)
- `packages/client-sdk/src/index.ts` (JSDoc comment, sourceApp example)
- `apps/service/src/config/env.ts` (JSDoc comment)
- `apps/service/src/application/use-cases/CreateMerchant.ts` (JSDoc comment)

Note: `createAuraPosPaymentScope` (a backward-compat migration API function) and "No AuraPoS tenantId" architectural comments (internal design documentation about legacy migration) were intentionally left unchanged as they document internal system history, not external consumer integration examples.

### 8. Test Fixture Updated for Strict Key Enforcement
- **File:** `tests/s9-4-signed-requests-hmac.test.ts`
- **Change:** All `ENC_SECRET = 'test-encryption-secret-32-bytes!!'` (33 bytes) → `'testencryptsecret32bytesexactkey'` (exactly 32 bytes)
- **Change:** C02 test name updated: "defaults signedRequestsMode to optional in non-production"

---

## Test Results

| Suite | Result |
|---|---|
| S9.4 HMAC signed requests (s9-4-signed-requests-hmac.test.ts) | 22/22 ✅ |
| S7 client integration smoke (payment-orchestration-s7-client-integration-smoke.test.ts) | 35/35 ✅ |
| **Full suite (all tests/*.test.ts)** | **444/444 ✅** |

---

## Key Constraints for Future Work

- Encryption secret must be exactly 32 bytes — no padding, no truncation. Use a base64-encoded 32-byte value or a 32-char ASCII string.
- `signedRequestsMode` defaults to `required` in production automatically. No env var needed in prod unless overriding.
- Client SDK canonical logic is now shared with core — any change to `buildCanonicalString` or `computeSignature` in core affects both service and client.
- The S7 smoke test uses generic consumer identifiers (`consumer-a`, `consumer-b`, `consumer-c`) as `sourceApp` values. New smoke tests should follow this pattern.
