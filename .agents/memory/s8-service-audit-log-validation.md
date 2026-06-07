---
name: S8 Service Audit Log
description: Implementation decisions and gotchas for the S8 audit log feature (migration, domain, repo, routes, tests).
---

# S8 Service Audit Log

## Rule
Audit calls in routes use `void auditXxx(...)` (fire-and-forget). `auditService.ts` catches and swallows repo errors internally — audit failures NEVER propagate to the calling client.

**Why:** Audit is best-effort; blocking payments on audit DB failures is unacceptable.

**How to apply:** Always prefix audit calls with `void`. Never await them before sending the response.

## InMemoryAuditLogRepository ordering
In-memory repo must use a monotonic counter (`seq`) to increment `createdAt` timestamps — otherwise two entries created in the same millisecond produce non-deterministic "newest-first" ordering in tests.

**Why:** JavaScript `new Date()` resolution is 1ms; rapid sequential creates get identical timestamps.

**How to apply:** `createdAt = new Date(Date.now() + this.seq++)` in the in-memory create() method.

## HTTP integration tests — use node:http + fetch, not supertest
The test runner uses ESM. `supertest` requires `supertest/index.js` path in ESM and is fragile. All existing HTTP tests use `node:http.createServer` + native `fetch`.

**Why:** ESM `import('supertest')` fails in tsx; native fetch is available in Node >=18.

**How to apply:** Spin up `http.createServer(app)`, bind port 0, use `fetch` for all HTTP calls. Tear down in `after()`.

## Intent ID extraction in tests
`CreatePaymentIntent` use case assigns its own UUID (prefixed `pi_`). Tests that chain intent creation → status/gateway-payments must extract the intent ID from the POST response body (`body.data.id`), NOT pass `id:` in the creation body and expect it to stick.

**Why:** The use case ignores caller-supplied IDs; it generates its own.

## Container auditRepo wiring
`ServiceContainer.auditRepo` is optional. Routes check `container.auditRepo` before calling `auditService.writeAuditLog`. In-memory test containers set `auditRepo` directly on the container object — no dedicated repo injection needed.

## Validation outcome (2026-06-07)
Migration 0008_po_audit_logs applied. Type-check: 0 errors. Tests: 351/351 pass (324 prior + 27 new S8 tests).
