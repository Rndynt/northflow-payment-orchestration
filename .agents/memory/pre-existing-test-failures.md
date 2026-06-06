---
name: Pre-existing test failures
description: AC10 and FakeGateway S16 fail before any hardening changes — ConfirmFakeGatewayPayment uses wrong error code.
---

## Failing Tests

- **AC10** (`tests/payment-orchestration-atomic-confirm.test.ts`) — "rejects confirm when tx amount exceeds amountRemaining"
- **S16** (`tests/payment-orchestration-service-fakegateway-flow.test.ts`) — "CreateGatewayPayment idempotency conflict rejects mismatched request"

## Root Cause

Both fail with `code: 'PARTIAL_PAYMENT_NOT_ALLOWED'` when they expect `OVERPAYMENT_REJECTED` (status 422).

`ConfirmFakeGatewayPayment.ts` and the related gateway payment use case throw `PARTIAL_PAYMENT_NOT_ALLOWED` in a code path that AC10/S16 expect to produce `OVERPAYMENT_REJECTED`.

**Why not fixed yet:** These are in business logic files (`ConfirmFakeGatewayPayment.ts`) that were not in scope for the S-Hardening P0.1-P0.7 work.

**How to apply:** When working on `ConfirmFakeGatewayPayment.ts` or related use cases, fix the overpayment error code from `PARTIAL_PAYMENT_NOT_ALLOWED` to `OVERPAYMENT_REJECTED` to clear these 2 pre-existing failures.
