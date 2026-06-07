# Replit/Codex Prompt — P0 Payment Orchestration Full Fix

## Context

You are working in the repository:

```text
Rndynt/northflow-payment-orchestration
```

This repository is a standalone payment orchestration service extracted from the legacy monorepo. It currently contains:

- `packages/core` — domain contracts, DTOs, repository/provider interfaces.
- `packages/client-sdk` — typed HTTP client SDK.
- `apps/service` — Express REST service, Drizzle repositories, provider adapters, workers.
- `docs` — API contract and architecture documentation.
- `tests` — unit/integration tests.

The current service already supports merchants, provider accounts, payment intents, gateway payments, webhooks, refresh provider status, refund, void, manual provider, FakeGateway, Xendit sandbox, workers, and SDK integration.

This task merges all findings from two independent reviews. Implement all fixes in this prompt as one complete production-readiness pass.

## Non-Negotiable Rules

1. Do not remove existing public API paths unless explicitly replaced with backward-compatible behavior.
2. Do not remove manual/cash/offline payment support.
3. Do not remove FakeGateway dev/test support.
4. Do not store raw provider secrets in the DB or API responses.
5. Keep the standalone boundary clean:
   - No legacy session middleware.
   - No legacy order domain dependency.
   - No embedded payment runtime dependency.
   - Use `merchantId`, not legacy `tenantId`, as the primary payment-owner scope.
6. Keep TypeScript strict and ESM-compatible.
7. Prefer small reusable helpers over duplicated logic.
8. Add tests for every changed money-moving behavior.
9. After implementation, run:

```bash
pnpm type-check
pnpm test
pnpm extraction-check
```

If any script fails because of environment-only requirements, document the exact reason in the final report and still run all tests that can run without external network/provider credentials.

---

# Primary Goal

Make the payment orchestration service safe enough for production-like payment flows by fixing:

- Money consistency and concurrency races.
- Partial payment policy enforcement.
- Refund/void correctness.
- Idempotency correctness.
- Webhook safety.
- Error contract consistency.
- Security hardening.
- Operational reliability.

---

# P0 Fixes — Must Implement

## P0.1 — Implement Atomic Payment Mutations / Unit of Work

### Problem

Multiple use cases perform multi-step DB mutations without a database transaction. Examples:

- `CreateGatewayPayment`
  - provider call
  - transaction create
  - intent totals update
  - intent status update
  - idempotency completion

- `ConfirmFakeGatewayPayment`
  - mark transaction succeeded
  - update intent totals
  - update intent status

- `HandleProviderWebhook`
  - reserve provider event
  - mark transaction succeeded/failed/cancelled/expired
  - update intent totals/status
  - mark provider event processed/failed

- `RefreshProviderStatus`
  - provider polling
  - transaction status update
  - intent totals/status update

- `RefundPaymentTransaction`
  - create refund transaction
  - provider refund call
  - update refund transaction status
  - update intent amountRefunded

- `VoidPaymentTransaction`
  - provider cancel call
  - update transaction status/metadata

- `ReprocessProviderEvents`
  - replay parsed event
  - apply transaction mutation
  - update intent totals/status
  - mark event processed/failed

If the process crashes between these steps, the database can become inconsistent. The existing reconcile use case is useful, but it must remain a safety net, not the normal consistency mechanism.

### Required Fix

Implement a transactional mutation pattern.

Recommended approach:

1. Add a transaction-capable repository factory or Unit of Work helper.
2. Ensure repositories can operate using either the root Drizzle DB or a transaction-scoped DB object.
3. Wrap all multi-step DB updates in `db.transaction(async (txDb) => { ... })`.
4. Do not hold a DB transaction open during long external provider HTTP calls when avoidable.

Suggested pattern:

- For provider calls:
  1. Validate and reserve internal state/idempotency before provider call.
  2. Call provider outside the DB transaction when possible.
  3. Re-enter DB transaction to persist provider result and update state atomically.

- For webhook/confirm/reprocess:
  1. Use DB transaction for transaction state mutation + intent totals/status mutation + provider event status mutation.

### Must-Have Atomicity Guarantees

- A transaction cannot become `succeeded` without the parent intent totals/status eventually changing in the same DB transaction.
- A succeeded refund cannot update `amountRefunded` without a corresponding outgoing refund transaction in the same DB transaction.
- Provider event `processed` must only be set after the payment mutation succeeds.
- Idempotency key `completed` must only be set after the response resource is persisted.

### Acceptance Criteria

- Crash window between transaction status and intent totals is removed for all normal flows.
- Tests prove that failed mutations roll back all related state.
- Existing `ReconcilePaymentIntentTotals` remains available as recovery tooling, but normal happy path no longer relies on it.

---

## P0.2 — Lock Intent Row / Prevent Concurrent Partial Payment Drift

### Problem

The current code uses atomic `markSucceededIfConfirmable()` per transaction, but multiple different transactions for the same intent can confirm concurrently.

Example race:

1. Intent amount due = 100, amount remaining = 100.
2. TX A amount = 70 and TX B amount = 70 are both pending.
3. A and B confirm at the same time.
4. Both read the same stale `intent.amountRemaining = 100`.
5. Both pass overpayment guard.
6. Both mark their own transaction succeeded.
7. Intent totals can drift, or two succeeded txs can exceed due amount.

### Required Fix

When confirming or succeeding a transaction, lock the parent intent row or use an atomic guarded update.

Implement one of these patterns:

#### Preferred Pattern: Row Lock

Inside DB transaction:

```sql
SELECT * FROM payment_orchestration_intents
WHERE id = $intentId AND merchant_id = $merchantId
FOR UPDATE;
```

Then recompute based on the locked/fresh intent state.

#### Alternative Pattern: Atomic Guarded Update

Use an update like:

```sql
UPDATE payment_orchestration_intents
SET amount_paid = amount_paid + $amount,
    amount_remaining = amount_remaining - $amount,
    updated_at = now()
WHERE id = $intentId
  AND merchant_id = $merchantId
  AND amount_remaining >= $amount
RETURNING *;
```

If no row is returned, reject with `OVERPAYMENT_REJECTED`.

### Acceptance Criteria

- Two concurrent confirmations cannot over-credit an intent.
- Two different pending transactions cannot both succeed if their combined amount exceeds remaining amount.
- Intent totals always equal the sum of succeeded incoming payment/deposit/settlement transactions minus appropriate adjustments.
- Add a concurrency test for this scenario.

---

## P0.3 — Enforce `allowPartial` Correctly

### Problem

`PaymentIntent` has `allowPartial`, but `CreateGatewayPayment` currently only rejects overpayment (`amount > amountRemaining`). It does not reject partial amount when `allowPartial=false`.

This means a full-payment-only intent can still be paid partially.

### Required Fix

In `CreateGatewayPayment`, after loading the intent and before calling the provider:

- If `intent.allowPartial === false`, require:

```ts
input.amount === intent.amountRemaining
```

- If not equal, throw:

```ts
{ statusCode: 422, code: 'PARTIAL_PAYMENT_NOT_ALLOWED' }
```

- If `intent.allowPartial === true`, allow `0 < amount <= amountRemaining`.

### Acceptance Criteria

- Full-only intent cannot create gateway payment for less than remaining amount.
- Partial intent can create multiple payments until fully paid.
- Tests cover both policies.

---

## P0.4 — Block Payments for Terminal or Expired Intents

### Problem

`CreateGatewayPayment` does not sufficiently validate the current intent lifecycle before creating another payment.

It should not create new payment transactions for:

- `paid`
- `overpaid`
- `refunded`
- `voided`
- `expired`
- `cancelled`
- `failed`

It should also reject intents whose `expiresAt` is in the past.

### Required Fix

Add a shared helper:

```ts
canCreatePaymentForIntent(intent, now)
```

Allowed statuses:

- `requires_payment`
- `partially_paid`

Reject terminal statuses with:

```ts
{ statusCode: 422, code: 'INTENT_NOT_PAYABLE' }
```

Reject expired intent with:

```ts
{ statusCode: 422, code: 'INTENT_EXPIRED' }
```

### Acceptance Criteria

- Cannot create gateway payment for paid/cancelled/failed/expired/refunded/voided intent.
- Cannot create gateway payment after `expiresAt`.
- Tests cover all relevant status families.

---

## P0.5 — Fix `CreatePaymentIntent` Idempotency Hash and Conflict Semantics

### Problem

`CreatePaymentIntent` currently reserves idempotency with:

```ts
requestHash: input.idempotencyKey
```

That is wrong. The request hash must be a canonical hash of the request parameters, not the key itself.

It also does not fully handle:

- same key + different request body => conflict
- same key still processing => in-progress
- failed key policy
- DB unique conflicts during concurrent reserve

### Required Fix

Implement the same quality level as `CreateGatewayPayment`, but make it atomic and race-safe.

Canonical hash must include at least:

- `merchantId`
- `providerAccountId ?? null`
- `sourceApp ?? null`
- `externalTenantId ?? null`
- `externalOutletId ?? null`
- `externalLocationId ?? null`
- `externalPayableType`
- `externalPayableId`
- `currency ?? 'IDR'`
- `amountDue`
- `allowPartial ?? false`
- `expiresAt ?? null`
- normalized metadata if metadata impacts resource identity

Use stable key order before hashing.

### Error Codes

- Same key + same hash + completed => return replayed intent, `created=false`.
- Same key + different hash => `409 IDEMPOTENCY_CONFLICT`.
- Same key + processing => `409 IDEMPOTENCY_IN_PROGRESS`.
- Same key + failed => either reject with `409 IDEMPOTENCY_PREVIOUSLY_FAILED` or explicitly document and test retry policy.

### Acceptance Criteria

- Same idempotency key and same request returns existing intent.
- Same key and different body returns conflict.
- Concurrent create intent with same key returns one success and one stable replay/in-progress response, not raw DB error.

---

## P0.6 — Make Idempotency Reservation Race-Safe for All Scopes

### Problem

Current idempotency flow does `find()` then `reserve()`. Two concurrent requests can both see no existing key, then one insert fails with a raw unique violation.

This applies to:

- `create_payment_intent`
- `create_gateway_payment`
- refund idempotency using transaction unique idempotency key
- void idempotency using transaction idempotency key

### Required Fix

Implement atomic reservation primitives.

For `payment_orchestration_idempotency_keys`:

- Add repository method like:

```ts
reserveOrGet(input): Promise<{ key: PaymentIdempotencyKeyDTO; reserved: boolean }>
```

Use `INSERT ... ON CONFLICT DO NOTHING RETURNING *`, then reload existing row if not reserved.

For transaction-level idempotency key:

- Avoid raw unique violation from `(merchant_id, idempotency_key)`.
- Either migrate refund/void to use the idempotency table, or handle transaction unique conflict cleanly by reloading the existing transaction and checking semantic equality.

### Acceptance Criteria

- No raw PostgreSQL unique violation leaks to clients for idempotency races.
- All idempotency conflicts return stable API error envelopes.
- Tests simulate concurrent requests.

---

## P0.7 — Fix Refund Intent Status and Refund State Machine

### Problem

`RefundPaymentTransaction` updates `intent.amountRefunded`, but it does not update `intent.status`.

If an intent is paid and then fully refunded, it can remain `paid`, which is wrong for business reporting.

### Required Fix

Implement refund status derivation.

Suggested rules:

- If `amountRefunded <= 0`: keep payment-derived status.
- If `amountRefunded > 0 && amountRefunded < amountPaid`: status may remain `paid` or use a new explicit `partially_refunded` status if you add it consistently.
- If `amountRefunded >= amountPaid && amountPaid > 0`: status = `refunded`.

Because `StandaloneIntentStatus` currently includes `refunded` but not `partially_refunded`, avoid introducing a breaking new status unless you also update all unions, tests, docs, SDK, OpenAPI, and migrations.

Minimum required behavior:

- Full refund sets `intent.status = 'refunded'`.
- Partial refund keeps status stable and updates `amountRefunded`.

### Required Atomicity

The refund transaction and intent refund totals/status update must be in the same DB transaction.

### Acceptance Criteria

- Full refund changes intent status to `refunded`.
- Partial refund updates `amountRefunded` and does not over-refund.
- Double refund race cannot exceed refundable amount.
- Tests cover full refund, partial refund, over-refund, idempotent replay, and concurrent refund race.

---

## P0.8 — Make Webhook Event Reservation and Processing Race-Safe

### Problem

Webhook duplicate detection uses provider event lookup then insert. Duplicate concurrent webhooks can race and cause raw DB unique errors on `(provider, providerEventId)`.

Webhook processing should also prevent two workers/requests from processing the same pending/failed event at the same time.

### Required Fix

Implement provider event reservation and claim-lock semantics.

Required repository behavior:

- `reserveEventOrGet()` using `INSERT ... ON CONFLICT DO NOTHING` + reload.
- If existing event is `processed`, return idempotent success without mutation.
- If existing event is `pending` or `failed`, claim it before processing.

Add one of these mechanisms:

1. `processingStatus = 'processing'` state, or
2. row-level lock with `FOR UPDATE SKIP LOCKED`, or
3. optimistic `UPDATE ... WHERE processing_status IN ('pending','failed') RETURNING *`.

### Acceptance Criteria

- Duplicate webhook event cannot double-apply a payment.
- Duplicate concurrent webhook does not leak raw DB error.
- Reprocess worker cannot process the same event concurrently with webhook handler.

---

# P1 Hardening — Must Implement After P0

## P1.1 — Consistent API Error Envelope

### Problem

API contract uses:

```json
{
  "ok": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable message",
    "details": null
  }
}
```

Some middleware/routes still return the old flat envelope:

```json
{
  "ok": false,
  "error": "UNAUTHORIZED",
  "message": "..."
}
```

### Required Fix

- Update `middleware/auth.ts` to return the frozen nested error envelope.
- Update `routes/devFakeGateway.ts` to use `apiErrorResponse()`.
- Audit all routes/middleware for flat errors.
- Keep SDK backward compatibility parser, but service must emit the frozen envelope.

### Acceptance Criteria

- Every non-2xx service response uses nested error envelope.
- Add tests for auth error, validation error, not found, business error, and internal error shape.

---

## P1.2 — Timing-Safe Service Token Authentication

### Problem

Service token comparison uses direct string comparison.

### Required Fix

Use `crypto.timingSafeEqual`.

Implementation notes:

- Reject missing token.
- Reject array header values.
- Convert both values to buffers.
- Check length before timing-safe comparison.
- Keep legacy header `x-payment-engine-service-token` compatibility.

### Acceptance Criteria

- Existing valid token works.
- Missing/wrong token returns `401 UNAUTHORIZED` with nested error envelope.
- Array header is rejected.

---

## P1.3 — Rate Limit and Size Limit Webhooks

### Problem

`POST /v1/webhooks/:provider` is intentionally public but has no rate limit or strict body size limit.

### Required Fix

Add middleware for webhook route:

- JSON body size limit appropriate for provider payloads, e.g. `256kb` or lower if safe.
- Rate limiting for webhooks by IP and provider path.
- Keep health/version unaffected.
- If adding dependency is acceptable, use a standard package. If not, implement a minimal in-memory limiter suitable for single-instance deployment and document limitations.

### Acceptance Criteria

- Excess webhook requests get `429 RATE_LIMITED` with nested error envelope.
- Large webhook body gets stable 413/400 response.
- Tests cover rate-limit behavior where practical.

---

## P1.4 — Strict Xendit Callback Token Policy

### Problem

Xendit webhook uses callback token, but policy must be strict enough for production-like behavior.

### Required Fix

- If provider is `xendit_sandbox`, expected callback token must be configured unless `NODE_ENV !== 'production'` and an explicit dev override is enabled.
- Do not accept arbitrary callback token when env expected token is missing.
- Compare tokens using timing-safe comparison.
- Return stable errors:
  - `WEBHOOK_SIGNATURE_MISSING`
  - `WEBHOOK_SIGNATURE_INVALID`
  - `WEBHOOK_SECRET_REQUIRED`

### Acceptance Criteria

- Missing expected token rejects Xendit webhook unless explicit dev override is set.
- Wrong token rejects.
- Correct token accepts.

---

## P1.5 — Redact Sensitive Webhook Headers and Provider Payloads

### Problem

Webhook `rawHeaders` can store sensitive headers like callback tokens, signatures, authorization headers, cookies, or API keys.

### Required Fix

Before storing webhook headers or raw provider payloads, redact sensitive keys.

Redact keys matching:

- `authorization`
- `cookie`
- `set-cookie`
- `token`
- `secret`
- `signature`
- `api-key`
- `apikey`
- `x-callback-token`
- `x-fakegateway-signature`

Use `[redacted]` as the stored value.

### Acceptance Criteria

- Stored `provider_events.raw_headers` does not include plaintext tokens/signatures.
- Tests assert redaction.

---

## P1.6 — Validate `credentialsRef`

### Problem

Provider account creation accepts any `credentialsRef` string. Documentation says this field must be an env var name or safe secret reference, not a raw secret.

### Required Fix

Add validation in provider account creation.

Allowed examples:

```text
PAYMENT_ORCHESTRATION_XENDIT_SANDBOX_SECRET_KEY
XENDIT_SANDBOX_SECRET_KEY
```

Reject obvious raw secrets or unsafe values:

- strings containing `sk_`, `xnd_`, `secret_` as raw values
- strings containing colon/slash URLs unless the resolver explicitly supports them
- strings longer than a reasonable max
- lowercase free-form values if not supported

A safe default regex:

```ts
/^[A-Z][A-Z0-9_]{2,}$/
```

If you need to support `replit://secrets/...`, implement a resolver that actually understands it. Otherwise do not accept it.

### Acceptance Criteria

- Raw credential-like strings are rejected.
- Valid env var names are accepted.
- `credentialsRef` is never returned in API responses.

---

## P1.7 — Request ID and Structured Logging

### Problem

No request/correlation ID exists for tracing webhook/payment flows.

### Required Fix

Add middleware:

- Read incoming `x-request-id` if present and safe.
- Otherwise generate UUID.
- Set response header `x-request-id`.
- Attach to request object.
- Log structured JSON for request start/end/error.

Prefer `pino` if adding dependency is acceptable. Otherwise implement minimal structured console logging.

### Acceptance Criteria

- Every request response includes `x-request-id`.
- Error logs include requestId.
- Webhook processing logs include provider, providerEventId if available, and requestId.

---

# P2 Maintainability and Operations

## P2.1 — Shared Payment State Machine Helpers

### Problem

Payment success application is duplicated across:

- `ConfirmFakeGatewayPayment`
- `HandleProviderWebhook`
- `RefreshProviderStatus`
- `ReprocessProviderEvents`
- immediate success path in `CreateGatewayPayment`

### Required Fix

Create shared helpers, for example:

```text
apps/service/src/application/payment-state/
  intentStatus.ts
  transactionStateMachine.ts
  refundStateMachine.ts
```

The helper should centralize:

- `computeIntentStatus`
- `computeIntentStatusAfterRefund`
- `assertIntentPayable`
- `assertPaymentAmountAllowed`
- `applySucceededPaymentTransaction`
- `applyRefundTransaction`
- `assertTransactionRefundable`
- `assertTransactionVoidable`

### Acceptance Criteria

- No duplicate money mutation logic across use cases.
- Tests target helper functions directly.

---

## P2.2 — Input Validation With Zod or Central Schemas

### Problem

Routes use manual `typeof` checks everywhere.

### Required Fix

Add schema-based request validation.

Recommended:

- Add `zod` dependency if acceptable.
- Create route schemas under:

```text
apps/service/src/routes/schemas/
```

- Use `safeParse()` in route handlers.
- Convert validation errors to nested `VALIDATION_ERROR` with `details` containing field-level errors.

If you avoid new dependency, build a small reusable validation layer, but Zod is preferred.

### Acceptance Criteria

- All public POST routes use central validation.
- Validation error format is consistent.
- Tests cover invalid request payloads.

---

## P2.3 — DB Status Constraints / Enums

### Problem

Status columns are stored as plain `text`, so invalid strings can be inserted if code has a bug.

### Required Fix

Use one of:

1. Drizzle `pgEnum`, or
2. SQL `CHECK` constraints in migrations.

Apply to:

- merchant status
- provider account status
- intent status
- transaction status
- provider event processing status
- idempotency status
- provider account environment if applicable
- transaction direction if applicable
- transaction type if applicable

### Migration Requirements

- Existing data must migrate safely.
- Add migration SQL through Drizzle migration workflow.
- Do not break current tests.

### Acceptance Criteria

- DB rejects invalid status values.
- Types remain aligned with `packages/core` unions.

---

## P2.4 — Cleanup Expired Idempotency Keys

### Problem

`payment_orchestration_idempotency_keys` has `expires_at`, but no cleanup operation.

### Required Fix

Add repository method:

```ts
deleteExpired(now: Date, limit?: number): Promise<number>
```

Add worker operation:

```text
cleanup-expired-idempotency-keys
```

Include it in `all-safe`.

### Acceptance Criteria

- Expired keys are deleted safely.
- Non-expired keys remain.
- Worker output includes cleanup count.

---

## P2.5 — List and Read Endpoints for Operations

### Problem

There are no listing/read endpoints for operational dashboard and debugging.

### Required Fix

Add endpoints:

```http
GET /v1/payment-intents?merchantId=&status=&provider=&from=&to=&limit=&cursor=
GET /v1/payment-intents/:id/transactions?merchantId=
GET /v1/payment-transactions/:id?merchantId=
```

Requirements:

- Require service token.
- Require merchant scope via query or `x-payment-merchant-id`.
- Support pagination.
- Never expose provider credentials.
- Add SDK methods.

### Acceptance Criteria

- Client SDK has typed methods.
- Tests cover successful list/read and merchant isolation.

---

## P2.6 — Deterministic Provider External IDs

### Problem

Provider external IDs should be deterministic enough to avoid duplicate provider resources on retries.

### Required Fix

For Xendit sandbox:

- Avoid using only `Date.now()` for `external_id`.
- Prefer an ID derived from persisted transaction id or idempotency key.
- If transaction id currently only exists after provider call, refactor to allocate transaction id before provider call.

Suggested format:

```text
po_<intentId>_<transactionId>
```

or a safe shortened hash.

### Acceptance Criteria

- Provider external ID is stable for idempotent replay.
- Retried provider call with same idempotency key does not create unrelated external IDs.

---

## P2.7 — Observability, Metrics, and Audit Log

### Required Improvements

Add minimal observability foundations:

- Structured request logs.
- Payment mutation audit log table or append-only event log.
- Metrics endpoint if feasible:
  - `payment_intents_created_total`
  - `payment_transactions_created_total`
  - `webhook_events_processed_total`
  - `webhook_events_failed_total`
  - provider latency histogram if provider calls are instrumented

If full metrics/audit log is too large for this pass, create a clear follow-up document and implement request logging + audit table first.

---

# Test Requirements

Add or update tests for these cases:

## Payment Intent and Gateway Payment

- create payment intent idempotent replay same hash.
- create payment intent same key different request => `IDEMPOTENCY_CONFLICT`.
- create gateway payment with `allowPartial=false` and amount less than remaining => `PARTIAL_PAYMENT_NOT_ALLOWED`.
- create gateway payment with `allowPartial=true` and amount less than remaining => success.
- create gateway payment for terminal intent => `INTENT_NOT_PAYABLE`.
- create gateway payment for expired intent => `INTENT_EXPIRED`.
- idempotency race does not leak raw DB error.

## Confirmation / Webhook / Refresh

- two concurrent confirmations on same transaction credit intent once.
- two different concurrent transactions cannot overpay the same intent.
- webhook duplicate event is idempotent and race-safe.
- provider event failed/pending reprocess cannot double-credit.
- refresh provider status uses same state mutation helper.

## Refund / Void

- full refund sets intent status to `refunded`.
- partial refund updates `amountRefunded` and keeps valid status.
- over-refund rejected.
- refund idempotent replay works.
- concurrent refunds cannot exceed refundable amount.
- void pending/requires_action transaction succeeds.
- void succeeded transaction rejected.
- void idempotent replay works.

## Security and Contract

- auth errors use nested error envelope.
- dev fake gateway validation errors use nested error envelope.
- timing-safe token path accepts valid token and rejects invalid token.
- webhook headers are redacted before storage.
- Xendit callback token missing/wrong/correct behavior.
- request ID is present in response.
- validation errors return field-level `details` if schema validation is implemented.

## Workers

- cleanup expired idempotency keys removes only expired rows.
- `all-safe` includes cleanup operation.
- stale event reprocessing validates statuses and skips invalid payload safely.

---

# Documentation Updates

Update documentation after implementation:

1. `docs/payment-orchestration-api-contract.md`
   - Add new error codes.
   - Add refund/void if missing or incomplete.
   - Add list/read endpoints.
   - Document idempotency behavior.
   - Document partial payment rules.
   - Document request ID.

2. `docs/openapi/payment-orchestration.openapi.json`
   - Keep API schema aligned with runtime.

3. `.env.example`
   - Add any new env variables:
     - webhook rate limit config if any
     - request logging config if any
     - Xendit webhook strict/dev override if any

4. README if startup/test instructions change.

---

# Implementation Guidance

## Suggested File Areas

You will likely touch:

```text
apps/service/src/app.ts
apps/service/src/container.ts
apps/service/src/config/env.ts
apps/service/src/middleware/auth.ts
apps/service/src/middleware/errors.ts
apps/service/src/routes/*.ts
apps/service/src/routes/utils.ts
apps/service/src/routes/schemas/*
apps/service/src/application/use-cases/*.ts
apps/service/src/application/payment-state/*
apps/service/src/infrastructure/db.ts
apps/service/src/infrastructure/schema.ts
apps/service/src/infrastructure/repositories/*.ts
apps/service/src/infrastructure/providers/*.ts
apps/service/src/workers/run.ts
packages/core/src/**/*.ts
packages/client-sdk/src/**/*.ts
docs/**/*.md
docs/openapi/payment-orchestration.openapi.json
tests/**/*.test.ts
```

## Error Codes to Add or Normalize

Use stable machine-readable codes:

```text
PARTIAL_PAYMENT_NOT_ALLOWED
INTENT_NOT_PAYABLE
INTENT_EXPIRED
OVERPAYMENT_REJECTED
TRANSACTION_NOT_REFUNDABLE
REFUND_EXCEEDS_REFUNDABLE
TRANSACTION_NOT_VOIDABLE
IDEMPOTENCY_CONFLICT
IDEMPOTENCY_IN_PROGRESS
IDEMPOTENCY_PREVIOUSLY_FAILED
WEBHOOK_SIGNATURE_MISSING
WEBHOOK_SIGNATURE_INVALID
WEBHOOK_SECRET_REQUIRED
RATE_LIMITED
VALIDATION_ERROR
UNAUTHORIZED
SERVICE_MISCONFIGURED
PROVIDER_ACCOUNT_REQUIRED
PROVIDER_ACCOUNT_PROVIDER_MISMATCH
PROVIDER_ACCOUNT_DISABLED
PROVIDER_REFUND_UNSUPPORTED
PROVIDER_CANCEL_UNSUPPORTED
PROVIDER_REFUND_FAILED
PROVIDER_CANCEL_FAILED
```

Do not rename existing documented codes unless you keep backward-compatible handling.

---

# Required Final Report

When finished, provide a final report with:

1. Summary of implemented fixes.
2. Files changed.
3. New migrations added.
4. New tests added.
5. Test commands run and results.
6. Any known limitations or follow-up tasks.
7. Confirmation that no legacy embedded payment runtime/session/order dependency was introduced.

---

# Completion Definition

This task is complete only when:

- All P0 fixes are implemented.
- All P1 hardening items are implemented or explicitly justified if deferred.
- P2 items are implemented where reasonable, or documented as follow-up if they are too large.
- Type-check passes.
- Tests pass.
- API docs are updated.
- No raw secret exposure is introduced.
- Payment totals remain consistent under concurrency.
- Refund/void flows behave correctly.
- Partial payment policy is enforced.
