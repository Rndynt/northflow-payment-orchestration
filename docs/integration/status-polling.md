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

Merchant outbound webhook/callback delivery is a future phase and is not part of S10.2.
