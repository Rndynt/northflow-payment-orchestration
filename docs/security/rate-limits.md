# Rate Limits and Abuse Protection — S9.2

Northflow enforces per-client rate limits on all authenticated `/v1` endpoints to
protect service stability and prevent abuse.

---

## Rate Limit Model

Limits are applied per API client using a **fixed-window** algorithm:

| Bucket | Key pattern | Default |
|---|---|---|
| Global per-client | `client:{clientId}:global` | 600 req/min |
| Per-route per-client | `client:{clientId}:route:{method}:{routeGroup}` | 120 req/min |
| Auth failure per-IP | `ip:{ip}:auth_fail` | 30 failures/min |

- **Global limit** — total requests across all routes for a single client.
- **Per-route limit** — requests to a specific route group (see below).
- **Auth failure limit** — repeated authentication failures from a single IP.

### Route groups

| Route | Group |
|---|---|
| `POST /v1/payment-intents/:id/gateway-payments` | `gateway_payment.create` |
| `POST /v1/payment-transactions/:id/refund` | `payment.refund` |
| `POST /v1/payment-transactions/:id/void` | `payment.void` |
| `POST /v1/payment-transactions/:id/reconcile` | `payment.reconcile` |
| `POST /v1/merchants/:mid/provider-accounts/:paid/payment-methods/sync` | `payment_method.sync` |
| `POST /v1/api-clients/:id/credentials` | `api_client.credential.create` |
| `GET /v1/api-clients/:id/credentials` | `api_client.credential.read` |
| `POST /v1/api-clients/:id/credentials/rotate` | `api_client.credential.rotate` |
| `POST /v1/api-clients/:id/credentials/:credId/revoke` | `api_client.credential.revoke` |
| All other routes | `default` |

---

## Response Headers

Every authenticated request receives rate limit headers:

```
X-RateLimit-Limit: 600
X-RateLimit-Remaining: 598
X-RateLimit-Reset: 1749292800
```

- `X-RateLimit-Limit` — effective limit for the most restrictive active bucket
- `X-RateLimit-Remaining` — remaining requests in the current window
- `X-RateLimit-Reset` — Unix timestamp (seconds) when the window resets

---

## 429 Too Many Requests

When a rate limit is exceeded, the service returns:

```
HTTP/1.1 429 Too Many Requests
Retry-After: 42
X-RateLimit-Limit: 600
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1749292800
Content-Type: application/json

{
  "ok": false,
  "error": {
    "code": "RATE_LIMITED",
    "message": "Global rate limit exceeded. Please slow down.",
    "details": null
  }
}
```

Callers should respect `Retry-After` and back off for the specified number of seconds.

---

## Auth Failure Protection

Repeated authentication failures from a single IP are rate-limited independently
of authenticated request limits:

- Counter: `ip:{ip}:auth_fail` per 60-second window
- Default threshold: **30 failures/minute**
- Response: `429 RATE_LIMITED` instead of `401 UNAUTHORIZED`

This prevents brute-force attacks against credential secrets.

Security note: the auth failure counter is incremented regardless of whether
a credential prefix exists in the database — callers cannot determine if a
prefix is valid via timing or error code differences.

---

## Configuration

Rate limits are configured via environment variables:

| Variable | Default | Description |
|---|---|---|
| `PAYMENT_ORCHESTRATION_RATE_LIMIT_ENABLED` | `true` | Enable/disable rate limiting |
| `PAYMENT_ORCHESTRATION_RATE_LIMIT_CLIENT_GLOBAL_PER_MINUTE` | `600` | Global per-client limit |
| `PAYMENT_ORCHESTRATION_RATE_LIMIT_CLIENT_ROUTE_PER_MINUTE` | `120` | Per-route per-client limit |
| `PAYMENT_ORCHESTRATION_RATE_LIMIT_AUTH_FAILURE_PER_MINUTE` | `30` | Auth failure limit per IP |

To disable rate limiting in test/dev environments:

```env
PAYMENT_ORCHESTRATION_RATE_LIMIT_ENABLED=false
```

---

## Implementation Notes

**Storage:** The current implementation uses an in-process `InMemoryRateLimiterStore`
with fixed-window buckets. Window boundaries are aligned to clock time.

**Scaling:** For multi-instance deployments, a `RedisRateLimiterStore` should be
implemented behind the `RateLimiterStore` interface (see `apps/service/src/rate-limit/rateLimiter.ts`).
The interface is compatible — no caller changes required.

**Audit trail:** Rate limit denials are recorded in the audit log as `rate_limit.denied`
events with metadata including route group, limit, and reset timestamp.
Credential material is never included in audit metadata.

---

## Phase S9.3 — Distributed Rate Limiting (Planned)

The current in-memory store resets on service restart and is not shared across
instances. Phase S9.3 will migrate the `RateLimiterStore` interface to a Redis
or Valkey backend for persistent, distributed rate limiting.
