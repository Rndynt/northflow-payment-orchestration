---
name: S10 Operational Bootstrap Admin Runtime Validation
description: Validation report for S10 nf-admin CLI — commands, tests, docs, audit, output contract.
---

# S10 — Operational Bootstrap & Admin Runtime Validation Report

**Status:** ✅ COMPLETE  
**Date:** 2026-06-07  
**Test results:** 41/41 new tests pass · 485/485 full suite pass

---

## What Was Built

### CLI Tool: `nf-admin`

Location: `apps/service/src/cli/nf-admin.ts`  
Script: `pnpm nf:admin` (in `apps/service/package.json`)

### Files Created

| File | Purpose |
|---|---|
| `apps/service/src/cli/nf-admin.ts` | Main CLI entrypoint; command dispatch; exit codes 0/1/2 |
| `apps/service/src/cli/parseArgs.ts` | Minimal arg parser (no external deps); flags, positionals, required/optional getters |
| `apps/service/src/cli/output.ts` | JSON/human output helpers; succeed/fail shapes; one-time secret notice |
| `apps/service/src/cli/adminAudit.ts` | Fire-and-forget audit writer without Express req; sourceApp=admin-cli |
| `apps/service/src/cli/adminContext.ts` | DB context builder; assertAdminToken; OFFICIAL_SCOPES set; validateScopes |
| `apps/service/src/cli/commands/createClient.ts` | create-client command |
| `apps/service/src/cli/commands/listClients.ts` | list-clients command (read-only; uses db.select directly) |
| `apps/service/src/cli/commands/getClient.ts` | get-client command (read-only; includes credentials + signing keys) |
| `apps/service/src/cli/commands/createCredential.ts` | create-credential; rawCredential returned once |
| `apps/service/src/cli/commands/revokeCredential.ts` | revoke-credential; requires --yes |
| `apps/service/src/cli/commands/createSigningKey.ts` | create-signing-key; rawSigningSecret returned once; fails closed if encryption not configured |
| `apps/service/src/cli/commands/revokeSigningKey.ts` | revoke-signing-key; requires --yes |
| `apps/service/src/cli/commands/createMerchant.ts` | create-merchant; idempotent via sourceApp+externalRef |
| `apps/service/src/cli/commands/grantMerchant.ts` | grant-merchant; validates scopes; ADMIN_ALREADY_EXISTS for active grants |
| `apps/service/src/cli/commands/revokeMerchant.ts` | revoke-merchant; requires --yes |
| `apps/service/src/cli/commands/createProviderAccount.ts` | create-provider-account |
| `apps/service/src/cli/commands/listPaymentMethods.ts` | list-payment-methods (read-only) |
| `apps/service/src/cli/commands/enablePaymentMethod.ts` | enable-payment-method; full UpsertProviderAccountMethod use case |
| `apps/service/src/cli/commands/disablePaymentMethod.ts` | disable-payment-method; requires --yes |
| `apps/service/src/cli/commands/bootstrapBundle.ts` | bootstrap-bundle; 4-step: client + credential + merchant + grant |
| `docs/operations/bootstrap-admin-runtime.md` | Full operator runbook |
| `tests/s10-operational-bootstrap-admin-runtime.test.ts` | 41 unit tests (node:test, in-memory repos) |

### Files Modified

| File | Change |
|---|---|
| `apps/service/src/audit/auditActions.ts` | Added 11 S10 `admin.*` audit action constants |
| `apps/service/package.json` | Added `"nf:admin"` script |
| `roadmap/service/main.md` | Added S10 section and updated execution priority |

---

## Commands Implemented (15 total)

| Command | Read-only | --yes required | dry-run | Audit action |
|---|---|---|---|---|
| `create-client` | — | — | ✓ | `admin.api_client.create` |
| `list-clients` | ✓ | — | — | — |
| `get-client` | ✓ | — | — | — |
| `create-credential` | — | — | ✓ | `admin.client_credential.create` |
| `revoke-credential` | — | ✓ | ✓ | `admin.client_credential.revoke` |
| `create-signing-key` | — | — | ✓ | `admin.client_signing_key.create` |
| `revoke-signing-key` | — | ✓ | ✓ | `admin.client_signing_key.revoke` |
| `create-merchant` | — | — | ✓ | `admin.merchant.create` |
| `grant-merchant` | — | — | ✓ | `admin.merchant.grant` |
| `revoke-merchant` | — | ✓ | ✓ | `admin.merchant.revoke` |
| `create-provider-account` | — | — | ✓ | `admin.provider_account.create` |
| `list-payment-methods` | ✓ | — | — | — |
| `enable-payment-method` | — | — | ✓ | `admin.payment_method.enable` |
| `disable-payment-method` | — | ✓ | ✓ | `admin.payment_method.disable` |
| `bootstrap-bundle` | — | — | ✓ | Multiple (one per step) |

---

## Output Contract

### Success
```json
{ "ok": true, "operation": "<cmd>", "result": { ... } }
```

### Failure
```json
{ "ok": false, "operation": "<cmd>", "error": { "code": "ADMIN_*", "message": "...", "details": null } }
```

### Error codes
`ADMIN_INVALID_ARGUMENT`, `ADMIN_CONFIG_MISSING`, `ADMIN_NOT_FOUND`, `ADMIN_ALREADY_EXISTS`,
`ADMIN_SCOPE_INVALID`, `ADMIN_CONFIRMATION_REQUIRED`, `ADMIN_OPERATION_FAILED`, `ADMIN_DRY_RUN`

---

## Security Invariants Verified

- rawCredential and rawSigningSecret returned exactly once (not in audit metadata, not in DB)
- secretCiphertext and credentialHash never returned in CLI output
- ADMIN_CONFIG_MISSING returned (not thrown) when encryption secret absent
- Token check fails closed if PAYMENT_ORCHESTRATION_ADMIN_BOOTSTRAP_TOKEN is set but process env is missing
- OFFICIAL_SCOPES set used for validation (24 named scopes + `*`)
- Audit entries: sourceApp=admin-cli, actorType=internal, no secret material in metadata
- writeAdminAuditLog is fire-and-forget — audit failure never rolls back the operation

---

## Test Coverage (41 tests)

U01–U08: parseArgs, validateScopes  
U09: output contract shapes  
U10–U13: create-client (success, bad scopes, dry-run, already-exists)  
U14–U17: create-credential (rawCredential, hash safety, dry-run, not-found)  
U18–U20: revoke-credential (confirmation, revoke, dry-run)  
U21–U22: create-merchant (success, idempotent)  
U23–U24: grant-merchant (success, already-exists)  
U25–U26: revoke-merchant (confirmation, revoke)  
U27–U28: create-provider-account (success, not-found)  
U29: list-payment-methods  
U30–U32: enable/disable-payment-method  
U33–U35: bootstrap-bundle (success, dry-run, already-exists)  
U36: create-signing-key config-missing guard  
U37: revoke-signing-key  
U38–U38b: audit log writing and fire-and-forget  
U39: list-clients  
U40: get-client (with credentials, no hash)
