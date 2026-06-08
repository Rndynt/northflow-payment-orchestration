# Idempotency Guide

Idempotency prevents duplicate provider calls when the merchant backend retries after timeouts, network failures, process restarts, or 5xx responses.

## Recommended keys

```txt
intent creation: order:<orderId>:intent
payment creation: order:<orderId>:payment:<method>
refund: refund:<transactionId>:<amount>
void: void:<transactionId>
```

## When to reuse the same key

Reuse the same key for retries of the same logical operation with the same payload. If a create-payment request times out, retry with the same key so Northflow can return the prior result instead of creating another provider transaction.

## When to create a new key

Create a new key when the logical operation changes, such as a different payable, payment method, refund amount, or transaction.

## What not to include

Do not include API keys, signing secrets, provider credentials, card data, customer secrets, or other sensitive values. Prefer stable merchant backend identifiers.

## Retry behavior

Retry safe mutation failures with the same idempotency key. Treat idempotency conflicts as integration bugs: the same key was reused with a different operation or payload context.
