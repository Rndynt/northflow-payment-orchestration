# Claude Prompt — S10.3 Merchant Outbound Webhook / Callback

You are working in `northflow-payment-orchestration`.

This phase implements merchant-facing outbound webhooks so merchant backends do not need to rely only on polling Northflow for payment state changes.

Northflow receives provider webhooks internally, updates payment intent / transaction state, then sends signed outbound events to the merchant backend.

## Hard Rules

- Do not add dashboard UI.
- Do not add a new provider integration.
- Do not change provider codes: `manual`, `fake_gateway`, `xendit_sandbox`.
- Do not change HMAC canonical request format for inbound SDK/API request signing.
- Do not expose provider secrets, API keys, webhook secrets, signing secrets, or database URLs in logs, API responses, docs examples, or audit metadata.
- Do not send outbound webhook calls from frontend/browser code.
- Do not mention named external consumer projects. Use generic names only: merchant backend, consumer backend, SDK consumer, REST consumer, checkout backend, merchant, API client, provider account, payment method.

Database migrations are allowed only for outbound webhook endpoint / event / delivery persistence.

---

## Goal

Build a reliable outbound webhook subsystem for merchant callbacks.

A merchant should be able to configure a callback endpoint, receive signed payment lifecycle events, verify signatures, return 2xx, and rely on retry / delivery logs for failures.

The subsystem must support:

- endpoint registration per merchant
- endpoint secret generation / rotation-safe storage
- event creation from payment state transitions
- durable delivery records
- signed HTTP POST delivery
- retry with backoff
- dead-letter state after max attempts
- manual replay / retry endpoint or admin CLI command
- clear docs and tests

---

## Conceptual distinction

Provider webhook:

```txt
provider -> Northflow
```

Merchant outbound webhook:

```txt
Northflow -> merchant backend
```

Do not mix the two. Provider webhook verification and merchant outbound webhook signing are separate concerns.

---

## Event types

Implement a conservative event set based on current domain statuses and operations. Use only events that can be generated from existing payment intent / transaction / refund / void state transitions.

Required event types:

```txt
payment_intent.requires_payment
payment_intent.partially_paid
payment_intent.paid
payment_intent.failed
payment_intent.expired
payment_intent.cancelled
payment_intent.refunded
payment_intent.voided
payment_transaction.requires_action
payment_transaction.succeeded
payment_transaction.failed
payment_transaction.cancelled
payment_transaction.refunded
payment_transaction.voided
```

If a status does not exist in current domain model, do not invent it. Adjust the event list to actual current domain values and document the final mapping.

Event naming must be stable and documented.

---

## Database model

Add migrations and repository ports/adapters as needed.

Recommended tables:

### `merchant_webhook_endpoints`

Fields:

```txt
id
merchant_id
url
status: active | disabled
subscribed_events: string[] or jsonb
secret_hash or encrypted_secret_ref
secret_prefix
metadata jsonb
created_at
updated_at
disabled_at
```

Secret rules:

- Raw signing secret is returned only once on endpoint creation or rotation.
- Do not store raw secret in plaintext.
- Store a hash or encrypted representation using existing secret-handling patterns if available.
- API responses must show only prefix / metadata, never raw secret except one-time create/rotate response.

### `merchant_webhook_events`

Fields:

```txt
id
merchant_id
event_type
resource_type
resource_id
payload jsonb
idempotency_key or dedupe_key
created_at
```

Must be unique enough to avoid duplicate event creation for the same resource transition.

### `merchant_webhook_deliveries`

Fields:

```txt
id
event_id
endpoint_id
merchant_id
status: queued | delivering | succeeded | failed | dead
attempt_count
max_attempts
next_attempt_at
last_attempt_at
last_response_status
last_response_body_truncated
last_error
created_at
updated_at
delivered_at
```

Do not store full sensitive response bodies. Truncate response body safely.

If existing table naming conventions differ, follow the repo convention and document deviations.

---

## Payload contract

Every outbound webhook POST body must use a stable envelope:

```json
{
  "id": "evt_xxx",
  "type": "payment_intent.paid",
  "createdAt": "2026-06-08T00:00:00.000Z",
  "merchantId": "mer_xxx",
  "resource": {
    "type": "payment_intent",
    "id": "pi_xxx"
  },
  "data": {
    "intent": {},
    "transaction": null
  }
}
```

Rules:

- Include event id.
- Include event type.
- Include createdAt.
- Include merchantId.
- Include resource type/id.
- Include current serialized intent/transaction as appropriate.
- Do not include API key, provider credential, webhook secret, signing secret, database URL, or internal-only config.
- Payload must be deterministic enough for tests.

---

## HTTP delivery contract

Outbound delivery method:

```txt
POST <merchant_webhook_endpoint.url>
Content-Type: application/json
User-Agent: Northflow-Webhook/1.0
```

Required headers:

```txt
x-nf-webhook-id: <event id>
x-nf-webhook-delivery-id: <delivery id>
x-nf-webhook-type: <event type>
x-nf-webhook-timestamp: <unix ms or ISO timestamp>
x-nf-webhook-signature: <hmac signature>
x-nf-webhook-signature-version: v1
```

Signature:

- Use HMAC-SHA256 over a canonical string.
- Keep this separate from existing inbound request signing helpers unless a shared generic helper is safe and does not alter inbound behavior.
- Document exact signing string.
- Use timing-safe comparison in verification examples.

Recommended signing string:

```txt
<timestamp>.<eventId>.<deliveryId>.<rawJsonBody>
```

Do not change existing S9.4 canonical request signing format.

Timeout:

```txt
default 10 seconds
configurable by env
```

Success:

```txt
any HTTP 2xx
```

Failure:

```txt
network error, timeout, non-2xx response, invalid URL, disabled endpoint
```

---

## Retry policy

Implement durable retry policy:

```txt
attempt 1: immediate or next worker tick
attempt 2: +1 minute
attempt 3: +5 minutes
attempt 4: +15 minutes
attempt 5: +1 hour
then dead
```

If the repo already has scheduler/worker patterns, integrate with them. If not, implement a simple worker/use-case that can be invoked manually and later scheduled.

Required behavior:

- Claim due queued/failed deliveries safely.
- Increment attempt count.
- Store response status / truncated body / error.
- Mark succeeded on 2xx.
- Mark failed with nextAttemptAt if attempts remain.
- Mark dead when max attempts exceeded.
- Idempotent worker execution.

---

## API / admin surface

Implement service endpoints or admin CLI commands according to existing project style.

Required operations:

1. Create endpoint for merchant.
2. List endpoints for merchant.
3. Disable endpoint.
4. Rotate endpoint secret, returning raw secret once.
5. List deliveries for merchant / endpoint.
6. Replay one delivery or event.

If admin CLI is more consistent with S10, implement CLI commands and document why HTTP admin routes were not added. If HTTP routes are added, they must use existing auth/merchant grant protections.

Do not expose a dashboard.

---

## Event creation integration points

Add event creation where payment state changes already happen.

Likely integration points:

- provider webhook processing
- fake gateway confirmation
- manual provider confirmation/cancel/refund flows
- refresh provider status
- refund transaction
- void transaction
- expire stale payment transactions
- reconcile if it changes aggregate intent status

Rules:

- Do not duplicate events for the same state transition.
- Do not emit events when no meaningful status changed.
- Event creation must not break the primary payment operation if delivery creation fails unless the failure means database transaction rollback is required for consistency. Document the chosen behavior.
- Prefer outbox-style persistence: create event/delivery rows in DB first, deliver later.

---

## SDK / REST docs

Update or create docs:

```txt
docs/integration/merchant-outbound-webhooks.md
docs/integration/webhook-signature-verification.md
docs/integration/status-polling.md
```

Docs must explain:

- polling remains supported
- outbound webhook is now available for event-driven integration
- endpoint setup flow
- event payload format
- header/signature verification
- retry policy
- idempotent event handling on merchant backend
- safe secret storage
- local testing with fake_gateway/manual provider

Add TypeScript verification example for merchant backend.

Do not put secrets in frontend/public env.

---

## Tests

Add robust tests. Use existing in-memory test patterns where possible.

Required coverage:

- endpoint create returns raw secret once only
- endpoint list never returns raw secret
- disabled endpoint does not receive new deliveries
- event payload envelope shape is stable
- signature generation deterministic and verifiable
- delivery worker marks 2xx as succeeded
- delivery worker retries non-2xx with nextAttemptAt
- delivery worker marks dead after max attempts
- delivery response body is truncated
- duplicate state transition does not create duplicate event
- payment_intent.paid event is created when fake_gateway confirmation marks intent paid
- refund/void events created when operations succeed
- docs do not instruct frontend/public env secret usage
- provider codes unchanged
- existing full test suite still passes

No real external HTTP calls in tests. Mock fetch / HTTP client.

---

## Environment variables

Add only if needed and document defaults:

```txt
PAYMENT_ORCHESTRATION_OUTBOUND_WEBHOOKS_ENABLED=true|false
PAYMENT_ORCHESTRATION_OUTBOUND_WEBHOOK_TIMEOUT_MS=10000
PAYMENT_ORCHESTRATION_OUTBOUND_WEBHOOK_MAX_ATTEMPTS=5
PAYMENT_ORCHESTRATION_OUTBOUND_WEBHOOK_RESPONSE_BODY_LIMIT=2048
```

Default should be safe. If disabled by default, document how to enable. If enabled by default, ensure no delivery occurs without registered active endpoints.

---

## Validation report

Create:

```txt
.agents/memory/s10-3-merchant-outbound-webhook-callback-validation.md
```

Include:

- timestamp
- git commit checked
- files changed
- migrations added
- event types implemented
- API/CLI commands added
- security decisions
- retry policy
- signature format
- commands run
- type-check results
- test results
- known failures
- provider codes unchanged confirmation
- no dashboard confirmation
- no HMAC inbound signing change confirmation
- remaining issues

Do not claim command success unless actually run.

---

## Required validation commands

Run and document:

```bash
pnpm --filter @northflow/payment-orchestration-core type-check
pnpm --filter @northflow/payment-orchestration-client-sdk type-check
pnpm --filter @northflow/payment-orchestration-service type-check
pnpm test
```

Also run relevant migration/codegen commands if required by the repo.

---

## Acceptance criteria

S10.3 is complete only when:

- merchant webhook endpoint config exists
- endpoint secret is one-time raw output only
- outbound event payload contract is stable
- signed POST delivery exists
- retry/dead-letter delivery tracking exists
- replay/manual retry exists
- provider webhook remains separate from merchant outbound webhook
- payment/refund/void/status-change events are emitted without duplicates
- docs explain setup, verification, retry, and merchant idempotency
- tests cover success, retry, dead, signature, and event creation
- no dashboard was introduced
- provider codes remain unchanged
- inbound HMAC canonical request format is unchanged
- core/client-sdk/service type-check pass
- full tests pass or failures are honestly documented
- validation report exists

Commit and push all changes.
