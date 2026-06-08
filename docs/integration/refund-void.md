# Refund and Void

## Refund vs void/cancel

- **Refund**: returns funds for a succeeded/settled payment transaction when the provider supports refunds.
- **Void/cancel**: cancels a pending or action-required payment transaction before settlement when the provider supports cancellation.

## Transaction IDs

Refund and void operations use Northflow payment transaction IDs, not local order IDs. Store the transaction ID returned by gateway payment creation.

## Refundability check

Call refundability before refunding to determine refundable transactions and remaining amount.

## Idempotency

Use stable keys such as:

```txt
refund:<transactionId>:<amount>
void:<transactionId>
```

## Provider support

Provider support may vary. Do not assume all providers support all refund or void operations.

## Manual and fake gateway behavior

Manual provider behavior can require operational confirmation. `fake_gateway` is intended for development and tests and can simulate confirmation, refund, and cancellation behavior without a real provider.
