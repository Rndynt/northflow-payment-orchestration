# Payment Orchestration Service — Smoke Test Guide

**Phase:** 8K — SDK/API Contract Freeze  
**Last updated:** 2026-06-05

This guide describes how to manually or programmatically verify the payment-orchestration-service standalone API.

---

## Prerequisites

1. Service running on port 5100 (or override with `PAYMENT_ORCHESTRATION_SERVICE_PORT`).
2. `PAYMENT_ORCHESTRATION_SERVICE_TOKEN` set (any value in non-production).
3. PostgreSQL accessible at `PAYMENT_ORCHESTRATION_DATABASE_URL` or `DATABASE_URL`.

**Quick start (development):**
```bash
NODE_ENV=development PAYMENT_ORCHESTRATION_SERVICE_TOKEN=dev-token npx tsx \
  --tsconfig apps/payment-orchestration-service/tsconfig.json \
  apps/payment-orchestration-service/src/index.ts
```

---

## Step-by-step smoke test

All requests below assume:
```bash
BASE=http://localhost:5100
TOKEN=dev-token
```

---

### 1. Health check

```bash
curl -s $BASE/health | jq
# Expected: { "ok": true, "service": "payment-orchestration-service" }
```

### 1a. Version check (Phase 8K)

```bash
curl -s $BASE/version | jq
# Expected: { "service": "...", "version": "0.3.0", "phase": "8K", ... }
```

### 1b. Readiness check

```bash
curl -s $BASE/ready | jq
# Expected:
# {
#   "ok": true,
#   "service": "payment-orchestration-service",
#   "providers": { "fake_gateway": { "registered": true } },
#   "database": "configured"
# }
```

---

### 2. Create merchant

```bash
MERCHANT=$(curl -s -X POST $BASE/v1/merchants \
  -H "x-payment-orchestration-service-token: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Warung Test","sourceApp":"smoke","externalRef":"smoke-001"}' | jq -r '.data.id')
echo "Merchant: $MERCHANT"
```

---

### 3. Create provider account

```bash
PA=$(curl -s -X POST $BASE/v1/merchants/$MERCHANT/provider-accounts \
  -H "x-payment-orchestration-service-token: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"provider":"fake_gateway","environment":"test","providerAccountRef":"smoke-ref-001"}' | jq -r '.data.id')
echo "ProviderAccount: $PA"
# Verify: response includes providerAccountRef, NOT credentialsRef
```

---

### 4. Create payment intent

```bash
INTENT=$(curl -s -X POST $BASE/v1/payment-intents \
  -H "x-payment-orchestration-service-token: $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"merchantId\":\"$MERCHANT\",\"externalPayableType\":\"order\",\"externalPayableId\":\"order-smoke-001\",\"currency\":\"IDR\",\"amountDue\":100000}" | jq -r '.data.id')
echo "Intent: $INTENT"
```

Alternatively, use `x-payment-merchant-id` header instead of body field:

```bash
INTENT=$(curl -s -X POST $BASE/v1/payment-intents \
  -H "x-payment-orchestration-service-token: $TOKEN" \
  -H "x-payment-merchant-id: $MERCHANT" \
  -H "Content-Type: application/json" \
  -d '{"externalPayableType":"order","externalPayableId":"order-smoke-002","currency":"IDR","amountDue":50000}' | jq -r '.data.id')
```

---

### 5. Create gateway payment (QRIS — requires confirmation)

```bash
TX=$(curl -s -X POST $BASE/v1/payment-intents/$INTENT/gateway-payments \
  -H "x-payment-orchestration-service-token: $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"merchantId\":\"$MERCHANT\",\"provider\":\"fake_gateway\",\"method\":\"qris\",\"amount\":100000,\"metadata\":{\"scenario\":\"qris\"}}" | jq -r '.data.transaction.id')
echo "Transaction: $TX"
# Expected: transaction.status = requires_action, intent.status = requires_payment
```

**With idempotency key:**
```bash
curl -s -X POST $BASE/v1/payment-intents/$INTENT/gateway-payments \
  -H "x-payment-orchestration-service-token: $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"merchantId\":\"$MERCHANT\",\"provider\":\"fake_gateway\",\"method\":\"qris\",\"amount\":100000,\"idempotencyKey\":\"smoke-idem-001\",\"metadata\":{\"scenario\":\"qris\"}}"
# Second call with same key: returns HTTP 200 + idempotentReplay: true
```

---

### 6. Check status (with header fallback)

```bash
curl -s "$BASE/v1/payment-intents/$INTENT/status" \
  -H "x-payment-orchestration-service-token: $TOKEN" \
  -H "x-payment-merchant-id: $MERCHANT" | jq
# Expected: intent.status=requires_payment, requiresAction=true
```

---

### 7. Confirm FakeGateway payment (dev only)

```bash
curl -s -X POST "$BASE/v1/dev/fake-gateway/transactions/$TX/confirm" \
  -H "x-payment-orchestration-service-token: $TOKEN" \
  -H "x-payment-merchant-id: $MERCHANT" \
  -H "Content-Type: application/json" \
  -d '{}' | jq
# Expected: transaction.status=succeeded, intent.status=paid
# alreadyConfirmed=false on first call, true on second call (idempotent)
```

---

### 8. Check refundability

```bash
curl -s "$BASE/v1/payment-intents/$INTENT/refundability" \
  -H "x-payment-orchestration-service-token: $TOKEN" \
  -H "x-payment-merchant-id: $MERCHANT" | jq
# Expected: totalRefundable=100000, transactions=[{amountRefundable:100000,...}]
```

---

### 9. Webhook ingestion (Phase 8E — FakeGateway)

The webhook route does **not** require a service token — it is registered before the auth middleware. Provider identity is verified via HMAC signature.

**Dev/test mode (no secret configured):**
```bash
# Simulate FakeGateway pushing a payment.succeeded event
curl -s -X POST $BASE/v1/webhooks/fake_gateway \
  -H "Content-Type: application/json" \
  -d "{\"event_id\":\"evt_smoke_001\",\"event_type\":\"payment.succeeded\",\"status\":\"succeeded\",\"provider_reference\":\"<TX_PROVIDER_REF>\"}" | jq
# Expected: { "ok": true, "processingStatus": "processed", "intent": { "status": "paid", ... } }
```

**With HMAC secret configured** (`PAYMENT_ORCHESTRATION_FAKEGATEWAY_WEBHOOK_SECRET=mysecret`):
```bash
BODY='{"event_id":"evt_smoke_002","event_type":"payment.succeeded","status":"succeeded","provider_reference":"<TX_PROVIDER_REF>"}'
SIG="sha256=$(echo -n "$BODY" | openssl dgst -sha256 -hmac mysecret | awk '{print $2}')"
curl -s -X POST $BASE/v1/webhooks/fake_gateway \
  -H "Content-Type: application/json" \
  -H "x-fakegateway-signature: $SIG" \
  -d "$BODY" | jq
```

**Idempotent replay (duplicate event_id):**
```bash
# Send same event_id again — returns idempotentReplay: true, amountPaid unchanged
curl -s -X POST $BASE/v1/webhooks/fake_gateway \
  -H "Content-Type: application/json" \
  -d '{"event_id":"evt_smoke_001","event_type":"payment.succeeded","status":"succeeded","provider_reference":"<TX_PROVIDER_REF>"}' | jq
# Expected: idempotentReplay: true
```

**Security notes:**
- Webhook route bypasses service-token auth **intentionally** — payment providers push events without a service token.
- Merchant is resolved from `providerReference → TX → intent → merchantId`; the `x-payment-merchant-id` header is **ignored** on webhook routes to prevent header-spoofing attacks.
- Missing signature (when secret configured) → `WEBHOOK_SIGNATURE_MISSING` 401.
- Wrong signature → `WEBHOOK_SIGNATURE_INVALID` 401.
- No secret in production → `WEBHOOK_SECRET_REQUIRED` 403.
- Unsigned webhook in non-production (no secret) → accepted (dev convenience only).

**Phase 8K — Error envelope:**
All error responses now use nested shape:
```json
{ "ok": false, "error": { "code": "WEBHOOK_SIGNATURE_MISSING", "message": "...", "details": null } }
```

---

### 10. Reconciliation (Phase 8E — crash-recovery safety)

The reconcile endpoint recomputes intent totals from actual transaction state. Protected by service token.

```bash
# Fix drift after crash: TX succeeded but intent totals not updated
curl -s -X POST $BASE/v1/payment-intents/$INTENT/reconcile \
  -H "x-payment-orchestration-service-token: $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"merchantId\":\"$MERCHANT\"}" | jq
# Expected: { "ok": true, "data": { "changed": false/true, "before": {...}, "after": {...}, "intent": {...} } }
```

- `changed: false` — totals already correct; no DB update.
- `changed: true` — drift detected and corrected (e.g., TX was succeeded but intent still showed `requires_payment`).

---

### 11. Refresh provider status (Phase 8H)

```bash
TX_PROVIDER_REF=$(curl -s "$BASE/v1/payment-intents/$INTENT/status" \
  -H "x-payment-orchestration-service-token: $TOKEN" \
  -H "x-payment-merchant-id: $MERCHANT" | jq -r '.data.latestTransaction.id')

curl -s -X POST "$BASE/v1/payment-transactions/$TX_PROVIDER_REF/refresh-provider-status" \
  -H "x-payment-orchestration-service-token: $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"merchantId\":\"$MERCHANT\"}" | jq
# Expected: { "ok": true, "data": { "transaction": {...}, "intent": {...}, "providerStatus": "...", "changed": false } }
```

---

### 12. Error envelope verification (Phase 8K)

```bash
# Test validation error shape
curl -s -X POST $BASE/v1/merchants \
  -H "x-payment-orchestration-service-token: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}' | jq
# Expected: { "ok": false, "error": { "code": "VALIDATION_ERROR", "message": "name is required and must be a string", "details": null } }

# Test 404 shape
curl -s $BASE/v1/merchants/nonexistent-id \
  -H "x-payment-orchestration-service-token: $TOKEN" | jq
# Expected: { "ok": false, "error": { "code": "MERCHANT_NOT_FOUND", "message": "Merchant not found: nonexistent-id", "details": null } }

# Test unknown route 404
curl -s $BASE/v1/unknown-route \
  -H "x-payment-orchestration-service-token: $TOKEN" | jq
# Expected: { "ok": false, "error": { "code": "NOT_FOUND", "message": "Route not found. Check the payment-orchestration-service API documentation.", "details": null } }
```

---

## Automated test suites

Run without a running DB or service:

```bash
# Use-case level (in-memory repos, fast)
node_modules/.bin/tsx --tsconfig apps/api/tsconfig.node.json --test \
  apps/api/src/__tests__/payment-orchestration-service-fakegateway-flow.test.ts

# HTTP/auth level (real Express, in-memory repos, port 0)
node_modules/.bin/tsx --tsconfig apps/api/tsconfig.node.json --test \
  apps/api/src/__tests__/payment-orchestration-service-http-auth.test.ts

# Phase 8D.1 — atomic confirm (TOCTOU fix)
node_modules/.bin/tsx --tsconfig apps/api/tsconfig.node.json --test \
  apps/api/src/__tests__/payment-orchestration-atomic-confirm.test.ts

# Phase 8E — standalone webhook use case
node_modules/.bin/tsx --tsconfig apps/api/tsconfig.node.json --test \
  apps/api/src/__tests__/payment-orchestration-standalone-webhook.test.ts

# Phase 8E — webhook route auth bypass (Express HTTP layer)
node_modules/.bin/tsx --tsconfig apps/api/tsconfig.node.json --test \
  apps/api/src/__tests__/payment-orchestration-webhook-route-auth-bypass.test.ts

# Phase 8E — reconciliation use case
node_modules/.bin/tsx --tsconfig apps/api/tsconfig.node.json --test \
  apps/api/src/__tests__/payment-orchestration-reconcile.test.ts

# Phase 8K — SDK/API contract freeze
node_modules/.bin/tsx --tsconfig apps/api/tsconfig.node.json --test \
  apps/api/src/__tests__/payment-orchestration-8k-contract-freeze.test.ts
```

Expected pass counts (all phases combined):

| Test file | Tests | Pass |
|---|---:|---:|
| payment-orchestration-service-fakegateway-flow | 20 | 20 |
| payment-orchestration-service-http-auth | 13 | 13 |
| payment-orchestration-atomic-confirm | 11 | 11 |
| payment-orchestration-standalone-webhook | 13 | 13 |
| payment-orchestration-webhook-route-auth-bypass | 7 | 7 |
| payment-orchestration-reconcile | 5 | 5 |
| payment-orchestration-schema-mappers | 56 | 56 |
| payment-orchestration-core-contract-adapter | 14 | 14 |
| payment-orchestration-xendit-gateway-integration | 11 | 11 |
| payment-orchestration-8k-contract-freeze | 17 | 17 |

---

## Phase 8J standalone worker and extraction checks

### Worker runner

The standalone service can run operational workers without starting Express:

```bash
pnpm --filter @northflow/payment-orchestration-service worker -- expire-stale --limit 100
pnpm --filter @northflow/payment-orchestration-service worker -- reprocess-provider-events --older-than-minutes 5 --limit 100
pnpm --filter @northflow/payment-orchestration-service worker -- reconcile-intent --merchant-id <MERCHANT_ID> --intent-id <INTENT_ID>
pnpm --filter @northflow/payment-orchestration-service worker -- all-safe --limit 100
```

Each command prints a JSON summary and exits non-zero on invalid arguments or operational errors. `all-safe` intentionally runs only local-safe operations (`expire-stale` and `reprocess-provider-events`) and does not require provider network calls.

### Extraction simulation

Run the extraction guardrail check from the repository root:

```bash
pnpm payment-orchestration:extraction-check
```

The check verifies service-local schema ownership, repository schema imports, standalone migrations, worker entry points, the ready endpoint, required package files, forbidden embedded runtime imports, absence of random build/log/asset output in the extraction set, and Phase 8K contract/deployment files.
