# API Key Rotation — S9.1

Northflow supports zero-downtime credential rotation. Each API client can have
multiple active credentials simultaneously, enabling you to rotate without
interrupting live traffic.

---

## Credential Format

All credentials follow the pattern:

```
nf.<environment>.<credentialId>.<secret>
```

Examples:
```
nf.live.abc123def456.SomeBase64UrlSecret___
nf.sandbox.xyz789ghi012.AnotherBase64UrlSecret
```

- `environment` — the client's configured environment (e.g. `live`, `sandbox`, `test`)
- `credentialId` — the stable, unique identifier for this credential (used for revocation)
- `secret` — 32-byte random secret, base64url-encoded, shown **exactly once** at creation

### Security invariants

- The **raw credential is never stored** — only a SHA-256 hash and the prefix are persisted.
- The raw credential is returned **only once** in the create/rotate response body.
- Subsequent list/read endpoints **never** return the raw credential or hash.
- Credential hash must **never** be logged, stored in metadata, or returned in any API response.

---

## API Endpoints

All credential management endpoints require authentication and appropriate scopes.

### Create a credential

```
POST /v1/api-clients/:clientId/credentials
Authorization: Bearer <current-credential>

Request body:
{
  "expiresAt": "2027-01-01T00:00:00Z"  // optional ISO 8601
}
```

**Required scope:** `api_client:credential:create`

**Response 201:**
```json
{
  "ok": true,
  "data": {
    "id": "abc123def456",
    "clientId": "your-client-id",
    "credentialPrefix": "nf.live.abc123def456",
    "status": "active",
    "expiresAt": "2027-01-01T00:00:00.000Z",
    "lastUsedAt": null,
    "createdAt": "2025-01-01T00:00:00.000Z",
    "revokedAt": null,
    "rawCredential": "nf.live.abc123def456.SomeBase64UrlSecret___"
  }
}
```

> **Store `rawCredential` immediately and securely — it will not be shown again.**

---

### List credentials

```
GET /v1/api-clients/:clientId/credentials
Authorization: Bearer <credential>
```

**Required scope:** `api_client:credential:read`

Returns all credentials (active, revoked, expired) sorted newest-first.  
`rawCredential` and `credentialHash` are **never** returned here.

---

### Rotate (recommended for key rotation)

```
POST /v1/api-clients/:clientId/credentials/rotate
Authorization: Bearer <current-credential>

Request body:
{
  "revokeOldCredentialId": "old-credential-id",  // optional
  "expiresAt": "2027-06-01T00:00:00Z"             // optional
}
```

**Required scope:** `api_client:credential:rotate`

**Response 201:**
```json
{
  "ok": true,
  "data": {
    "newCredential": {
      "id": "newcredid",
      "rawCredential": "nf.live.newcredid.NewSecret___",
      "..."
    },
    "revokedCredential": {
      "id": "old-credential-id",
      "status": "revoked",
      "revokedAt": "2025-06-07T10:00:00.000Z",
      "..."
    },
    "gracePeriodUnsupported": false
  }
}
```

If `revokeOldCredentialId` is not provided, the old credential remains active
until you explicitly revoke it. This enables a grace-period migration pattern:

1. Call `/rotate` without `revokeOldCredentialId` — get new credential.
2. Deploy and start using the new credential.
3. After confirming traffic is healthy, revoke the old credential.

---

### Revoke a credential

```
POST /v1/api-clients/:clientId/credentials/:credentialId/revoke
Authorization: Bearer <credential>
```

**Required scope:** `api_client:credential:revoke`

Revocation is **immediate and irreversible**. The revoked credential returns 401
on all subsequent requests. Revocation is idempotent — revoking an already-revoked
credential returns 200 with no error.

---

## Access Control

| Caller type | Can manage |
|---|---|
| API client | Only their own `clientId` |
| Legacy token client | Any `clientId` |
| Internal (`sourceApp: internal`) | Any `clientId` |

Normal API clients attempting to manage another client's credentials receive
`403 CREDENTIAL_NOT_OWNED`.

---

## Recommended Rotation Procedure

1. **Create or rotate** to get a new credential: `POST /rotate` (or `POST /credentials`)
2. **Securely store** the `rawCredential` from the response.
3. **Deploy** your new credential to all service instances.
4. **Verify** traffic is healthy with the new credential.
5. **Revoke** the old credential: `POST /credentials/:oldId/revoke`

This procedure ensures zero downtime — both credentials are simultaneously valid
during the deployment window.

---

## Error Codes

| Code | HTTP | Meaning |
|---|---|---|
| `API_CLIENT_NOT_FOUND` | 404 | Target client does not exist |
| `CREDENTIAL_NOT_FOUND` | 404 | Credential ID does not exist |
| `CREDENTIAL_NOT_OWNED` | 403 | Credential belongs to a different client |
| `SCOPE_DENIED` | 403 | Caller lacks the required scope |
| `VALIDATION_ERROR` | 400 | Invalid request body (e.g. expiresAt in the past) |

---

## Audit Trail

All credential lifecycle events are recorded in the audit log:

| Event | Audit action |
|---|---|
| Credential created | `api_client.credential.create` |
| Credentials listed | `api_client.credential.read` |
| Credential rotated | `api_client.credential.rotate` |
| Credential revoked | `api_client.credential.revoke` |

Audit metadata includes `credentialId`, `credentialPrefix`, `status`, and `expiresAt`.
Raw credentials, hashes, and authorization headers are **never** written to audit logs.
