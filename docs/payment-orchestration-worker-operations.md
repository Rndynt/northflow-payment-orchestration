# Payment Orchestration Service — Worker Operations Guide

**Phase:** 8K — SDK/API Contract Freeze + Deployment Readiness  
**Last updated:** 2026-06-05

This guide covers the standalone worker runner for `@northflow/payment-orchestration-service`.

Workers run without Express, construct the standalone container, execute an operation, emit a JSON result, and exit with code `0` (success) or `1` (error/invalid args).

---

## Runner Entry Point

```
apps/payment-orchestration-service/src/workers/run.ts
```

Invoked via:

```bash
pnpm --filter @northflow/payment-orchestration-service worker -- <command> [options]
```

Or directly:

```bash
node_modules/.bin/tsx --tsconfig apps/payment-orchestration-service/tsconfig.json \
  apps/payment-orchestration-service/src/workers/run.ts <command> [options]
```

---

## Available Workers

### `expire-stale`

Expires pending/requires_action transactions and intents that have passed their `expiresAt` timestamp. Skips terminal transactions. Idempotent.

```bash
pnpm --filter @northflow/payment-orchestration-service worker -- expire-stale --limit 100
```

**Options:**

| Option | Default | Description |
|--------|---------|-------------|
| `--limit N` | `100` | Maximum number of transactions to process per run. |

**Output example:**

```json
{
  "worker": "expire-stale",
  "expired": 3,
  "skipped": 0,
  "errors": 0,
  "durationMs": 42
}
```

**Exit codes:**

| Code | Meaning |
|------|---------|
| `0` | Success (may have expired 0 items — that is normal). |
| `1` | Invalid arguments or DB/runtime error. |

---

### `reconcile-intent`

Recomputes intent totals (`amountPaid`, `amountRefunded`, `amountRemaining`, `status`) from actual transaction state. Use after a crash or suspected drift.

```bash
pnpm --filter @northflow/payment-orchestration-service worker -- reconcile-intent \
  --merchant-id <MERCHANT_ID> --intent-id <INTENT_ID>
```

**Options:**

| Option | Required | Description |
|--------|----------|-------------|
| `--merchant-id` | Yes | The merchant that owns the intent. |
| `--intent-id` | Yes | The intent to reconcile. |

**Output example:**

```json
{
  "worker": "reconcile-intent",
  "intentId": "pi_abc123",
  "changed": true,
  "before": { "amountPaid": 0, "amountRefunded": 0, "amountRemaining": 100000, "status": "requires_payment" },
  "after":  { "amountPaid": 100000, "amountRefunded": 0, "amountRemaining": 0, "status": "paid" }
}
```

---

### `reprocess-provider-events`

Replays stored provider events (FakeGateway and Xendit sandbox) that were not successfully processed. Skips already-processed events and events with missing payloads or dependencies. Does not reverify signatures during replay.

```bash
pnpm --filter @northflow/payment-orchestration-service worker -- reprocess-provider-events \
  --older-than-minutes 5 --limit 100
```

**Options:**

| Option | Default | Description |
|--------|---------|-------------|
| `--older-than-minutes N` | `5` | Only reprocess events received more than N minutes ago. |
| `--limit N` | `100` | Maximum number of events to process per run. |

**Output example:**

```json
{
  "worker": "reprocess-provider-events",
  "processed": 2,
  "skipped": 1,
  "errors": 0,
  "durationMs": 75
}
```

---

### `all-safe`

Runs `expire-stale` followed by `reprocess-provider-events`. Does NOT run `reconcile-intent` (that requires specific merchant+intent IDs). Does NOT require provider network calls. Safe to run on any schedule.

```bash
pnpm --filter @northflow/payment-orchestration-service worker -- all-safe --limit 100
```

**Options:**

| Option | Default | Description |
|--------|---------|-------------|
| `--limit N` | `100` | Passed to both sub-workers. |

---

## Required Environment Variables for Workers

| Variable | Description |
|----------|-------------|
| `NODE_ENV` | Runtime environment (`development` / `production`). |
| `PAYMENT_ORCHESTRATION_DATABASE_URL` | PostgreSQL connection string. Falls back to `DATABASE_URL`. |
| `PAYMENT_ORCHESTRATION_SERVICE_TOKEN` | Service token (not strictly required by workers but loaded by container). |

---

## Scheduling Recommendations

Workers have **no built-in scheduler**. Run them from a platform cron, queue worker, or maintenance script:

| Worker | Recommended cadence | Notes |
|--------|--------------------|-|
| `expire-stale` | Every 5–15 minutes | Safe to run frequently. Idempotent. |
| `reprocess-provider-events` | Every 5–10 minutes | Safe to run frequently. Idempotent. |
| `all-safe` | Every 5–10 minutes | Combines both above. |
| `reconcile-intent` | On demand / after crash | Requires merchant-id + intent-id. Run manually. |

---

## Notes

- Workers do **not** start Express. They exit after completing the operation.
- Non-zero exit codes indicate an error — check stdout for the JSON error summary.
- Workers use the same `ServiceContainer` as the HTTP service. DB connection is closed cleanly on exit.
- `reprocess-provider-events` supports only `fake_gateway` and `xendit_sandbox` stored parsed payloads. Unsupported providers are skipped with a log message.
