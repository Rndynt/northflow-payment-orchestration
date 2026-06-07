# Legacy Payment to Northflow Parity Matrix

Date: 2026-06-06

| Area | Legacy payment expectation | Northflow parity status | Evidence / notes |
| --- | --- | --- | --- |
| RefundPaymentTransaction | Refund succeeded incoming payment/deposit/settlement transactions, reject non-refundable and over-refund cases. | Implemented. | `RefundPaymentTransaction` validates direction/status/type and refundable remaining before creating outgoing refund transactions. |
| Refund idempotency | Same key/same context replays; same key/different context conflicts. | Implemented with repository lookup and transaction unique index reliance. | Response includes `idempotentReplay`; conflicts return `IDEMPOTENCY_CONFLICT`. Race safety relies on `(merchant_id, idempotency_key)` unique index. |
| VoidPaymentTransaction | Cancel pending/requires_action incoming transactions only. | Implemented. | `VoidPaymentTransaction` rejects succeeded/failed/outgoing rows with `TRANSACTION_NOT_VOIDABLE`. |
| Void idempotency | Matching already-cancelled key replays; already-cancelled without matching key rejects. | Implemented. | Route passes `idempotencyKey`; use case persists it on the transaction row and returns `idempotentReplay`. |
| Provider-level cancel/refund contract parity | Providers declare refund/cancel capability through explicit runtime methods. | Implemented. | `PaymentProviderAdapter` exposes optional `refundPayment()` and `cancelPayment()` contracts. |
| Manual provider behavior | Manual/cash can complete offline refund/cancel without network. | Implemented. | `ManualProvider` supports refund/cancel and succeeds offline. |
| FakeGateway | Deterministic dev/test payment, refund, cancel behavior. | Implemented. | `FakeGatewayProvider` supports refund/cancel for tests and smoke flows. |
| Xendit sandbox | Do not fake refund/cancel success unless adapter implements safe methods. | Implemented as unsupported. | Capabilities remain refund/cancel false and use cases return `PROVIDER_REFUND_UNSUPPORTED` / `PROVIDER_CANCEL_UNSUPPORTED` when methods are absent. |
| Legacy PaymentEngineController / payment-engine route parity | API exposes transaction refund and void equivalents. | Implemented for standalone API. | `POST /v1/payment-transactions/:transactionId/refund` and `/void`. Legacy payment deletion/integration not performed in this phase. |
| Reprocess provider events | Support provider event recovery/reprocessing. | Existing parity retained. | `ReprocessProviderEvents` and docs/tests exist; no change in this batch. |
| Recalculate/reconcile intent totals | Support operator crash recovery by recomputing totals from transactions. | Existing parity retained. | `reconcilePaymentIntentTotals` SDK/API coverage remains. |
| Refundability | Expose refundable amount breakdown. | Existing parity retained. | `GET /v1/payment-intents/:intentId/refundability`. |
| SDK method coverage | SDK exposes refund/void methods and request/response types. | Implemented. | `refundPaymentTransaction`, `voidPaymentTransaction`, and four refund/void SDK interfaces added. |
| Docs/OpenAPI coverage | OpenAPI/API/SDK/error/smoke docs include refund/void behavior. | Implemented in folder docs. | Docs include idempotency, response envelopes, error envelopes, and provider fallback policy. |
| Tests coverage | Cover SDK methods, idempotency, manual provider, unsupported provider fallback. | Implemented with targeted tests. | `payment-orchestration-client-sdk.test.ts` and `payment-orchestration-refund-void-parity.test.ts`. |
| Standalone repo sync | Folder contents pushed to standalone repository. | Blocked/not proven. | This batch validates the folder but cannot claim remote sync until standalone push succeeds. |

## Final parity decision

`NOT_READY_STANDALONE_SYNC_BLOCKER`

All critical in-folder blockers are addressed or covered by validation, but standalone repository sync is not proven in this environment.
