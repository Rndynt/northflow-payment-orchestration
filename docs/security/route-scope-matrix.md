# Route → Scope Matrix

Authoritative mapping of every service route to its required API credential scope.
Generated as part of S10.4 contract freeze.

All `/v1/*` routes require a valid bearer credential (`Authorization: Bearer <rawSecret>`).
Routes below additionally require the listed scope to be present in the credential's `scopes` array.
Requests missing the scope receive `403 SCOPE_DENIED`.

## Legend

| Symbol | Meaning |
|--------|---------|
| ✓      | Route exists and scope is enforced via `requireScope` middleware |
| –      | No scope required (open route or provider webhook HMAC) |

---

## Health / Version

| Method | Path      | Required Scope | Notes                          |
|--------|-----------|----------------|-------------------------------|
| GET    | /health   | –              | No auth required              |
| GET    | /version  | –              | No auth required              |
| GET    | /ready    | –              | No auth required              |

---

## Merchants

| Method | Path                 | Required Scope    |
|--------|----------------------|-------------------|
| POST   | /v1/merchants        | `merchant:create` |
| GET    | /v1/merchants/{id}   | `merchant:read`   |

---

## Provider Accounts

| Method | Path                                                    | Required Scope            |
|--------|---------------------------------------------------------|---------------------------|
| POST   | /v1/merchants/{merchantId}/provider-accounts            | `provider_account:create` |
| GET    | /v1/merchants/{merchantId}/provider-accounts/{id}       | `provider_account:read`   |

---

## Payment Methods

| Method | Path                                                                              | Required Scope          |
|--------|-----------------------------------------------------------------------------------|-------------------------|
| GET    | /v1/merchants/{merchantId}/provider-accounts/{providerAccountId}/methods         | `payment_method:read`   |
| PUT    | /v1/merchants/{merchantId}/provider-accounts/{providerAccountId}/methods/{method} | `payment_method:write`  |
| POST   | /v1/merchants/{merchantId}/provider-accounts/{providerAccountId}/methods/sync    | `payment_method:sync`   |
| GET    | /v1/merchants/{merchantId}/payment-methods                                        | `payment_method:read`   |
| GET    | /v1/payment-intents/{intentId}/payment-options                                    | `payment_method:read`   |

---

## Payment Intents

| Method | Path                                          | Required Scope      |
|--------|-----------------------------------------------|---------------------|
| POST   | /v1/payment-intents                           | `intent:create`     |
| GET    | /v1/payment-intents/{id}/status               | `intent:read`       |
| GET    | /v1/payment-intents/{id}/refundability        | `intent:read`       |
| POST   | /v1/payment-intents/{id}/gateway-payments     | `payment:create`    |
| POST   | /v1/payment-intents/{id}/reconcile            | `payment:reconcile` |

---

## Payment Transactions

| Method | Path                                                       | Required Scope     |
|--------|------------------------------------------------------------|--------------------|
| POST   | /v1/payment-transactions/{id}/refresh-provider-status     | `intent:read`      |
| POST   | /v1/payment-transactions/{transactionId}/refund            | `payment:refund`   |
| POST   | /v1/payment-transactions/{transactionId}/void              | `payment:void`     |

---

## Audit Logs

| Method | Path             | Required Scope   |
|--------|------------------|------------------|
| GET    | /v1/audit-logs   | `audit_log:read` |

---

## API Clients — Credentials

| Method | Path                                                           | Required Scope                  |
|--------|----------------------------------------------------------------|---------------------------------|
| POST   | /v1/api-clients/{clientId}/credentials                        | `api_client:credential:create`  |
| GET    | /v1/api-clients/{clientId}/credentials                        | `api_client:credential:read`    |
| POST   | /v1/api-clients/{clientId}/credentials/rotate                 | `api_client:credential:rotate`  |
| POST   | /v1/api-clients/{clientId}/credentials/{credentialId}/revoke  | `api_client:credential:revoke`  |

---

## API Clients — Signing Keys

| Method | Path                                                               | Required Scope                    |
|--------|--------------------------------------------------------------------|-----------------------------------|
| POST   | /v1/api-clients/{clientId}/signing-keys                           | `api_client:signing_key:create`   |
| GET    | /v1/api-clients/{clientId}/signing-keys                           | `api_client:signing_key:read`     |
| POST   | /v1/api-clients/{clientId}/signing-keys/rotate                    | `api_client:signing_key:rotate`   |
| POST   | /v1/api-clients/{clientId}/signing-keys/{signingKeyId}/revoke     | `api_client:signing_key:revoke`   |

---

## Merchant Outbound Webhooks

| Method | Path                                                                          | Required Scope    |
|--------|-------------------------------------------------------------------------------|-------------------|
| POST   | /v1/merchants/{merchantId}/webhooks/endpoints                                 | `webhook:manage`  |
| GET    | /v1/merchants/{merchantId}/webhooks/endpoints                                 | `webhook:read`    |
| POST   | /v1/merchants/{merchantId}/webhooks/endpoints/{endpointId}/disable            | `webhook:manage`  |
| POST   | /v1/merchants/{merchantId}/webhooks/endpoints/{endpointId}/rotate-secret      | `webhook:manage`  |
| GET    | /v1/merchants/{merchantId}/webhooks/deliveries                                | `webhook:read`    |
| POST   | /v1/merchants/{merchantId}/webhooks/replay                                    | `webhook:manage`  |

---

## Provider Webhooks

| Method | Path                        | Required Scope | Notes                                     |
|--------|-----------------------------|----------------|-------------------------------------------|
| POST   | /v1/webhooks/{provider}     | –              | Authenticated via provider HMAC signature |

---

## Dev / Fake Gateway

| Method | Path                                               | Required Scope   | Notes              |
|--------|----------------------------------------------------|------------------|--------------------|
| POST   | /v1/dev/fake-gateway/transactions/{id}/confirm     | `payment:create` | Non-production only |

---

## Complete Scope Reference

All scopes that exist in the system as of S10.4 contract freeze:

| Scope                           | Purpose                                           |
|---------------------------------|---------------------------------------------------|
| `merchant:create`               | Create merchants                                  |
| `merchant:read`                 | Read merchant records                             |
| `provider_account:create`       | Create provider accounts                          |
| `provider_account:read`         | Read provider account records                     |
| `intent:create`                 | Create payment intents                            |
| `intent:read`                   | Read payment intent status and metadata           |
| `payment:create`                | Initiate gateway payments                         |
| `payment:refund`                | Refund transactions                               |
| `payment:void`                  | Void transactions                                 |
| `payment:reconcile`             | Reconcile payment intent totals                   |
| `payment_method:read`           | List provider account methods and payment options |
| `payment_method:write`          | Upsert provider account methods                   |
| `payment_method:sync`           | Sync provider account methods from provider       |
| `audit_log:read`                | Read audit log entries                            |
| `api_client:credential:create`  | Create API client credentials                     |
| `api_client:credential:read`    | List API client credentials                       |
| `api_client:credential:rotate`  | Rotate API client credentials                     |
| `api_client:credential:revoke`  | Revoke API client credentials                     |
| `api_client:signing_key:create` | Create HMAC signing keys                          |
| `api_client:signing_key:read`   | List HMAC signing keys                            |
| `api_client:signing_key:rotate` | Rotate HMAC signing keys                          |
| `api_client:signing_key:revoke` | Revoke HMAC signing keys                          |
| `webhook:manage`                | Create/disable/rotate/replay merchant webhooks    |
| `webhook:read`                  | List merchant webhook endpoints and deliveries    |
