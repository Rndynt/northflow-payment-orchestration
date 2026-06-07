---
name: S9.4 HMAC signed requests
description: Critical quirks found when implementing and validating HMAC signed request auth in the Express service
---

## Rule: use `req.baseUrl + req.path` for canonical path in auth middleware

The auth middleware is mounted at `app.use('/v1', auth)`. Express strips the mount prefix from `req.path` inside the middleware, so `req.path` becomes `/api-clients/...` rather than `/v1/api-clients/...`. The client always signs the full path. Fix in `signedAuth.ts`:

```typescript
const path = req.baseUrl + req.path; // NOT req.path alone
```

**Why:** `req.path` inside a mounted middleware loses the prefix; `req.baseUrl + req.path` reconstructs the full path the client signed.

**How to apply:** Any signed-request verification that reads the path from Express `req` must use `req.baseUrl + req.path`.

## Rule: run S9.4 tests with `npx tsx --tsconfig tests/tsconfig.json --test`, not `node --import tsx/esm --test`

The `node --import tsx/esm --test` variant causes `ERR_REQUIRE_CYCLE_MODULE` for the S9.4 test file due to the module graph of the signed auth imports. The correct command matches the rest of the test suite:

```
npx tsx --tsconfig tests/tsconfig.json --test tests/s9-4-signed-requests-hmac.test.ts
```

**Why:** tsx's `--test` mode handles ESM/CJS interop differently and avoids the cycle error.

## Outcome

- 22/22 S9.4 tests pass
- Full suite: 444/444 pass
