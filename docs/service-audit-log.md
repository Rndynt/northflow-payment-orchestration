# Service Audit Log — S8

## Overview

The payment orchestration service maintains an immutable audit trail of all protected API activity.  
Every authenticated call to a protected route creates an audit log entry recording who called, which merchant was affected, what action was performed, and what the outcome was.

Audit logs are **best-effort**: audit write failures are logged to console but never propagate to the calling client. Payment operations are never blocked by audit subsystem failures.

---

## Data Model

Table: `po_audit_logs`

| Column | Type | Nullable | Description |
|---|---|---|---|
| `id` | text | no | UUID primary key |
| `request_id` | text | no | Correlation ID from `x-request-id` or generated |
| `client_id` | text | yes | API client identity (`req.auth.clientId`) |
| `source_app` | text | yes | Consumer application (`aurapos`, `transity`, etc.) |
| `merchant_id` | text | yes | Target merchant — nullable for global actions |
| `actor_type` | text | no | `api_client`, `legacy_client`, `internal`, `system`, `worker`, `unknown` |
| `action` | text | no | Action name (see [Action Registry](#action-registry)) |
| `resource_type` | text | yes | Resource type affected (`merchant`, `payment_intent`, `transaction`, etc.) |
| `resource_id` | text | yes | Resource ID affected |
| `status` | text | no | `success`, `failure`, `denied`, `error` |
| `http_method` | text | yes | HTTP method (`POST`, `GET`, etc.) |
| `path` | text | yes | Request path (no query string) |
| `status_code` | integer | yes | HTTP response status code |
| `error_code` | text | yes | Error code for non-success outcomes |
| `ip_address` | text | yes | Client IP (respects `X-Forwarded-For`) |
| `user_agent` | text | yes | Client user agent (truncated to 256 chars) |
| `metadata` | jsonb | no | Additional context (safe, small) |
| `created_at` | timestamp | no | When the log entry was created |

---

## Status Values

| Status | Meaning |
|---|---|
| `success` | Operation completed normally |
| `failure` | Operation failed due to business rules (not found, validation) |
| `denied` | Authorization denied (`MERCHANT_ACCESS_DENIED`, `SCOPE_DENIED`, `SOURCE_APP_MISMATCH`) |
| `error` | Unexpected internal error |

---

## Actor Type Values

| Actor Type | When Used |
|---|---|
| `api_client` | Normal per-client API key authentication |
| `legacy_client` | Legacy shared service token (`clientId='legacy'`) |
| `internal` | Internal system calls (`sourceApp='internal'`) |
| `system` | Scheduled tasks and background workers |
| `worker` | Explicit background job actors |
| `unknown` | No auth context available |

---

## Action Registry

| Action | Route | Scope |
|---|---|---|
| `merchant.create` | `POST /v1/merchants` | `merchant:create` |
| `merchant.read` | `GET /v1/merchants/:id` | `merchant:read` |
| `provider_account.create` | `POST /v1/merchants/:id/provider-accounts` | `provider_account:create` |
| `provider_account.read` | `GET /v1/merchants/:id/provider-accounts/:id` | `provider_account:read` |
| `payment_method.list` | `GET .../methods`, `GET .../payment-methods` | `payment_method:read` or `provider_account:read` |
| `payment_method.upsert` | `PUT .../methods/:method` | `payment_method:write` or `provider_account:create` |
| `payment_method.sync` | `POST .../methods/sync` | `payment_method:sync` or `provider_account:create` |
| `payment_options.read` | `GET /v1/payment-intents/:id/payment-options` | `payment_method:read` or `intent:read` |
| `payment_intent.create` | `POST /v1/payment-intents` | `intent:create` |
| `payment_intent.status.read` | `GET /v1/payment-intents/:id/status` | `intent:read` |
| `payment_intent.refundability.read` | `GET /v1/payment-intents/:id/refundability` | `intent:read` |
| `gateway_payment.create` | `POST /v1/payment-intents/:id/gateway-payments` | `payment:create` |
| `payment.refund` | `POST /v1/payment-transactions/:id/refund` | `payment:refund` |
| `payment.void` | `POST /v1/payment-transactions/:id/void` | `payment:void` |
| `payment.reconcile` | `POST /v1/payment-intents/:id/reconcile` | `payment:reconcile` |
| `audit_log.read` | `GET /v1/audit-logs` | `audit_log:read` |

### Routes Not Audited

| Route | Reason |
|---|---|
| `POST /v1/payment-transactions/:id/refresh-provider-status` | Internal/legacy client operation; audited as `payment_intent.status.read` |
| `POST /v1/webhooks/*` | Unauthenticated provider webhook — no auth context available |
| `POST /v1/dev/fake-gateway/*` | Dev/test only route, not in production |
| `GET /health`, `GET /ready`, `GET /version` | Unprotected health endpoints |

---

## Read API

### `GET /v1/audit-logs`

List audit log entries.

**Required scope**: `audit_log:read`

**Access control**:
- Internal/legacy clients: receive all entries (filterable).
- Normal API clients: receive only entries scoped to their `clientId`, or entries for a specific `merchantId` they have access to.

**Query parameters**:

| Parameter | Type | Description |
|---|---|---|
| `merchantId` | string | Filter by merchant ID (access-checked for normal clients) |
| `clientId` | string | Filter by client ID (privileged clients only) |
| `action` | string | Filter by action name (exact match) |
| `status` | string | Filter by status (`success`, `failure`, `denied`, `error`) |
| `limit` | integer | Max entries per page (default `50`, max `200`) |
| `offset` | integer | Pagination offset (default `0`) |

**Response**:

```json
{
  "ok": true,
  "data": {
    "entries": [
      {
        "id": "...",
        "requestId": "...",
        "clientId": "client_aurapos_prod",
        "sourceApp": "aurapos",
        "merchantId": "mer_cafe_mawar",
        "actorType": "api_client",
        "action": "payment_intent.create",
        "resourceType": "payment_intent",
        "resourceId": "pi_...",
        "status": "success",
        "httpMethod": "POST",
        "path": "/v1/payment-intents",
        "statusCode": 201,
        "errorCode": null,
        "metadata": {},
        "createdAt": "2026-06-07T10:00:00.000Z"
      }
    ],
    "total": 1,
    "limit": 50,
    "offset": 0
  }
}
```

---

## Security Rules

1. **Never store**: API keys, Authorization headers, `x-nf-api-key` values, credential hashes, provider secrets, raw provider responses, or full request/response bodies.
2. **IP addresses**: Extracted from `X-Forwarded-For` (first hop) or socket remote address. Never stored from headers that could be spoofed in ways that include auth material.
3. **User-agent**: Truncated to 256 characters.
4. **Path**: Query string stripped — only the route path is stored (no query parameter values that may contain sensitive data).
5. **Metadata**: Must be small (< 2KB), safe, and contain only operational context (counts, flags, non-secret resource identifiers).

---

## Migration

Migration file: `migrations/0008_po_audit_logs.sql`  
Journal entry: idx=8, tag=`0008_po_audit_logs`

To apply:
```bash
pnpm db:migrate
```

---

## Indexes

| Index | Columns | Purpose |
|---|---|---|
| `po_audit_logs_request_id_idx` | `request_id` | Correlate all entries for a single request |
| `po_audit_logs_client_id_idx` | `client_id` | Filter by API client |
| `po_audit_logs_merchant_id_idx` | `merchant_id` | Filter by merchant |
| `po_audit_logs_action_idx` | `action` | Filter by action type |
| `po_audit_logs_resource_idx` | `resource_type, resource_id` | Look up all audit events for a resource |
| `po_audit_logs_status_idx` | `status` | Filter by outcome |
| `po_audit_logs_created_at_idx` | `created_at` | Time-range queries (newest-first pagination) |
