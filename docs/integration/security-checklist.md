# Security Checklist

- Keep Northflow API keys backend-only.
- Keep signing secrets backend-only.
- Do not use public frontend env prefixes for Northflow secrets.
- Require TLS for merchant backend to Northflow traffic.
- Never place provider secrets in a client app.
- Use merchant access grants for every API client.
- Use least-privilege scopes.
- Use idempotency keys for retried mutations.
- Log request IDs and public identifiers, not secrets.
- Handle 401, 403, 429, and 5xx separately.
- Rotate API credentials and signing keys.
- Store raw signing secrets only at copy-once time in backend secret storage.
