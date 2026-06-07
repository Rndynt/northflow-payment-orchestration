# Signed Requests — HMAC Authentication

**Phase S9.4** — Production-grade HMAC signed request support for the Payment Orchestration service.

Signed requests provide a higher-assurance authentication method compared to bearer token auth. Every protected request is cryptographically bound to a specific signing key and timestamp, preventing replay attacks.

---

## Overview

The service supports three authentication modes for protected `/v1/...` routes:

| Mode | Description |
|---|---|
| `disabled` | Only bearer token auth is accepted. Signed headers are ignored. |
| `optional` | Both bearer tokens and signed requests are accepted. When signed headers are present, they are used exclusively (no bearer fallback). Default. |
| `required` | Only signed requests are accepted. Bearer-only requests are rejected with `SIGNED_REQUEST_REQUIRED`. |

Configure via environment variable:
```
PAYMENT_ORCHESTRATION_SIGNED_REQUESTS_MODE=optional
```

---

## Signing Key Lifecycle

Signing keys are separate from API credentials. A single API client can have multiple concurrent signing keys (for rotation without downtime).

### Creating a signing key

```http
POST /v1/api-clients/{clientId}/signing-keys
Authorization: Bearer nf.live.{credentialId}.{secret}

{
  "expiresAt": "2027-01-01T00:00:00Z"   // optional
}
```

Response — rawSigningSecret is returned **once only**:

```json
{
  "ok": true,
  "data": {
    "id": "...",
    "clientId": "...",
    "keyPrefix": "nfsk.aBcD1234ef56",
    "status": "active",
    "expiresAt": "2027-01-01T00:00:00.000Z",
    "rawSigningSecret": "..."
  }
}
```

**Store `rawSigningSecret` securely. It is never shown again.**

### Rotating a signing key

```http
POST /v1/api-clients/{clientId}/signing-keys/rotate

{
  "revokeOldKeyId": "previous-key-id",
  "expiresAt": "2027-01-01T00:00:00Z"
}
```

### Revoking a signing key

```http
POST /v1/api-clients/{clientId}/signing-keys/{signingKeyId}/revoke
```

Revoked keys are rejected immediately. No grace period.

### Listing signing keys

```http
GET /v1/api-clients/{clientId}/signing-keys
```

Returns all keys (safe view — no secret material).

---

## Signing a Request

### Required headers

| Header | Value |
|---|---|
| `x-nf-client-id` | Your API client ID |
| `x-nf-key-id` | Key prefix from create/rotate response (e.g. `nfsk.aBcD1234ef56`) |
| `x-nf-timestamp` | Current Unix time in **milliseconds** |
| `x-nf-nonce` | Unique random string (16+ bytes of entropy, base64url recommended) |
| `x-nf-signature` | Lowercase hex HMAC-SHA256 of the canonical string |
| `x-nf-signature-version` | `v1` |

### Canonical string format

```
NF-HMAC-SHA256-V1\n
<timestamp_unix_ms>\n
<nonce>\n
<METHOD>\n
<path>\n
<canonical_query>\n
<body_sha256_hex>
```

Rules:
- **timestamp_unix_ms**: decimal string, e.g. `1749312000000`
- **nonce**: caller-provided unique string per request
- **METHOD**: HTTP verb in UPPERCASE (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`)
- **path**: request path without scheme or host, e.g. `/v1/payment-intents`
- **canonical_query**: query keys sorted lexicographically, values percent-encoded. Format: `key=value&key2=value2` (no leading `?`). Multi-value keys each appear separately, sorted by value.
- **body_sha256_hex**: SHA-256 hex of the raw request body bytes. For requests with no body (GET, DELETE): SHA-256 of empty string = `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`

### Signature computation

```
signature = HMAC-SHA256(rawSigningSecret, canonicalString)
            expressed as lowercase hex
```

---

## SDK Usage

The SDK signs requests automatically when `signing` config is provided:

```typescript
import { PaymentOrchestrationClient } from '@northflow/payment-orchestration-sdk';

const client = new PaymentOrchestrationClient({
  baseUrl: 'https://your-service.example.com',
  apiKey: 'nf.live.credId.secret',   // bearer auth (optional alongside signing)
  signing: {
    clientId: 'client_yourapp_prod',
    keyId: 'nfsk.aBcD1234ef56',
    secret: 'rawSigningSecretFromCreateResponse',
  },
});

// All requests are now signed automatically.
const intent = await client.createPaymentIntent({ ... });
```

To disable signing temporarily (e.g. for testing):
```typescript
signing: { ..., enabled: false }
```

---

## Security Properties

| Property | Guarantee |
|---|---|
| **Request integrity** | Signature covers method, path, query, body, timestamp, nonce. Any modification invalidates the signature. |
| **Replay prevention** | Nonces are consumed atomically. Each nonce can be used at most once within the nonce TTL window. |
| **Clock skew tolerance** | Requests are rejected if the timestamp is outside ±`PAYMENT_ORCHESTRATION_SIGNED_REQUEST_MAX_SKEW_SECONDS` (default 300s = 5 minutes). |
| **Constant-time comparison** | Signatures are compared with `timingSafeEqual` to prevent timing side-channels. |
| **Secret protection** | Signing secrets are stored encrypted (AES-256-GCM) using `PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_SECRET`. |
| **No bearer fallback** | If signed headers are present and the signature is invalid, the request is rejected — it does NOT fall back to bearer auth. |
| **Rate limiting** | Failed signed auth attempts count toward the IP-based auth failure rate limit. |

---

## Configuration Reference

| Environment Variable | Default | Description |
|---|---|---|
| `PAYMENT_ORCHESTRATION_SIGNED_REQUESTS_MODE` | `optional` | `disabled`, `optional`, or `required` |
| `PAYMENT_ORCHESTRATION_SIGNED_REQUEST_MAX_SKEW_SECONDS` | `300` | Max allowed timestamp skew (seconds) |
| `PAYMENT_ORCHESTRATION_SIGNED_REQUEST_NONCE_TTL_SECONDS` | `600` | Nonce expiry window (seconds). Must be ≥ max skew. |
| `PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_SECRET` | (required for key create/rotate) | AES-256-GCM master key for signing secret encryption. Min 16 chars. |
| `PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_KEY_VERSION` | `v1` | Encryption key version label stored with ciphertext. |

---

## Error Codes

| Code | HTTP | Description |
|---|---|---|
| `SIGNED_REQUEST_REQUIRED` | 401 | Service is in `required` mode but no signed headers were present. |
| `SIGNED_REQUEST_HEADERS_MISSING` | 401 | One or more required signed request headers are missing or empty. |
| `SIGNED_REQUEST_SIGNATURE_INVALID` | 401 | HMAC signature does not match. Check canonical string construction. |
| `SIGNED_REQUEST_TIMESTAMP_INVALID` | 401 | `x-nf-timestamp` is not a valid Unix millisecond integer. |
| `SIGNED_REQUEST_TIMESTAMP_EXPIRED` | 401 | Timestamp is outside the allowed skew window. Sync your clock. |
| `SIGNED_REQUEST_KEY_NOT_FOUND` | 401 | No active signing key found for the provided key ID and client ID. |
| `SIGNED_REQUEST_KEY_REVOKED` | 401 | The signing key has been revoked. |
| `SIGNED_REQUEST_KEY_EXPIRED` | 401 | The signing key has expired. |
| `SIGNED_REQUEST_NONCE_REPLAYED` | 401 | This nonce was already used. Each request requires a unique nonce. |
| `SIGNED_REQUEST_SECRET_UNAVAILABLE` | 401 | Internal error verifying the signed request. Contact the service operator. |
| `SERVICE_MISCONFIGURED` | 503 | `PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_SECRET` is not set. |
| `SIGNING_KEY_NOT_FOUND` | 404 | The signing key ID does not exist. |
| `SIGNING_KEY_NOT_OWNED` | 403 | The signing key belongs to a different API client. |

---

## Exempted Routes

These routes do not require signed requests even in `required` mode:

- `GET /health`
- `GET /version`
- `GET /ready`
- `POST /v1/webhooks/*`
- `* /v1/dev/*` (non-production only)
