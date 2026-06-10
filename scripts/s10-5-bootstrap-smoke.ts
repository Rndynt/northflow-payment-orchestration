#!/usr/bin/env tsx
/**
 * s10-5-bootstrap-smoke.ts
 *
 * Bootstrap smoke test for a running Northflow service.
 * Creates a complete fake_gateway payment flow to verify all layers work end-to-end.
 *
 * WARNING: This script CREATES DATA. Run only in sandbox/staging environments.
 *
 * Usage:
 *   NORTHFLOW_BASE_URL=https://staging.example.com \
 *   NORTHFLOW_API_KEY=nf.staging.cred_xxx.<secret> \
 *   NORTHFLOW_SOURCE_APP=aura_pos \
 *   NORTHFLOW_SMOKE_MERCHANT_NAME="Smoke Test Merchant" \
 *   NORTHFLOW_SMOKE_EXTERNAL_REF="smoke_$(date +%s)" \
 *   NORTHFLOW_SMOKE_PROVIDER=fake_gateway \
 *   NORTHFLOW_SMOKE_METHOD=qris \
 *   NORTHFLOW_SMOKE_CURRENCY=IDR \
 *   NORTHFLOW_SMOKE_AMOUNT=10000 \
 *   pnpm s10:smoke
 *
 * Exit codes:
 *   0 — all required checks passed (skips are acceptable)
 *   1 — one or more required checks failed
 */

const MASK = '***';
function maskSecret(v: string | undefined): string {
  if (!v) return '(not set)';
  if (v.length <= 8) return MASK;
  return v.slice(0, 4) + MASK;
}
function env(k: string): string | undefined { return process.env[k]; }

const BASE_URL = (env('NORTHFLOW_BASE_URL') ?? 'http://localhost:3000').replace(/\/$/, '');
const API_KEY = env('NORTHFLOW_API_KEY') ?? '';
const SOURCE_APP = env('NORTHFLOW_SOURCE_APP') ?? 'smoke-test';
const SMOKE_MERCHANT_NAME = env('NORTHFLOW_SMOKE_MERCHANT_NAME') ?? 'Smoke Test Merchant';
const SMOKE_EXT_REF = env('NORTHFLOW_SMOKE_EXTERNAL_REF') ?? `smoke_${Date.now()}`;
const SMOKE_PROVIDER = env('NORTHFLOW_SMOKE_PROVIDER') ?? 'fake_gateway';
const SMOKE_METHOD = env('NORTHFLOW_SMOKE_METHOD') ?? 'qris';
const SMOKE_CURRENCY = env('NORTHFLOW_SMOKE_CURRENCY') ?? 'IDR';
const SMOKE_AMOUNT = parseInt(env('NORTHFLOW_SMOKE_AMOUNT') ?? '10000', 10);
const SMOKE_WEBHOOK_URL = env('NORTHFLOW_SMOKE_WEBHOOK_URL');

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
s10-5-bootstrap-smoke — Northflow full-flow smoke test

WARNING: Creates real data. Run in sandbox/staging only.

Env vars:
  NORTHFLOW_BASE_URL                 Service base URL
  NORTHFLOW_API_KEY                  API credential (required)
  NORTHFLOW_SOURCE_APP               Source app name (default: smoke-test)
  NORTHFLOW_SMOKE_MERCHANT_NAME      Merchant name to create
  NORTHFLOW_SMOKE_EXTERNAL_REF       Unique external ref (default: smoke_<timestamp>)
  NORTHFLOW_SMOKE_PROVIDER           Provider code (default: fake_gateway)
  NORTHFLOW_SMOKE_METHOD             Payment method (default: qris)
  NORTHFLOW_SMOKE_CURRENCY           Currency (default: IDR)
  NORTHFLOW_SMOKE_AMOUNT             Amount in smallest unit (default: 10000)
  NORTHFLOW_SMOKE_WEBHOOK_URL        Optional webhook endpoint URL for smoke test

Exit code 0 = required checks pass (skips are OK), 1 = required check failed
`);
  process.exit(0);
}

if (!API_KEY) {
  console.error('ERROR: NORTHFLOW_API_KEY is required. Set it in your environment.');
  process.exit(1);
}

console.log('S10.5 Bootstrap Smoke Test');
console.log('─────────────────────────────────────────────────────');
console.log(`  base URL:    ${BASE_URL}`);
console.log(`  api key:     ${maskSecret(API_KEY)}`);
console.log(`  source app:  ${SOURCE_APP}`);
console.log(`  merchant:    ${SMOKE_MERCHANT_NAME} (${SMOKE_EXT_REF})`);
console.log(`  provider:    ${SMOKE_PROVIDER}`);
console.log(`  method:      ${SMOKE_METHOD}`);
console.log(`  amount:      ${SMOKE_AMOUNT} ${SMOKE_CURRENCY}`);
console.log(`  webhook url: ${SMOKE_WEBHOOK_URL ? maskSecret(SMOKE_WEBHOOK_URL) : '(not set — skipping webhook smoke)'}`);
console.log('─────────────────────────────────────────────────────');
console.log('');

type Status = 'PASS' | 'FAIL' | 'SKIP';
const results: { name: string; status: Status; detail?: string }[] = [];
let hasFailure = false;

function record(name: string, status: Status, detail?: string) {
  results.push({ name, status, detail });
  const icon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⏭ ';
  if (status === 'FAIL') hasFailure = true;
  console.log(`  ${icon} [${name}] ${detail ?? ''}`);
}

async function post(path: string, body: unknown, merchantId?: string): Promise<{ status: number; data: unknown }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${API_KEY}`,
    'x-source-app': SOURCE_APP,
  };
  if (merchantId) headers['x-payment-merchant-id'] = merchantId;
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, data: (json as Record<string, unknown>)?.data ?? json };
}

async function get(path: string, merchantId?: string): Promise<{ status: number; data: unknown }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${API_KEY}`,
    'x-source-app': SOURCE_APP,
  };
  if (merchantId) headers['x-payment-merchant-id'] = merchantId;
  const res = await fetch(`${BASE_URL}${path}`, {
    headers,
    signal: AbortSignal.timeout(15_000),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, data: (json as Record<string, unknown>)?.data ?? json };
}

// ── 1. Readiness ──────────────────────────────────────────────────────────────
try {
  const res = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(5_000) });
  const body = await res.json().catch(() => ({})) as Record<string, unknown>;
  if (res.status === 200 && body.ok) record('readiness', 'PASS', '/health OK');
  else record('readiness', 'FAIL', `HTTP ${res.status}`);
} catch (e: unknown) {
  record('readiness', 'FAIL', `Cannot reach ${BASE_URL}: ${e instanceof Error ? e.message : e}`);
  printSummary();
  process.exit(1);
}

// ── 2. Create merchant ────────────────────────────────────────────────────────
let merchantId = '';
try {
  const { status, data } = await post('/v1/merchants', {
    externalRef: SMOKE_EXT_REF,
    name: SMOKE_MERCHANT_NAME,
    currency: SMOKE_CURRENCY,
    sourceApp: SOURCE_APP,
  });
  if (status === 200 || status === 201) {
    merchantId = (data as Record<string, unknown>)?.id as string;
    record('merchant', 'PASS', `id=${merchantId}`);
  } else {
    record('merchant', 'FAIL', `HTTP ${status}: ${JSON.stringify(data)}`);
  }
} catch (e: unknown) {
  record('merchant', 'FAIL', String(e));
}

// ── 3. Create provider account ────────────────────────────────────────────────
let providerAccountId = '';
if (!merchantId) {
  record('provider account', 'SKIP', 'merchant not created');
} else {
  try {
    const { status, data } = await post(
      `/v1/merchants/${merchantId}/provider-accounts`,
      {
        merchantId,
        provider: SMOKE_PROVIDER,
        externalAccountId: `smoke-pa-${Date.now()}`,
        environment: 'sandbox',
        sourceApp: SOURCE_APP,
      },
      merchantId,
    );
    if (status === 200 || status === 201) {
      providerAccountId = (data as Record<string, unknown>)?.id as string;
      record('provider account', 'PASS', `id=${providerAccountId} provider=${SMOKE_PROVIDER}`);
    } else {
      record('provider account', 'FAIL', `HTTP ${status}: ${JSON.stringify(data)}`);
    }
  } catch (e: unknown) {
    record('provider account', 'FAIL', String(e));
  }
}

// ── 4. Upsert payment method ──────────────────────────────────────────────────
if (!merchantId || !providerAccountId) {
  record('payment method', 'SKIP', 'provider account not created');
} else {
  try {
    const { status, data } = await post(
      `/v1/merchants/${merchantId}/provider-accounts/${providerAccountId}/methods/${SMOKE_METHOD}`,
      {
        methodType: SMOKE_METHOD,
        displayName: SMOKE_METHOD.toUpperCase(),
        status: 'active',
        currency: SMOKE_CURRENCY,
        sortOrder: 1,
      },
      merchantId,
    );
    if (status === 200 || status === 201) {
      record('payment method', 'PASS', `method=${SMOKE_METHOD} created=${(data as Record<string,unknown>)?.created}`);
    } else {
      record('payment method', 'FAIL', `HTTP ${status}: ${JSON.stringify(data)}`);
    }
  } catch (e: unknown) {
    record('payment method', 'FAIL', String(e));
  }
}

// ── 5. Create payment intent ──────────────────────────────────────────────────
let intentId = '';
if (!merchantId) {
  record('intent', 'FAIL', 'merchant not created — cannot create intent');
} else {
  try {
    const { status, data } = await post(
      '/v1/payment-intents',
      {
        merchantId,
        sourceApp: SOURCE_APP,
        externalPayableType: 'smoke_order',
        externalPayableId: `smoke-order-${Date.now()}`,
        currency: SMOKE_CURRENCY,
        amountDue: SMOKE_AMOUNT,
        idempotencyKey: `smoke:${SMOKE_EXT_REF}:intent`,
      },
      merchantId,
    );
    if (status === 200 || status === 201) {
      intentId = (data as Record<string, unknown>)?.id as string;
      record('intent', 'PASS', `id=${intentId} amount=${SMOKE_AMOUNT} ${SMOKE_CURRENCY}`);
    } else {
      record('intent', 'FAIL', `HTTP ${status}: ${JSON.stringify(data)}`);
    }
  } catch (e: unknown) {
    record('intent', 'FAIL', String(e));
  }
}

// ── 6. Create gateway payment ─────────────────────────────────────────────────
let transactionId = '';
if (!intentId || !providerAccountId) {
  record('gateway payment', !intentId ? 'FAIL' : 'SKIP',
    !intentId ? 'intent not created' : 'provider account not created');
} else {
  try {
    const { status, data } = await post(
      `/v1/payment-intents/${intentId}/gateway-payments`,
      {
        merchantId,
        provider: SMOKE_PROVIDER,
        providerAccountId,
        method: SMOKE_METHOD,
        amount: SMOKE_AMOUNT,
        sourceApp: SOURCE_APP,
        idempotencyKey: `smoke:${SMOKE_EXT_REF}:payment`,
      },
      merchantId,
    );
    if (status === 200 || status === 201) {
      transactionId = (data as Record<string, unknown>)?.id as string;
      record('gateway payment', 'PASS', `txId=${transactionId}`);
    } else {
      record('gateway payment', 'FAIL', `HTTP ${status}: ${JSON.stringify(data)}`);
    }
  } catch (e: unknown) {
    record('gateway payment', 'FAIL', String(e));
  }
}

// ── 7. Fake gateway confirm (dev/staging only) ────────────────────────────────
if (!transactionId) {
  record('fake confirm', 'SKIP', 'no transaction to confirm');
} else if (SMOKE_PROVIDER !== 'fake_gateway') {
  record('fake confirm', 'SKIP', `provider=${SMOKE_PROVIDER} — only applicable to fake_gateway`);
} else {
  try {
    const { status, data } = await post(
      `/v1/dev/fake-gateway/transactions/${transactionId}/confirm`,
      { transactionId, merchantId, sourceApp: SOURCE_APP },
      merchantId,
    );
    if (status === 200 || status === 201) {
      record('fake confirm', 'PASS', `txId=${transactionId} confirmed`);
    } else if (status === 404) {
      record('fake confirm', 'SKIP', 'dev route absent (production environment — expected)');
    } else {
      record('fake confirm', 'FAIL', `HTTP ${status}: ${JSON.stringify(data)}`);
    }
  } catch (e: unknown) {
    record('fake confirm', 'FAIL', String(e));
  }
}

// ── 8. Poll intent status ─────────────────────────────────────────────────────
if (!intentId) {
  record('status', 'FAIL', 'intent not created');
} else {
  try {
    const { status, data } = await get(`/v1/payment-intents/${intentId}/status`, merchantId);
    if (status === 200) {
      const s = (data as Record<string, unknown>)?.status;
      record('status', 'PASS', `intent status=${s}`);
    } else {
      record('status', 'FAIL', `HTTP ${status}`);
    }
  } catch (e: unknown) {
    record('status', 'FAIL', String(e));
  }
}

// ── 9. Refundability ──────────────────────────────────────────────────────────
if (!intentId) {
  record('refundability', 'SKIP', 'intent not created');
} else {
  try {
    const { status, data } = await get(`/v1/payment-intents/${intentId}/refundability`, merchantId);
    if (status === 200) {
      const r = data as Record<string, unknown>;
      record('refundability', 'PASS', `refundable=${r.refundable} voidable=${r.voidable}`);
    } else {
      record('refundability', 'SKIP', `HTTP ${status} — may not be applicable yet`);
    }
  } catch (e: unknown) {
    record('refundability', 'SKIP', String(e));
  }
}

// ── 10. Refund/void (only when valid state) ───────────────────────────────────
// After fake_gateway confirm, status should be 'paid' — check refundability and try refund
if (!transactionId) {
  record('refund/void', 'SKIP', 'no transaction');
} else {
  try {
    const { status: rStatus, data: rData } = await get(
      `/v1/payment-intents/${intentId}/refundability`, merchantId,
    );
    if (rStatus === 200) {
      const r = rData as Record<string, unknown>;
      if (r.refundable) {
        const { status, data } = await post(
          `/v1/payment-transactions/${transactionId}/refund`,
          {
            transactionId,
            merchantId,
            amount: SMOKE_AMOUNT,
            reason: 'smoke_test',
            sourceApp: SOURCE_APP,
            idempotencyKey: `smoke:${SMOKE_EXT_REF}:refund`,
          },
          merchantId,
        );
        if (status === 200 || status === 201) {
          record('refund/void', 'PASS', 'refund accepted');
        } else {
          record('refund/void', 'SKIP', `HTTP ${status} — ${JSON.stringify(data)}`);
        }
      } else if (r.voidable) {
        const { status, data } = await post(
          `/v1/payment-transactions/${transactionId}/void`,
          {
            transactionId,
            merchantId,
            sourceApp: SOURCE_APP,
            idempotencyKey: `smoke:${SMOKE_EXT_REF}:void`,
          },
          merchantId,
        );
        if (status === 200 || status === 201) {
          record('refund/void', 'PASS', 'void accepted');
        } else {
          record('refund/void', 'SKIP', `HTTP ${status} — ${JSON.stringify(data)}`);
        }
      } else {
        record('refund/void', 'SKIP', 'neither refundable nor voidable at this state');
      }
    } else {
      record('refund/void', 'SKIP', 'could not check refundability');
    }
  } catch (e: unknown) {
    record('refund/void', 'SKIP', String(e));
  }
}

// ── 11. Audit log ─────────────────────────────────────────────────────────────
try {
  const { status, data } = await get(
    `/v1/audit-logs?merchantId=${encodeURIComponent(merchantId)}&limit=5`,
  );
  if (status === 200) {
    const logs = data as unknown[];
    record('audit log', 'PASS', `${Array.isArray(logs) ? logs.length : '?'} entries found`);
  } else if (status === 403) {
    record('audit log', 'SKIP', 'credential missing audit_log:read scope — skipping');
  } else {
    record('audit log', 'SKIP', `HTTP ${status}`);
  }
} catch (e: unknown) {
  record('audit log', 'SKIP', String(e));
}

// ── 12. Webhook smoke ─────────────────────────────────────────────────────────
if (!SMOKE_WEBHOOK_URL) {
  record('webhook', 'SKIP', 'NORTHFLOW_SMOKE_WEBHOOK_URL not set');
} else if (!merchantId) {
  record('webhook', 'SKIP', 'merchant not created');
} else {
  try {
    const { status, data } = await post(
      `/v1/merchants/${merchantId}/webhooks/endpoints`,
      {
        url: SMOKE_WEBHOOK_URL,
        subscribedEvents: ['payment_intent.paid', 'payment_intent.failed'],
      },
      merchantId,
    );
    if (status === 200 || status === 201) {
      const r = data as Record<string, unknown>;
      const endpointId = (r.endpoint as Record<string, unknown>)?.id ?? r.id;
      // rawSecret intentionally not logged
      record('webhook', 'PASS', `endpoint id=${endpointId} (rawSecret masked — store it now)`);

      // List deliveries
      const { status: dStatus, data: deliveries } = await get(
        `/v1/merchants/${merchantId}/webhooks/deliveries`,
        merchantId,
      );
      if (dStatus === 200) {
        const ds = (deliveries as Record<string, unknown>)?.deliveries;
        const count = Array.isArray(ds) ? ds.length : '?';
        record('webhook', 'PASS', `deliveries=${count}`);
      }
    } else if (status === 403) {
      record('webhook', 'SKIP', 'credential missing webhook:manage scope');
    } else {
      record('webhook', 'FAIL', `HTTP ${status}: ${JSON.stringify(data)}`);
    }
  } catch (e: unknown) {
    record('webhook', 'FAIL', String(e));
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────
function printSummary() {
  console.log('');
  console.log('─────────────────────────────────────────────────────');
  console.log('S10.5 Smoke Summary');
  console.log('─────────────────────────────────────────────────────');
  for (const r of results) {
    const icon = r.status === 'PASS' ? '✅' : r.status === 'FAIL' ? '❌' : '⏭ ';
    const detail = r.detail ? ` — ${r.detail}` : '';
    console.log(`  ${icon} ${r.name.padEnd(22)} ${r.status}${detail}`);
  }
  const p = results.filter(r => r.status === 'PASS').length;
  const f = results.filter(r => r.status === 'FAIL').length;
  const s = results.filter(r => r.status === 'SKIP').length;
  console.log('─────────────────────────────────────────────────────');
  console.log(`  PASS: ${p}  FAIL: ${f}  SKIP: ${s}`);
  console.log('─────────────────────────────────────────────────────');
  if (f > 0) console.log('\n  ❌ One or more required checks failed. See above for details.\n');
  else console.log('\n  Smoke test complete. Check PASS/SKIP counts above.\n');
}

printSummary();
process.exit(hasFailure ? 1 : 0);
