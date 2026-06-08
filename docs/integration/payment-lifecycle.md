# Payment Lifecycle

```txt
1. Create local order/invoice/booking in merchant app
2. Create payment intent in Northflow
3. Read payment options
4. Create payment transaction/gateway payment
5. Show QR/payment URL/VA/instructions to customer
6. Provider webhook updates Northflow
7. Merchant backend polls Northflow status
8. Merchant app marks payable paid/failed/expired
```

## Sequence

```txt
merchant backend -> Northflow: create payment intent
merchant backend -> Northflow: get payment options
merchant backend -> Northflow: create gateway payment
merchant backend -> merchant frontend: safe payment instructions
provider -> Northflow: provider webhook
merchant backend -> Northflow: poll intent status
merchant backend -> merchant database: update local payable
```

## Current Northflow intent statuses

```txt
requires_payment
partially_paid
paid
overpaid
refunded
voided
expired
cancelled
failed
```

## Local status mapping examples

```txt
Northflow requires_payment -> local awaiting_payment
Northflow partially_paid -> local partially_paid
Northflow paid -> local paid
Northflow overpaid -> local paid_with_overpayment_review
Northflow failed -> local payment_failed
Northflow expired -> local payment_expired
Northflow cancelled/voided -> local payment_cancelled
Northflow refunded -> local refund state
```
