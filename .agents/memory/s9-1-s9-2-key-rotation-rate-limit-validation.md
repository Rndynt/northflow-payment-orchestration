---
name: S9.1-S9.2 key rotation and rate limit validation
description: Implementation decisions and test results for S9.1 (credential lifecycle) and S9.2 (rate limiting).
---

# S9.1 — API Key Rotation and Credential Lifecycle

## Implementation decisions

**Interface extension:**  
`listByClientId(clientId: string): Promise<ClientCredentialDTO[]>` added as required method on
`ClientCredentialRepository` (packages/core). All three existing test in-memory repos updated
to add the method (one-liner filter). DrizzleClientCredentialRepository uses `orderBy(desc(createdAt))`.

**Use cases — constructor signatures:**
- `CreateCredential(apiClientRepo, credentialRepo)` — generates `nf.<env>.<credentialId>.<secret>`, UUID-without-hyphens as credentialId
- `ListCredentials(credentialRepo)` — returns `SafeCredentialView[]` (no hash)
- `RevokeCredential(credentialRepo)` — idempotent; rejects cross-client by checking `credential.clientId !== input.clientId`
- `RotateCredential(apiClientRepo, credentialRepo)` — silently skips revoking credentials that belong to other clients (no enumeration)

**SafeCredentialView:** Omits `credentialHash` by construction. All routes return this type, never the raw DTO.

**Routes** registered at `/v1/api-clients/:clientId/credentials` in `apiClientCredentials.ts`:  
`/rotate` must be registered BEFORE `/:credentialId/revoke` to avoid 'rotate' matching as a credentialId param.

**Access control:** `isSystemClient` = `clientId === 'legacy' || sourceApp === 'internal'` — bypass ownership checks.
Normal clients get 403 CREDENTIAL_NOT_OWNED if target clientId != auth.clientId.

**New scopes:** `api_client:credential:create/read/revoke/rotate` — NOT added to roadmap main.md scope table yet (can be added later).

**Audit invariants:** metadata includes `credentialId`, `credentialPrefix`, `status`, `expiresAt` — never `rawCredential`, `credentialHash`, or Authorization header values.

## Test results: 23/23 pass (13 unit + 10 HTTP integration)

---

# S9.2 — Rate Limit and Abuse Protection

## Implementation decisions

**`InMemoryRateLimiterStore`:** Fixed-window. Window boundaries aligned to clock (`Math.floor(now/windowMs)*windowMs`).
Stale entries pruned on every `hit()` call to prevent unbounded growth.

**`createRateLimitMiddleware`:** Applied at `app.use('/v1', rateLimitMiddleware)` AFTER auth middleware.
Checks: (1) global client bucket → (2) per-route bucket. Sets X-RateLimit-* headers on every authenticated request.
Rate limiter failures are logged but never block requests (fail-open).

**Auth failure rate limiting in `auth.ts`:** Injected via `AuthMiddlewareOptions.rateLimiter`.
Called at every 401 exit point. Returns 429 instead of 401 when IP threshold exceeded.
Prefix counter also hit (best-effort, fire-and-forget) — never reveals whether prefix exists in DB.

**Container:** `rateLimiter?: RateLimiterStore` added to `ServiceContainer`. Created as `InMemoryRateLimiterStore`
in `createContainer()`. Passed to auth middleware and rate limit middleware in `app.ts`.

**Config:** 4 new env vars in `PaymentOrchestrationServiceConfig` — all optional (default values applied in `loadEnv()`).
Tests set `rateLimitEnabled: false` to disable limiting.

**`RATE_LIMITED` error code** added to `PAYMENT_ORCHESTRATION_ERROR_CODES` and normalizer's status mapping (429).

**Phase bumped:** `env.ts` phase changed from `'8K'` to `'S9'`. Updated the 8K contract freeze test to accept either value.

## Test results: 12/12 pass (4 unit + 8 HTTP integration)

## Full suite: 386/386 pass

**Why:** The `apiErrorResponse.toJSON()` returns just the code string, not `{code, message}` — test assertions on rate limit response body must use `body.error?.code ?? body.error` pattern.
