---
name: apiErrorResponse toJSON serialization
description: The error field in apiErrorResponse serializes as a string (the code) over HTTP due to toJSON(). Tests must handle both forms.
---

## Rule

`apiErrorResponse(code, message)` returns `{ ok: false, error: { code, message, details, toJSON() { return this.code; } } }`.

When Express serializes this with `res.json()`, the `error` field in the JSON becomes the code **string** (e.g. `"UNAUTHORIZED"`), not an object.

**Why:** The `toJSON()` method on the error object makes `JSON.stringify` emit the code string directly. This is the Phase 8K "frozen error envelope" contract — client SDKs and tests that parse `body.error` as a string get the code directly.

**How to apply:**

In HTTP integration tests, use a helper that handles both forms:
```ts
function errCode(body: Record<string, unknown>): string {
  const err = body['error'] as any;
  if (!err) return '';
  if (typeof err === 'string') return err;          // HTTP: toJSON serialized
  return typeof err === 'object' ? (err.code ?? '') : ''; // unit: direct object
}
```

In unit tests where the `denied.body` object is used before JSON serialization, `denied.body.error.code` works directly.

The existing legacy test (payment-orchestration-service-http-auth.test.ts) checks `body.error === 'UNAUTHORIZED'` (string form) — this is correct for the HTTP layer.
