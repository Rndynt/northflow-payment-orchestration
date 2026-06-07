# Bootstrap & Admin Runtime (S10)

The `nf-admin` CLI allows operators to bootstrap and manage the payment orchestration service directly from the server environment — without a running HTTP server or dashboard.

## Prerequisites

| Requirement | Notes |
|---|---|
| `PAYMENT_ORCHESTRATION_DATABASE_URL` or `DATABASE_URL` | PostgreSQL connection string |
| Database migrated | Run `pnpm db:migrate` in `apps/service/` |
| `PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_SECRET` | Required for signing key operations only |

## Running the CLI

From the monorepo root:

```bash
pnpm --filter @northflow/payment-orchestration-service nf:admin <command> [flags]
```

Or from `apps/service/`:

```bash
pnpm nf:admin <command> [flags]
```

## Security Model

### Bootstrap Token

Set `PAYMENT_ORCHESTRATION_ADMIN_BOOTSTRAP_TOKEN` to harden direct server access. State-changing commands verify this token is present in the process environment.

```bash
export PAYMENT_ORCHESTRATION_ADMIN_BOOTSTRAP_TOKEN="<random-secure-token>"
```

If not set, the CLI trusts that having shell access to the server environment is sufficient authorization.

### One-time Secrets

- `rawCredential` — returned once from `create-credential` and the `credential` step of `bootstrap-bundle`. Never shown again.
- `rawSigningSecret` — returned once from `create-signing-key`. Never shown again.

Save these values immediately after creation.

### Audit Trail

All state-changing operations write to the audit log (`admin.*` action names) so they are visible in the dashboard audit log viewer and queryable via `/v1/audit-logs`.

---

## Commands

### `create-client`

Create a new API client.

```bash
nf-admin create-client \
  --name "My Service" \
  --source-app my-service \
  --environment sandbox \
  [--client-id custom_id] \
  [--scopes merchant:read,intent:create] \
  [--metadata '{"team":"platform"}'] \
  [--dry-run] [--json]
```

**Flags:**

| Flag | Required | Description |
|---|---|---|
| `--name` | ✓ | Display name for the API client |
| `--source-app` | ✓ | Application identifier (e.g. `checkout-service`) |
| `--environment` | ✓ | `sandbox`, `test`, or `production` |
| `--client-id` | — | Custom ID (auto-generated if omitted) |
| `--scopes` | — | Comma-separated authorization scopes |
| `--metadata` | — | JSON object with arbitrary metadata |

---

### `list-clients`

List all API clients (read-only, no token required).

```bash
nf-admin list-clients [--json]
```

---

### `get-client`

Get a single API client with its credentials and signing keys (read-only).

```bash
nf-admin get-client --client-id <clientId> [--json]
```

---

### `create-credential`

Create a bearer credential for an API client.

```bash
nf-admin create-credential \
  --client-id <clientId> \
  [--expires-at 2026-12-31T00:00:00Z] \
  [--json]
```

**Output includes `rawCredential` — save it immediately, it will not be shown again.**

---

### `revoke-credential`

Revoke a bearer credential (irreversible).

```bash
nf-admin revoke-credential \
  --client-id <clientId> \
  --credential-id <credentialId> \
  --yes [--dry-run] [--json]
```

---

### `create-signing-key`

Create an HMAC signing key for an API client.

Requires `PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_SECRET` to be configured.

```bash
nf-admin create-signing-key \
  --client-id <clientId> \
  [--expires-at 2026-12-31T00:00:00Z] \
  [--json]
```

**Output includes `rawSigningSecret` — save it immediately, it will not be shown again.**

---

### `revoke-signing-key`

Revoke an HMAC signing key (irreversible).

```bash
nf-admin revoke-signing-key \
  --client-id <clientId> \
  --signing-key-id <signingKeyId> \
  --yes [--dry-run] [--json]
```

---

### `create-merchant`

Create a merchant. Idempotent if `--source-app` + `--external-ref` match an existing merchant.

```bash
nf-admin create-merchant \
  --name "Acme Corp" \
  [--merchant-id custom_merchant_id] \
  [--legal-name "Acme Corporation Ltd"] \
  [--source-app my-service] \
  [--external-ref ext_ref_123] \
  [--metadata '{}'] \
  [--json]
```

---

### `grant-merchant`

Grant an API client access to a merchant.

```bash
nf-admin grant-merchant \
  --client-id <clientId> \
  --merchant-id <merchantId> \
  [--scopes merchant:read,intent:create,payment:create] \
  [--json]
```

Default scopes (if omitted): `merchant:read`.

---

### `revoke-merchant`

Revoke an API client's access to a merchant (irreversible).

```bash
nf-admin revoke-merchant \
  --client-id <clientId> \
  --merchant-id <merchantId> \
  --yes [--dry-run] [--json]
```

---

### `create-provider-account`

Create a provider account for a merchant.

```bash
nf-admin create-provider-account \
  --merchant-id <merchantId> \
  --provider fake_gateway \
  --environment sandbox \
  [--provider-account-id custom_pa_id] \
  [--provider-account-ref ext_account_ref] \
  [--credentials-ref XENDIT_SECRET_KEY_ENV_VAR] \
  [--public-config '{"mode":"sandbox"}'] \
  [--json]
```

**Note:** `--credentials-ref` must be an environment variable *name* (e.g. `XENDIT_SECRET_KEY`), not the raw secret value.

---

### `list-payment-methods`

List payment methods for a provider account (read-only).

```bash
nf-admin list-payment-methods \
  --merchant-id <merchantId> \
  --provider-account-id <paId> \
  [--json]
```

---

### `enable-payment-method`

Enable or update a payment method on a provider account.

```bash
nf-admin enable-payment-method \
  --merchant-id <merchantId> \
  --provider-account-id <paId> \
  --method CARD \
  [--method-type card] \
  [--display-name "Visa / Mastercard"] \
  [--currency IDR] \
  [--min-amount 10000] \
  [--max-amount 50000000] \
  [--provider-method-code CREDIT_CARD] \
  [--yes] [--json]
```

**Method types:** `card`, `bank_transfer`, `ewallet`, `qr_code`, `other`

---

### `disable-payment-method`

Disable a payment method on a provider account.

```bash
nf-admin disable-payment-method \
  --merchant-id <merchantId> \
  --provider-account-id <paId> \
  --method CARD \
  --yes [--dry-run] [--json]
```

---

### `bootstrap-bundle`

Full system bootstrap in one command: creates API client, credential, merchant, and merchant access grant.

```bash
nf-admin bootstrap-bundle \
  --name "Checkout Service" \
  --source-app checkout \
  --environment sandbox \
  --merchant-name "Acme Corp" \
  [--client-id custom_client_id] \
  [--merchant-id custom_merchant_id] \
  [--scopes merchant:read,intent:create] \
  [--grant-scopes merchant:read,intent:create,payment:create] \
  --yes [--dry-run] [--json]
```

Steps performed:
1. Create API client
2. Create bearer credential (rawCredential returned once)
3. Create merchant (idempotent if source-app + merchant-id match existing)
4. Grant client access to merchant

On failure at any step, the partial result is returned with `ok: false`. Already-created resources must be cleaned up manually or re-run (idempotent steps will safely skip).

---

## Global Flags

| Flag | Description |
|---|---|
| `--json` | Machine-readable JSON output |
| `--dry-run` | Validate and preview — nothing written to the database |
| `--yes` | Confirm irreversible operations |
| `--help`, `-h` | Show help text |

---

## Output Contract

**Success:**
```json
{
  "ok": true,
  "operation": "create-client",
  "result": { ... }
}
```

**Failure:**
```json
{
  "ok": false,
  "operation": "create-client",
  "error": {
    "code": "ADMIN_ALREADY_EXISTS",
    "message": "API client already exists: client_abc",
    "details": null
  }
}
```

**Dry-run:**
```json
{
  "ok": true,
  "operation": "create-client",
  "dryRun": true,
  "preview": "..."
}
```

### Error codes

| Code | Meaning |
|---|---|
| `ADMIN_INVALID_ARGUMENT` | Missing or invalid flag value |
| `ADMIN_CONFIG_MISSING` | Required environment variable not set |
| `ADMIN_NOT_FOUND` | Referenced resource does not exist |
| `ADMIN_ALREADY_EXISTS` | Resource already exists (use dry-run to inspect) |
| `ADMIN_SCOPE_INVALID` | Unknown scope name |
| `ADMIN_CONFIRMATION_REQUIRED` | Irreversible operation requires `--yes` |
| `ADMIN_OPERATION_FAILED` | Unexpected error from the database or use-case |
| `ADMIN_DRY_RUN` | Dry-run preview (informational) |

---

## Exit Codes

| Code | Meaning |
|---|---|
| `0` | Success |
| `1` | Operation failed (see error output) |
| `2` | Misconfiguration (missing required env vars) |

---

## Typical Bootstrap Sequence

```bash
# 1. Full bootstrap (client + credential + merchant + grant)
nf-admin bootstrap-bundle \
  --name "Checkout Service" \
  --source-app checkout \
  --environment sandbox \
  --merchant-name "Acme Corp" \
  --grant-scopes "merchant:read,intent:create,payment:create,payment:read" \
  --json

# 2. Add a provider account
nf-admin create-provider-account \
  --merchant-id <merchantId> \
  --provider fake_gateway \
  --environment sandbox \
  --json

# 3. Enable payment methods
nf-admin enable-payment-method \
  --merchant-id <merchantId> \
  --provider-account-id <paId> \
  --method CARD \
  --method-type card \
  --currency IDR \
  --json

# 4. Create a signing key for HMAC auth
nf-admin create-signing-key \
  --client-id <clientId> \
  --json
```

## Audit Log Actions

All state-changing operations write audit entries with the following action names:

| Action | Operation |
|---|---|
| `admin.api_client.create` | `create-client` |
| `admin.client_credential.create` | `create-credential` |
| `admin.client_credential.revoke` | `revoke-credential` |
| `admin.client_signing_key.create` | `create-signing-key` |
| `admin.client_signing_key.revoke` | `revoke-signing-key` |
| `admin.merchant.create` | `create-merchant` |
| `admin.merchant.grant` | `grant-merchant` |
| `admin.merchant.revoke` | `revoke-merchant` |
| `admin.provider_account.create` | `create-provider-account` |
| `admin.payment_method.enable` | `enable-payment-method` |
| `admin.payment_method.disable` | `disable-payment-method` |

All admin audit entries have `sourceApp: "admin-cli"` and `actorType: "internal"`.
