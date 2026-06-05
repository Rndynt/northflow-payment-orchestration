# Phase 8F — Refund, Void, and Manual Provider Parity Report

**Date:** 2026-06-05  
**Status:** COMPLETE  
**Scope:** Legacy AuraPoS payment capability parity migration into `northflow-payment-orchestration/`

---

## Objective

Migrate all legacy AuraPoS payment capabilities into the standalone `northflow-payment-orchestration/` folder, achieving feature parity for:

1. **RefundPaymentTransaction** — full and partial refunds for succeeded payments
2. **VoidPaymentTransaction** — cancellation of pending/requires_action payments
3. **StandaloneManualProvider** — cash/offline payment provider (equivalent of legacy `ManualProvider`)
4. **Provider cancel/refund contract** — `cancelPayment?` and `refundPayment?` optional methods on `StandalonePaymentProvider`

---

## Parity Matrix

| Legacy Component | Northflow Equivalent | Status |
|-----------------|----------------------|--------|
| `RefundPaymentTransaction` (packages/application/payments) | `apps/service/src/application/use-cases/RefundPaymentTransaction.ts` | ✅ IMPLEMENTED |
| `VoidPaymentTransaction` (packages/application/payments) | `apps/service/src/application/use-cases/VoidPaymentTransaction.ts` | ✅ IMPLEMENTED |
| `ManualProvider` (packages/infrastructure/payments) | `apps/service/src/infrastructure/providers/StandaloneManualProvider.ts` | ✅ IMPLEMENTED |
| `provider.cancelPayment()` contract | `StandalonePaymentProvider.cancelPayment?()` | ✅ IMPLEMENTED |
| `provider.refundPayment()` contract | `StandalonePaymentProvider.refundPayment?()` | ✅ IMPLEMENTED |
| `ProviderCapabilities.supportsRefund/Cancel` | `PaymentProviderCapabilities.supportsRefund/Cancel` | ✅ ALREADY EXISTED |
| `FakeGatewayProvider.cancelPayment()` | `StandaloneFakeGatewayProvider.cancelPayment()` | ✅ IMPLEMENTED |
| `FakeGatewayProvider.refundPayment()` | `StandaloneFakeGatewayProvider.refundPayment()` | ✅ IMPLEMENTED |
| PaymentEngine routes: POST `/refund`, POST `/void` | `POST /v1/payment-transactions/:id/refund`, `POST /v1/payment-transactions/:id/void` | ✅ IMPLEMENTED |

---

## Files Created / Modified

### New Files

| File | Purpose |
|------|---------|
| `apps/service/src/application/use-cases/RefundPaymentTransaction.ts` | Refund use case |
| `apps/service/src/application/use-cases/VoidPaymentTransaction.ts` | Void/cancel use case |
| `apps/service/src/infrastructure/providers/StandaloneManualProvider.ts` | Manual/cash payment provider |
| `migrations/0002_refund_void_manual_parity.sql` | DB migration (composite index for refund queries) |
| `tests/payment-orchestration-refund-void-parity.test.ts` | Parity test suite |
| `docs/reports/phase-8f-refund-void-manual-parity-report.md` | This report |

### Modified Files

| File | Change |
|------|--------|
| `apps/service/src/infrastructure/providers/StandalonePaymentProvider.ts` | Added `StandaloneProviderCancelInput/Result`, `StandaloneProviderRefundInput/Result` types; added `cancelPayment?` and `refundPayment?` to interface |
| `apps/service/src/infrastructure/providers/StandaloneFakeGatewayProvider.ts` | Added `cancelPayment()` and `refundPayment()` methods; updated capabilities to `supportsRefund: true, supportsCancel: true, supportsPartialRefund: true` |
| `apps/service/src/infrastructure/providers/providerRegistry.ts` | Registered `StandaloneManualProvider` in all environments |
| `apps/service/src/application/errors.ts` | Added 7 new error codes: `TRANSACTION_NOT_REFUNDABLE`, `REFUND_EXCEEDS_REFUNDABLE`, `PROVIDER_REFUND_UNSUPPORTED`, `PROVIDER_REFUND_FAILED`, `TRANSACTION_NOT_VOIDABLE`, `PROVIDER_CANCEL_UNSUPPORTED`, `PROVIDER_CANCEL_FAILED` |
| `apps/service/src/container.ts` | Wired `RefundPaymentTransaction` and `VoidPaymentTransaction` use cases |
| `apps/service/src/routes/transactions.ts` | Added `POST /:id/refund` and `POST /:id/void` endpoints |
| `docs/payment-orchestration-error-codes.md` | Added Refund Errors and Void/Cancel Errors sections |
| `docs/openapi/payment-orchestration.openapi.json` | Added refund and void path entries |

---

## Design Decisions

### 1. No-provider fallback for refunds (manual/offline)
When a provider is not registered or does not implement `refundPayment?()`, `RefundPaymentTransaction` records the refund as succeeded immediately. This mirrors the legacy AuraPoS behavior for cash/manual payments, where refunds are offline events.

### 2. Provider interface: optional methods (not throw-on-call)
`cancelPayment?` and `refundPayment?` are optional on `StandalonePaymentProvider`. The use cases check for method presence before calling. This avoids a pattern where a provider has the method but always throws a "unsupported" error — instead, absence of the method is the signal.

### 3. Schema: no new columns required
The existing `payment_orchestration_transactions` table already had all required columns: `parent_transaction_id`, `direction`, `transaction_type`, `status`, `idempotency_key`, `failure_reason`. Migration `0002` only adds a composite index for `(parent_transaction_id, transaction_type, status)` to accelerate `sumSucceededRefundsByParent` queries.

### 4. StandaloneManualProvider registered in all environments
Unlike `StandaloneFakeGatewayProvider` (dev/test only), `StandaloneManualProvider` is registered in all environments including production. Cash/offline payments are valid in production.

### 5. Intent totals on refund
On successful refund, `intent.amountRefunded += amount`. `amountPaid` and `amountRemaining` are not changed — they reflect the original payment state. This matches the `ReconcilePaymentIntentTotals` logic which independently computes `amountRefunded` from outgoing succeeded transactions.

### 6. Intent totals on void
On void, intent totals are NOT changed. The voided transaction was never `succeeded`, so it never contributed to `amountPaid`. Voiding has no financial impact on the intent.

---

## Error Code Summary

| Code | HTTP | Trigger |
|------|------|---------|
| `TRANSACTION_NOT_REFUNDABLE` | 422 | Source tx not `direction=incoming + status=succeeded + type in [payment,deposit,settlement]` |
| `REFUND_EXCEEDS_REFUNDABLE` | 422 | `amount > (sourceTx.amount - sumSucceededRefundsByParent)` |
| `PROVIDER_REFUND_UNSUPPORTED` | 422 | Reserved for explicit provider refusal (not currently triggered by any provider) |
| `PROVIDER_REFUND_FAILED` | 502 | Provider returned `status=failed` from `refundPayment()` |
| `TRANSACTION_NOT_VOIDABLE` | 422 | Tx not `direction=incoming + status in [pending, requires_action]` |
| `PROVIDER_CANCEL_UNSUPPORTED` | 422 | Reserved for explicit provider refusal (not currently triggered) |
| `PROVIDER_CANCEL_FAILED` | 502 | Provider returned `status=failed` from `cancelPayment()` |

---

## Test Coverage

`tests/payment-orchestration-refund-void-parity.test.ts` covers:

- `StandaloneManualProvider`: createPayment → succeeded, cancelPayment → cancelled, refundPayment → succeeded
- `StandaloneFakeGatewayProvider` Phase 8F: capabilities updated, cancelPayment → cancelled, refundPayment → succeeded
- `RefundPaymentTransaction`: full refund via provider, partial refund, manual provider, no-provider fallback, multiple partial refunds, REFUND_EXCEEDS_REFUNDABLE, TRANSACTION_NOT_REFUNDABLE, zero-amount VALIDATION_ERROR, TRANSACTION_NOT_FOUND
- `VoidPaymentTransaction`: requires_action void via provider, pending void, no-provider fallback, manual provider, TRANSACTION_NOT_VOIDABLE (succeeded), TRANSACTION_NOT_VOIDABLE (failed), TRANSACTION_NOT_VOIDABLE (outgoing), TRANSACTION_NOT_FOUND

---

## AuraPoS Legacy Code Status

**NOT DELETED.** Per task specification, the legacy AuraPoS embedded payment code remains intact:
- `packages/application/payments/RefundPaymentTransaction.ts` — unchanged
- `packages/application/payments/VoidPaymentTransaction.ts` — unchanged
- `packages/domain/payments/` — unchanged
- `packages/infrastructure/payments/providers/` — unchanged

The legacy code continues to serve the AuraPoS embedded POS terminal. The northflow standalone service is an independent implementation that does NOT import from AuraPoS packages.

---

## Extraction Check Readiness

The extraction check (`scripts/extraction-check.ts`) verifies boundary purity. The new files added in Phase 8F:
- Import only from `@northflow/payment-orchestration-core` (no `@pos/*` imports) ✅
- Import from `../infrastructure/providers/` (service-local, not monorepo packages) ✅
- No `shared/schema` references ✅
- No forbidden AuraPoS import patterns ✅
