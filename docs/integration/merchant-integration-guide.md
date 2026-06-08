# Merchant Integration Guide

## Purpose

This guide explains how a merchant application integrates with Northflow from a backend service. Northflow is the payment orchestration boundary between a merchant backend and provider accounts.

## Integration roles

```txt
Browser/mobile/POS frontend -> merchant backend -> Northflow -> provider
```

- **Merchant frontend**: collects checkout intent and displays payment instructions received from the merchant backend.
- **Merchant backend**: owns Northflow credentials, creates intents, creates payments, polls status, and requests refund/void.
- **Northflow**: stores payment intents/transactions, validates API clients and merchant access grants, calls providers, and receives provider webhooks.
- **Provider**: payment method provider configured through a provider account.

## Runtime architecture

```txt
customer
  |
  v
merchant frontend --no Northflow secrets--> merchant backend
  |                                      |
  |                                      v
  |                         Northflow REST API or SDK
  |                                      |
  v                                      v
payment instructions <----------- payment provider
```

## Backend-only secret rule

Northflow API keys, raw signing secrets, service tokens, provider credentials, database URLs, and webhook secrets must live only in server-side merchant backend secret storage. Never put them in browser, mobile, POS frontend, or public environment variables.

Do not use `NEXT_PUBLIC_`, `VITE_`, `EXPO_PUBLIC_`, or any other frontend/public prefix for Northflow secrets.

## merchantId vs API client vs sourceApp vs externalPayableId

- `merchantId`: Northflow owner boundary for intents, transactions, provider accounts, and methods.
- API client: authenticated caller credential with scopes and merchant access grants.
- `sourceApp`: merchant backend identifier used for request context and source validation.
- `externalPayableId`: merchant backend's local order, invoice, booking, or bill identifier.

## Onboarding objects

1. Merchant record.
2. API client and credential.
3. Merchant access grant from the API client to the merchant.
4. Provider account for the merchant.
5. Enabled provider-account payment methods.
6. Optional signing key for signed requests.

## Admin CLI bootstrap sequence

```txt
create merchant
create API client
create API credential
create merchant access grant
create provider account
enable/sync payment methods
create signing key when signed requests are enabled
copy secrets once into backend secret storage
```

## SDK integration path

Use `@northflow/payment-orchestration-client-sdk` inside the merchant backend. Configure `baseUrl`, `apiKey`, `merchantId`, and `sourceApp`; add signing config only when the service requires or accepts signed requests.

## REST integration path

Call Northflow REST endpoints from the merchant backend with `Authorization: Bearer`, `x-payment-merchant-id`, `x-source-app`, and JSON payloads. Add signed request headers when configured.

## Payment lifecycle

1. Merchant backend creates a local payable.
2. Merchant backend creates a Northflow payment intent.
3. Merchant backend reads payment options.
4. Merchant backend creates a gateway payment transaction.
5. Merchant frontend displays returned QR, payment URL, virtual account, or instructions.
6. Provider webhook updates Northflow.
7. Merchant backend polls Northflow status.
8. Merchant backend marks the local payable paid, failed, expired, or refunded.

## Idempotency

Use deterministic idempotency keys for retried create-payment, refund, and void operations. Reuse the same key for the same logical operation and use a new key for a new logical operation.

## Payment options

Payment methods are not a global catalog. Northflow returns methods enabled on the merchant's provider accounts and filtered by merchant, provider account, currency, amount, and status.

## Status polling

The merchant backend polls Northflow. The merchant frontend polls the merchant backend. Merchant outbound webhook/callback delivery is a future phase and is not part of S10.2.

## Refund/void

Use refund for settled/succeeded payments when supported. Use void/cancel for pending or action-required transactions when supported. Provider support varies; check refundability before refunding.

## Error handling

Handle 401/403 as credential or merchant access errors, 409 as idempotency conflict, 429 as rate limiting, 4xx validation errors as integration bugs, and 5xx as retryable service/provider failures when safe.

## Signed requests

Signed requests use HMAC headers generated from the canonical method, path, query, body hash, timestamp, and nonce. Signed headers can be optional or required depending on Northflow service configuration.

## Production checklist

- Store API keys and signing secrets only in backend secret storage.
- Configure TLS.
- Grant least-privilege scopes and merchant access.
- Use idempotency keys for mutation retries.
- Log request IDs and public identifiers, not secrets.
- Rotate API credentials and signing keys.
- Test provider account methods before launch.

## Common mistakes

- Calling Northflow directly from browser/mobile/POS frontend.
- Hardcoding payment methods instead of rendering Northflow options.
- Creating a new idempotency key for every retry of the same operation.
- Storing provider credentials or raw signing secrets in public env.
- Assuming refund/void is supported by every provider.
