# Bootstrap Operator Guide

Manual bootstrap order for a fresh Northflow deployment.
Run these steps in sequence before pointing any consumer app at the service.

---

## Bootstrap order

```
1. Run migrations
2. Create API client for consumer app
3. Create credential for the client
4. Store raw credential once in your backend secret manager
5. Create merchant
6. Grant client merchant access with required scopes
7. Create provider account for the merchant
8. Enable / sync payment methods
9. Configure merchant outbound webhook endpoint (if needed)
10. Run runtime readiness script
11. Run bootstrap smoke script in sandbox/staging
12. Only then point consumer app to the deployed service
```

---

## Step 1 — Run migrations

```bash
pnpm db:migrate
```

This applies all pending migrations under `migrations/`. Safe to run on every deploy — migrations are additive.

---

## Step 2 — Create API client

Use the `nf:admin` CLI tool included with the service:

```bash
pnpm --filter @northflow/payment-orchestration-service nf:admin client:create \
  --sourceApp aura_pos \
  --name "AuraPoS Production"
```

Returns:
```json
{ "id": "client_xxx", "sourceApp": "aura_pos", "name": "AuraPoS Production" }
```

Store `client_xxx` — needed for credential creation and access grants.

---

## Step 3 — Create credential

```bash
pnpm --filter @northflow/payment-orchestration-service nf:admin credential:create \
  --clientId client_xxx
```

Returns `rawSecret` **once only**:
```
nf.live.cred_xxx.<secret>
```

**Store immediately in your backend secret manager (AWS SSM, Vault, GCP Secret Manager, etc.).**
This value is never returned again. If lost, rotate with `credential:rotate`.

---

## Step 4 — Store raw credential

Store in secret manager:
- Key: `northflow/<app>/<env>/api_key`
- Value: `nf.live.cred_xxx.<secret>`

Set `NORTHFLOW_API_KEY` in the consumer app to this value.

---

## Step 5 — Create merchant

### AuraPoS (REST)

```bash
curl -X POST "$NORTHFLOW_BASE_URL/v1/merchants" \
  -H "Authorization: Bearer nf.live.cred_xxx.<secret>" \
  -H "Content-Type: application/json" \
  -d '{"externalRef": "aura_pos_merchant_1", "name": "Merchant Name", "currency": "IDR"}'
```

### Transity (SDK)

```typescript
const merchant = await northflow.createMerchant({
  externalRef: 'transity_tenant_1',
  name: 'Tenant Name',
  currency: 'IDR',
  sourceApp: 'transity',
});
```

### Kioskoin (REST)

```bash
curl -X POST "$NORTHFLOW_BASE_URL/v1/merchants" \
  -H "Authorization: Bearer nf.live.cred_xxx.<secret>" \
  -H "Content-Type: application/json" \
  -d '{"externalRef": "kioskoin_main", "name": "Kioskoin Business", "currency": "IDR"}'
```

Store returned `merchantId`. For Kioskoin, set as `NORTHFLOW_MERCHANT_ID` env var.

> Merchant access is automatically granted to the creating client.
> For additional clients, grant access via the admin CLI: `nf:admin access:grant`.

---

## Step 6 — Grant client merchant access with scopes

If merchant was not created by this client, grant access explicitly:

```bash
pnpm --filter @northflow/payment-orchestration-service nf:admin access:grant \
  --clientId client_xxx \
  --merchantId mer_xxx \
  --scopes "intent:create,payment:create,intent:read,payment:refund,payment:void,payment_method:read,webhook:manage,webhook:read"
```

Scope list varies by consumer. See `docs/security/route-scope-matrix.md` for full scope reference.

---

## Step 7 — Create provider account

### AuraPoS / Transity / Kioskoin (REST)

```bash
curl -X POST "$NORTHFLOW_BASE_URL/v1/merchants/$MERCHANT_ID/provider-accounts" \
  -H "Authorization: Bearer nf.live.cred_xxx.<secret>" \
  -H "x-payment-merchant-id: $MERCHANT_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "merchantId": "<merchant-id>",
    "provider": "fake_gateway",
    "externalAccountId": "smoke-account-1",
    "environment": "sandbox",
    "sourceApp": "<source-app>"
  }'
```

For production, replace `fake_gateway` with `xendit_sandbox` or `manual`.

---

## Step 8 — Enable / sync payment methods

### Upsert (manual):

```bash
curl -X PUT "$NORTHFLOW_BASE_URL/v1/merchants/$MERCHANT_ID/provider-accounts/$PA_ID/methods/qris" \
  -H "Authorization: Bearer nf.live.cred_xxx.<secret>" \
  -H "x-payment-merchant-id: $MERCHANT_ID" \
  -H "Content-Type: application/json" \
  -d '{"methodType":"qris","displayName":"QRIS","status":"active","currency":"IDR","sortOrder":1}'
```

### Sync (automatic — pulls from provider):

```bash
curl -X POST "$NORTHFLOW_BASE_URL/v1/merchants/$MERCHANT_ID/provider-accounts/$PA_ID/methods/sync" \
  -H "Authorization: Bearer nf.live.cred_xxx.<secret>" \
  -H "x-payment-merchant-id: $MERCHANT_ID"
```

---

## Step 9 — Configure merchant outbound webhook (optional)

Only needed if the consumer app needs real-time payment event notifications.

```bash
curl -X POST "$NORTHFLOW_BASE_URL/v1/merchants/$MERCHANT_ID/webhooks/endpoints" \
  -H "Authorization: Bearer nf.live.cred_xxx.<secret>" \
  -H "x-payment-merchant-id: $MERCHANT_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-app.example.com/webhooks/northflow",
    "subscribedEvents": [
      "payment_intent.paid",
      "payment_intent.failed",
      "payment_transaction.succeeded",
      "payment_transaction.failed"
    ]
  }'
```

Response includes `rawSecret` **once only**. Store in secret manager immediately.
Use it to verify incoming webhook HMAC signatures (see `webhook-signature-verification.md`).

---

## Step 10 — Run runtime readiness script

```bash
NORTHFLOW_BASE_URL=https://your-service.example.com \
NORTHFLOW_READY_TOKEN=<ready-token-if-configured> \
NORTHFLOW_API_KEY=nf.live.cred_xxx.<secret> \
NORTHFLOW_MERCHANT_ID=mer_xxx \
pnpm s10:readiness
```

Expected output: all checks PASS.

---

## Step 11 — Run bootstrap smoke script in sandbox/staging

**Only run in sandbox or staging — this creates real data.**

```bash
NORTHFLOW_BASE_URL=https://staging.example.com \
NORTHFLOW_API_KEY=nf.staging.cred_xxx.<secret> \
NORTHFLOW_SOURCE_APP=aura_pos \
NORTHFLOW_SMOKE_MERCHANT_NAME="Smoke Test Merchant" \
NORTHFLOW_SMOKE_EXTERNAL_REF="smoke_$(date +%s)" \
NORTHFLOW_SMOKE_PROVIDER=fake_gateway \
NORTHFLOW_SMOKE_METHOD=qris \
NORTHFLOW_SMOKE_CURRENCY=IDR \
NORTHFLOW_SMOKE_AMOUNT=10000 \
pnpm s10:smoke
```

All checks must show PASS before proceeding.

---

## Step 12 — Point consumer app to service

Only after steps 1–11 pass:

1. Set `NORTHFLOW_BASE_URL`, `NORTHFLOW_API_KEY`, `NORTHFLOW_MERCHANT_ID` in consumer app.
2. Deploy consumer app.
3. Verify first real transaction in sandbox.
4. Promote to production.

---

## Consumer-specific scope recommendations

### AuraPoS (multi-tenant REST)
```
merchant:create, merchant:read, provider_account:create, provider_account:read,
intent:create, intent:read, payment:create, payment:refund, payment:void,
payment_method:read, webhook:manage, webhook:read
```

### Transity (multi-tenant SDK)
```
merchant:create, merchant:read, provider_account:create, provider_account:read,
intent:create, intent:read, payment:create, payment:refund, payment:void,
payment_method:read, payment_method:write, webhook:manage, webhook:read
```

### Kioskoin (single-merchant REST)
```
merchant:read, provider_account:read, intent:create, intent:read,
payment:create, payment:void, payment_method:read
```

---

## Credential rotation

```bash
# Create new credential, revoke old one atomically
pnpm --filter @northflow/payment-orchestration-service nf:admin credential:rotate \
  --clientId client_xxx \
  --revokeOldCredentialId cred_old
```

Or via REST:
```bash
curl -X POST "$NORTHFLOW_BASE_URL/v1/api-clients/$CLIENT_ID/credentials/rotate" \
  -H "Authorization: Bearer nf.live.cred_xxx.<secret>" \
  -H "Content-Type: application/json" \
  -d '{"revokeOldCredentialId": "cred_old"}'
```

Update `NORTHFLOW_API_KEY` in consumer app before old credential expires.

---

## Secret handling rules

- All `rawSecret` values are returned **once only**. Store immediately in a backend secret manager.
- Never log, print, or include raw credentials in documentation.
- Never use `NEXT_PUBLIC_`, `VITE_`, `EXPO_PUBLIC_` or any frontend-visible env prefix for Northflow credentials.
- Rotate credentials immediately if compromise is suspected.
