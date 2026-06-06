---
name: S1-S5 per-client auth
description: Per-client API credential model replacing shared service token. Legacy token remains as fallback.
---

# S1-S5 per-client auth

## The rule
- Token format: `nf_{8-char-prefix}_{random-hex}`. Prefix used for DB lookup; SHA-256 hash stored.
- `req.auth` typed as `RequestAuthContext` (clientId, sourceApp, environment, credentialId, scopes).
- Scopes stored on `paymentOrchestrationApiClients.scopes` (jsonb). Wildcard `'*'` grants all.
- `ServiceContainer.authRepos` is optional (`AuthRepos?`) — tests without DB stay backward-compatible.

**Why:** Existing in-memory test containers built containers without auth repos. Making it optional avoids breaking all existing tests while enabling the new auth for production use.

**How to apply:**
- New routes: add `requireScope('scope:action')` + `assertMerchantAccess(req.auth!, merchantId, accessRepo)`.
- `assertMerchantAccess` and `assertSourceApp` are no-ops when `clientId='legacy'` or `sourceApp='internal'`.
- Legacy mode: `PAYMENT_ORCHESTRATION_LEGACY_SERVICE_TOKEN_ENABLED` — dev default true, prod default false.
- After merchant creation, grant access: `accessRepo.create({ clientId: req.auth.clientId, merchantId })`.
