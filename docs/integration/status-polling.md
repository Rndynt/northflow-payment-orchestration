# Status Polling

The current integration model is polling.

```txt
merchant frontend -> merchant backend -> Northflow intent status
```

The merchant backend polls Northflow. The frontend polls the merchant backend and must not call Northflow directly with Northflow credentials.

## Guidance

- Poll at a short interval immediately after payment creation.
- Back off after several attempts.
- Stop when the intent reaches a terminal local outcome.
- Handle customer return pages and background jobs with the same backend status endpoint.

Merchant outbound webhook/callback delivery is available in S10.3 for backend-to-backend event delivery; polling remains supported.

## Relationship to merchant outbound webhooks

Status polling remains supported for SDK and REST consumers. Merchant outbound webhooks are also available for event-driven payment lifecycle updates; use polling as a fallback, reconciliation tool, or for backends that cannot receive callbacks. Webhook receivers should handle events idempotently by event id and resource id.
