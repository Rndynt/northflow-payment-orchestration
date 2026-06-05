# Payment Orchestration Service — API Contract

**Phase:** 8K — SDK/API Contract Freeze  
**Status:** FROZEN  
**Last updated:** 2026-06-05  
**OpenAPI spec:** `docs/openapi/payment-orchestration.openapi.json`

---

## Base URL

```
http://localhost:5100          (development)
https://<host>:5100            (production)
```

---

## Authentication

All `/v1/...` routes except `/v1/webhooks/:provider` require:

```
x-payment-orchestration-service-token: <token>
```

Set `PAYMENT_ORCHESTRATION_SERVICE_TOKEN` env var. Falls back to `PAYMENT_ENGINE_SERVICE_TOKEN` for monorepo backward compat.

### Merchant ID injection

Routes that require a `merchantId` accept it via:
1. Request body field `merchantId` (POST routes)
2. Query param `?merchantId=` (GET routes)
3. Header fallback: `x-payment-merchant-id`

The SDK client injects `merchantId` automatically from `config.merchantId` when not explicitly provided.

---

## Response Envelope

### Success

```json
{
  "ok": true,
  "data": { ... }
}
```

### Error (Phase 8K frozen)

```json
{
  "ok": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable description.",
    "details": null
  }
}
```

- `code` — machine-readable, stable. Switch on this, not `message`.
- `message` — human-readable, may change between releases.
- `details` — structured details (e.g. validation field errors) or `null`.

---

## Endpoints

### Health & Readiness (no auth)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Liveness check. Returns `{ ok: true }`. |
| `GET` | `/version` | Service version metadata (version, phase, description). |
| `GET` | `/ready` | Runtime readiness (DB, providers, Xendit config). No secrets exposed. |

---

### Merchants

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/v1/merchants` | ✅ | Create or return merchant (idempotent by sourceApp + externalRef). Returns 201 on create, 200 on existing. |
| `GET` | `/v1/merchants/:id` | ✅ | Get merchant by ID. Returns 404 if not found. |

#### POST /v1/merchants — required fields

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `name` | string | Yes | Display name |
| `legalName` | string\|null | No | |
| `sourceApp` | string\|null | No | |
| `externalRef` | string\|null | No | Used for idempotency with `sourceApp` |
| `metadata` | object | No | |

---

### Provider Accounts

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/v1/merchants/:merchantId/provider-accounts` | ✅ | Create provider account. `credentialsRef` accepted but never returned. |
| `GET` | `/v1/merchants/:merchantId/provider-accounts/:id` | ✅ | Get provider account. Returns 404 if not found. |

**Security:** `credentialsRef` must be an env var name (not the raw secret). The service reads `process.env[credentialsRef]` at runtime. **Never** returned in any response.

---

### Payment Intents

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/v1/payment-intents` | ✅ | Create payment intent. Returns 201 on create, 200 on idempotency hit. |
| `GET` | `/v1/payment-intents/:id/status` | ✅ | Get intent status + latest transaction + computed flags. |
| `GET` | `/v1/payment-intents/:id/refundability` | ✅ | Get per-transaction refundability breakdown. |
| `POST` | `/v1/payment-intents/:id/gateway-payments` | ✅ | Initiate gateway payment. Returns 201 on create, 200 on idempotency replay. |
| `POST` | `/v1/payment-intents/:id/reconcile` | ✅ | Crash-recovery: recompute intent totals from transactions. |

#### POST /v1/payment-intents — required fields

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `merchantId` | string | Yes* | *Falls back to `x-payment-merchant-id` header |
| `externalPayableType` | string | Yes | E.g. `"order"` |
| `externalPayableId` | string | Yes | |
| `amountDue` | integer | Yes | Positive integer in smallest currency unit |
| `currency` | string | No | Default `"IDR"` |
| `allowPartial` | boolean | No | Default `false` |
| `idempotencyKey` | string\|null | No | |

#### POST .../gateway-payments — required fields

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `merchantId` | string | Yes* | Falls back to `x-payment-merchant-id` header |
| `provider` | string | Yes | E.g. `"fake_gateway"` |
| `method` | string | Yes | E.g. `"qris"` |
| `amount` | integer | Yes | Positive integer |
| `idempotencyKey` | string\|null | No | Idempotency for the gateway call |

---

### Payment Transactions

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/v1/payment-transactions/:id/refresh-provider-status` | ✅ | Poll provider for current TX status, update DB if changed. |

---

### Webhooks

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/v1/webhooks/:provider` | ❌ No service token | Ingest provider webhook. Identity verified via HMAC signature. |

**Webhook auth:**
- Route bypasses service-token auth intentionally.
- Provider identity verified via HMAC signature (`x-fakegateway-signature` for `fake_gateway`).
- Missing signature (when secret configured) → `WEBHOOK_SIGNATURE_MISSING` 401.
- Wrong signature → `WEBHOOK_SIGNATURE_INVALID` 401.
- No secret in production → `WEBHOOK_SECRET_REQUIRED` 403.
- Merchant resolved from `providerReference → TX → intent → merchantId` (header spoofing prevention).

#### Webhook response (200 / 422)

```json
{
  "ok": true,
  "eventId": "evt_abc123",
  "provider": "fake_gateway",
  "providerReference": "pay_xyz",
  "processingStatus": "processed",
  "idempotentReplay": false,
  "transaction": { "id": "...", "status": "succeeded", "amount": 100000 },
  "intent": { "id": "...", "status": "paid", "amountPaid": 100000, "amountRemaining": 0 }
}
```

---

### Dev (non-production only)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/v1/dev/fake-gateway/transactions/:id/confirm` | ✅ | Simulate payment confirmation. `NODE_ENV=production` → 403. |

---

## Status Code Semantics

| Status | Meaning |
|--------|---------|
| 200 | Success (GET, or POST idempotency replay) |
| 201 | Resource created (POST) |
| 400 | Validation error (`VALIDATION_ERROR`) |
| 401 | Auth failure (missing/invalid service token or webhook signature) |
| 403 | Forbidden (production-only endpoint guard, missing webhook secret in production) |
| 404 | Resource not found |
| 409 | Conflict (idempotency key conflict) |
| 422 | Business logic error (overpayment, disabled provider account, etc.) |
| 500 | Internal server error |
| 503 | Provider not available |

---

## Idempotency

`createGatewayPayment` supports explicit idempotency via the `idempotencyKey` body field:

| Scenario | Behaviour |
|----------|-----------|
| Same key + same params | 200 + `idempotentReplay: true` (no provider call) |
| Same key + different params | 409 `IDEMPOTENCY_CONFLICT` |
| Previously failed + same key | 409 `IDEMPOTENCY_PREVIOUSLY_FAILED` (use a new key to retry) |
| In-progress same key | 409 `IDEMPOTENCY_IN_PROGRESS` |

---

## credentialsRef Security Note

`payment_orchestration_provider_accounts.credentials_ref` must always store the **env var name**, not the raw API key:

```text
credentialsRef = "PAYMENT_ORCHESTRATION_XENDIT_SANDBOX_SECRET_KEY"
```

At runtime: `process.env["PAYMENT_ORCHESTRATION_XENDIT_SANDBOX_SECRET_KEY"]` → secret key value.

This field is **never** returned in any response from the API.

---

## Backward Compatibility

Phase 8K freezes this contract. From Phase 8K+:
- No error codes will be removed or renamed.
- No response fields will be removed.
- New optional fields may be added to responses (additive changes only).
- Breaking changes will require a new major version (v1.x → v2.x API prefix).
