# Replit/Codex Prompt - Phase S7.5 Payment Method Options

You are working in the `northflow-payment-orchestration` repository.

S1-S5 service security is complete. S6-S7 client integration and smoke tests are complete.

This phase adds Payment Method Options so consumer apps can ask Northflow which payment methods are available for a merchant/payment intent before creating a gateway payment.

Do not implement dashboard UI.
Do not implement provider webhook roadmap work.
Do not weaken S1-S7 auth, merchant access, sourceApp, scope, idempotency, SDK, or smoke-test guarantees.

---

# Core Concept

Payment methods originate from payment providers, but Northflow must keep an internal merchant/provider-account method registry.

Northflow does not invent provider methods. Northflow normalizes and controls which provider methods are enabled for each merchant provider account.

The table in this phase is not a global provider catalog. It is a merchant/provider-account configuration table.

```txt
provider capability = what the provider/adapter can support in general
provider account method = what this merchant/provider account is allowed to use
payment option = what is valid for this specific payment intent amount/currency/status
```

Example:

```txt
Provider supports: qris, va_bca, va_mandiri, ewallet_ovo, card
Merchant provider account enables: qris, va_bca, va_mandiri
Intent amount/currency options: qris, va_bca, va_mandiri after min/max/currency validation
```

---

# How Methods Enter `po_provider_account_methods`

Implement a layered strategy.

## Layer 1 - Provider Adapter Capability Catalog

Each provider adapter must expose a capability method or equivalent metadata.

Required adapter contract concept:

```ts
getPaymentMethodCapabilities(): ProviderPaymentMethodCapability[]
```

Each capability should include:

```txt
provider
method
methodType
displayName
supportedCurrencies
minAmount optional
maxAmount optional
requiresProviderAccountConfig optional
providerSpecificCode optional
metadata optional
```

This can be static inside the adapter when provider APIs do not expose a reliable list endpoint.

For example, the fake gateway adapter can return static test capabilities:

```txt
qris
va_bca
va_mandiri
```

Do not call real external provider APIs in tests.

## Layer 2 - Provider Sync If Available

If a real provider supports an API to list enabled payment channels/methods for a merchant account, create a provider adapter hook for it.

Suggested optional adapter contract:

```ts
syncProviderAccountMethods(providerAccount): Promise<ProviderPaymentMethodCapability[]>
```

Rules:

- Sync must be provider-adapter-specific.
- Sync must not expose provider credentials.
- Sync must store normalized canonical method names in Northflow.
- Sync must preserve provider-specific metadata in safe `providerMetadata` if needed.
- If provider does not support sync, fallback to static adapter capabilities plus manual enablement.
- Sync should be idempotent.

## Layer 3 - Manual Enable/Disable Per Provider Account

Northflow must allow methods to be enabled/disabled per provider account.

This is the source of truth for consumer apps.

Examples:

```txt
pa_xendit_cafe_mawar -> qris active
pa_xendit_cafe_mawar -> va_bca active
pa_xendit_cafe_mawar -> card disabled
```

Consumer apps must not hard-code method availability. They must ask Northflow for options.

---

# Data Model

Add a new table using Drizzle migration.

Migration name:

```txt
0007_po_provider_account_methods.sql
```

Table name:

```txt
po_provider_account_methods
```

Fields:

```txt
id text primary key
merchant_id text not null references po_merchants(id)
provider_account_id text not null references po_provider_accounts(id)
provider text not null
method text not null
method_type text not null
provider_method_code text nullable
display_name text not null
status text not null default 'active'
currency text not null default 'IDR'
min_amount integer nullable
max_amount integer nullable
sort_order integer not null default 0
public_config jsonb not null default '{}'
provider_metadata jsonb not null default '{}'
metadata jsonb not null default '{}'
created_at timestamp not null default now
updated_at timestamp not null default now
```

Recommended method status values:

```txt
active
disabled
unsupported
```

Recommended method type values:

```txt
qris
virtual_account
ewallet
card
retail_outlet
manual
other
```

Canonical method examples:

```txt
qris
va_bca
va_mandiri
ewallet_ovo
ewallet_dana
card
```

Indexes:

```txt
provider_account_id index
merchant_id index
provider + method index
status index
unique provider_account_id + method
```

Rules:

- Define the table completely in the migration where it is introduced.
- Foreign keys must be inline in `CREATE TABLE` if the existing migration style allows it.
- Do not edit old migrations.
- Add a new Drizzle migration only.
- Keep journal/snapshot consistent.

---

# Core Domain and Repository

Add core types and repository contracts for provider account methods.

Suggested domain type:

```ts
export type ProviderAccountPaymentMethodStatus = 'active' | 'disabled' | 'unsupported';
export type ProviderAccountPaymentMethodType = 'qris' | 'virtual_account' | 'ewallet' | 'card' | 'retail_outlet' | 'manual' | 'other';
```

Suggested repository operations:

```ts
findById(id: string): Promise<ProviderAccountPaymentMethod | null>
listByMerchant(merchantId: string): Promise<ProviderAccountPaymentMethod[]>
listByProviderAccount(providerAccountId: string): Promise<ProviderAccountPaymentMethod[]>
findByProviderAccountAndMethod(providerAccountId: string, method: string): Promise<ProviderAccountPaymentMethod | null>
upsert(input): Promise<ProviderAccountPaymentMethod>
updateStatus(id, status): Promise<ProviderAccountPaymentMethod>
```

Implement Drizzle repository under service infrastructure.

Wire it into the service container.

---

# Provider Adapter Contract

Update provider adapter interfaces carefully.

Required:

```ts
getPaymentMethodCapabilities?(): ProviderPaymentMethodCapability[]
```

Optional:

```ts
syncProviderAccountMethods?(providerAccount): Promise<ProviderPaymentMethodCapability[]>
```

Rules:

- Existing providers must still compile.
- Fake gateway must implement static capabilities for tests.
- Real providers can initially return static capability metadata until real sync is implemented.
- Do not put provider secrets in capability results.

---

# API Endpoints

Add endpoints for reading and resolving payment methods/options.

## List merchant payment methods

```txt
GET /v1/merchants/:merchantId/payment-methods
```

Response must include active methods for all active provider accounts owned by that merchant and accessible by the authenticated client.

Required guards:

```txt
client auth
merchant access
sourceApp where applicable
scope: provider_account:read or payment_method:read
```

## List provider account methods

```txt
GET /v1/merchants/:merchantId/provider-accounts/:providerAccountId/methods
```

Required guards:

```txt
client auth
merchant access
provider account belongs to merchant
scope: provider_account:read or payment_method:read
```

## Upsert provider account method

```txt
PUT /v1/merchants/:merchantId/provider-accounts/:providerAccountId/methods/:method
```

Use this for internal/service configuration. It can be used later by dashboard/admin UI.

Required guards:

```txt
client auth
merchant access
provider account belongs to merchant
scope: provider_account:create or payment_method:write
```

## Sync provider account methods

```txt
POST /v1/merchants/:merchantId/provider-accounts/:providerAccountId/methods/sync
```

Behavior:

- call adapter static capabilities and optional provider sync hook
- upsert normalized methods into `po_provider_account_methods`
- do not delete existing manual rows automatically
- mark unavailable methods as `unsupported` only if sync source is authoritative
- return synced methods

Required guards:

```txt
client auth
merchant access
provider account belongs to merchant
scope: provider_account:create or payment_method:sync
```

## Payment intent options

```txt
GET /v1/payment-intents/:intentId/payment-options?merchantId=<merchantId>
```

Behavior:

- load intent
- enforce merchant access
- ensure intent belongs to merchant
- list active provider account methods for the merchant
- filter by intent currency
- filter by amount remaining or amount due against min/max
- exclude disabled/unsupported methods
- return display-ready options

Required guards:

```txt
client auth
merchant access
scope: intent:read or payment_method:read
```

---

# Gateway Payment Validation

Update `POST /v1/payment-intents/:intentId/gateway-payments` validation.

Before calling provider:

```txt
provider account must belong to merchant
method must exist in po_provider_account_methods for provider account
method status must be active
currency must be supported
amount must satisfy min/max when configured
```

If invalid, return clear errors:

```txt
PAYMENT_METHOD_NOT_AVAILABLE
PAYMENT_METHOD_DISABLED
PAYMENT_METHOD_AMOUNT_OUT_OF_RANGE
PAYMENT_METHOD_CURRENCY_UNSUPPORTED
```

Do not rely only on the provider to reject invalid methods.

---

# Scope Model

Add or reuse scopes carefully.

Preferred new scopes:

```txt
payment_method:read
payment_method:write
payment_method:sync
```

Update docs/tests/fixtures as needed.

If avoiding new scopes for now, document fallback mapping:

```txt
read -> provider_account:read
write/sync -> provider_account:create
payment-options -> intent:read
```

Choose one approach and apply consistently.

---

# SDK Updates

Update `packages/client-sdk` with methods for:

```ts
listMerchantPaymentMethods(merchantId)
listProviderAccountMethods(merchantId, providerAccountId)
upsertProviderAccountMethod(merchantId, providerAccountId, method, input)
syncProviderAccountMethods(merchantId, providerAccountId)
getPaymentIntentPaymentOptions(intentId, options)
```

SDK must preserve auth behavior from S6:

```txt
apiKey -> Authorization: Bearer
legacy serviceToken only as deprecated fallback
```

SDK errors must preserve service error codes.

---

# Documentation

Create or update docs under:

```txt
docs/integration/payment-method-options.md
```

The doc must explain:

```txt
why methods come from providers
why Northflow stores provider-account enabled methods
how adapter capability catalog works
how provider sync works when available
how manual enable/disable works
how consumer apps get options
how gateway payment validates selected method
how consumer backends should use payment options
```

Update existing integration docs to mention the new flow:

```txt
create intent
get payment options
user/app selects option
create gateway payment with selected providerAccountId + method
```

---

# Tests

Add tests for:

## Repository/schema

```txt
create/upsert provider account method
unique providerAccountId + method
list active methods
status disabled/unsupported filtering
```

## Payment options endpoint

```txt
returns active methods for merchant intent
filters disabled methods
filters unsupported methods
filters by currency
filters by min/max amount
cross-client access returns MERCHANT_ACCESS_DENIED
missing scope returns SCOPE_DENIED
```

## Gateway payment validation

```txt
unknown method returns PAYMENT_METHOD_NOT_AVAILABLE
disabled method returns PAYMENT_METHOD_DISABLED
amount outside min/max returns PAYMENT_METHOD_AMOUNT_OUT_OF_RANGE
unsupported currency returns PAYMENT_METHOD_CURRENCY_UNSUPPORTED
valid method succeeds
```

## Sync behavior

```txt
fake gateway static capabilities sync into po_provider_account_methods
sync is idempotent
manual disabled rows are not silently re-enabled unless explicitly requested
```

## SDK

```txt
SDK calls payment options endpoint
SDK sends Authorization: Bearer apiKey
SDK preserves payment method errors
```

---

# Migration Requirements

Add one new Drizzle migration after current chain:

```txt
0007_po_provider_account_methods.sql
```

Rules:

- Do not edit existing migrations 0000-0006.
- No one giant migration dump.
- Define the new table completely in this migration.
- Keep Drizzle journal and snapshot consistent.
- `pnpm db:generate` should show no unexpected drift after migration is committed.

---

# Validation

Run:

```bash
pnpm type-check
pnpm test
pnpm db:generate
pnpm db:migrate
```

If dashboard type-check still has pre-existing issues, document them and ensure service + SDK checks are clean.

Create validation report:

```txt
.agents/memory/s7-5-payment-method-options-validation.md
```

Report must include:

```txt
files changed
migration result
commands run
pass/fail/skipped results
known pre-existing failures
remaining issues
```

---

# Expected Final State

After S7.5:

```txt
Northflow stores enabled payment methods per merchant provider account.
Provider adapters expose method capabilities.
Provider method sync exists and works for fake gateway.
Consumer apps can request payment options for a payment intent.
Gateway payment creation validates selected method before provider call.
Consumer integration docs include get-options-before-pay flow.
SDK supports payment method/options APIs.
Tests prove filtering, security, method validation, and SDK behavior.
```

Commit and push all changes.
