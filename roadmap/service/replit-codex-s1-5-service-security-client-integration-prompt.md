# Claude/Replit Prompt — S1–S5 Service Security & Client Integration

Repository: `northflow-payment-orchestration`

## Context

We are not implementing dashboard or webhook yet. Focus is strictly on service security and client integration isolation. The goal is to ensure that multiple consumer apps can safely call Northflow Payment Orchestration without sharing credentials and with proper merchant isolation.

## Consumer Apps

- AuraPoS: multi-tenant, calls Northflow via REST API
- Transity: multi-tenant, calls Northflow via SDK
- Kioskoin: single merchant, calls Northflow via REST API

## Core Concepts

- **API Client** = backend application using Northflow
- **Merchant** = business entity whose payments are processed
- 1 app = 1 API client credential
- Each client only allowed to access their merchants
- Northflow should enforce client -> merchant access and action scopes
- Authentication must migrate from a single global token to per-client API keys

## Phases

### S0 — Service security baseline freeze
- Define internal identity model
- List of valid `sourceApp`
- Initial scopes
- Mark global token as legacy/dev-only

### S1 — API client registry
- Table `payment_orchestration_api_clients`
- Table `payment_orchestration_api_keys` (hash secrets)
- Table `payment_orchestration_client_merchant_access`
- Acceptance criteria: client creation, key generation once, hashed secrets, client-merchant binding

### S2 — Replace global token with client auth
- Headers: `Authorization: Bearer <apiKey>` or `x-nf-api-key` 
- Middleware maps apiKey -> clientId -> sourceApp -> scopes -> merchant access
- Legacy global token optional in dev only
- Acceptance: invalid/expired/revoked keys -> 401, valid -> req.auth populated

### S3 — Merchant ownership guard
- Every route receiving `merchantId` must check if client has access
- Unauthorized access -> 403 MERCHANT_ACCESS_DENIED
- Protected routes include merchant, provider account, payment intents, gateway payments, transactions refund/void/reconcile

### S4 — SourceApp enforcement
- Caller cannot spoof another app
- `sourceApp` in payload must match `req.auth.sourceApp`
- Mismatch -> 403 SOURCE_APP_MISMATCH
- Accept empty `sourceApp` and autofill from auth

### S5 — Scope-based authorization
- Each client has a list of allowed action scopes
- Route-scope matrix must enforce required scopes
- Unauthorized action -> 403 SCOPE_DENIED
- Acceptance: clients can only do actions allowed by their scopes

## Required Output

- Implementation for S1–S5 only
- Middleware for per-client API key auth and scope enforcement
- Database tables for clients, keys, merchant access
- Routes remain functional, enforcing client-merchant isolation
- Integration support for REST (AuraPoS/Kioskoin) and SDK (Transity)
- Acceptance tests for ownership, sourceApp, and scope enforcement
- Documentation updates for S1–S5
- No dashboard, webhook, HMAC signing, or payment logic changes

Commit and push all changes.