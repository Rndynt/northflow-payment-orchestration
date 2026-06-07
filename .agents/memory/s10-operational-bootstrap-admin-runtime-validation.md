# S10 Operational Bootstrap Admin Runtime Validation

Status: complete after scope cleanup.

Initial implementation reported:

- 41/41 S10 tests pass
- 485/485 full suite pass

Implemented service-side CLI:

- apps/service/src/cli/nf-admin.ts
- apps/service/src/cli/adminContext.ts
- apps/service/src/cli/adminAudit.ts
- apps/service/src/cli/output.ts
- apps/service/src/cli/parseArgs.ts
- apps/service/src/cli/commands/*

Implemented commands:

- create-client
- list-clients
- get-client
- create-credential
- revoke-credential
- create-signing-key
- revoke-signing-key
- create-merchant
- grant-merchant
- revoke-merchant
- create-provider-account
- list-payment-methods
- enable-payment-method
- disable-payment-method
- bootstrap-bundle

Docs:

- docs/operations/bootstrap-admin-runtime.md

Tests:

- tests/s10-operational-bootstrap-admin-runtime.test.ts

Scope cleanup performed after review:

- Reverted S10 changes under apps/dashboard because dashboard work is out of S10 scope.
- Kept S10 focused on apps/service operational bootstrap runtime.
- Clarified the admin CLI access model as local trusted runtime only.
- Removed unused create-credential scope parsing. Scopes remain on API clients and client-to-merchant grants, not individual credentials.
- Updated docs/operations/bootstrap-admin-runtime.md to match the final S10 scope.

Security notes:

- rawCredential and rawSigningSecret are one-time outputs only.
- credentialHash, protected signing material, provider secrets, database URLs, and raw environment values must not be printed or stored in audit metadata.
- admin CLI is not an HTTP admin API.
- dashboard authentication, RBAC, and dashboard proxy design must be handled in a separate future dashboard phase.

Migration result:

- No new migration was required for S10.

Remaining issue:

- Re-run the full test suite after the cleanup patch if a runtime environment is available.
