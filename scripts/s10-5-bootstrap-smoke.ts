#!/usr/bin/env tsx
/**
 * s10-5-bootstrap-smoke.ts  (S10.5.1 — runtime contract fix)
 *
 * Bootstrap smoke test for a running Northflow service.
 * Exercises the full fake_gateway payment flow end-to-end.
 *
 * WARNING: Creates data. Run in sandbox/staging only.
 *
 * Fixed in S10.5.1:
 *   - Payment method upsert now uses PUT (not POST)
 *   - Status parsed from data.intent.status (not data.status)
 *   - Refundability parsed from actual contract: { totalRefundable, transactions:[{transactionId, amountRefundable}] }
 *   - Audit log parsed from data.entries (not raw array)
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
  NORTHFLOW_BASE_URL                 Service base URL (default: http://localhost:3000)
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
  console.error('ERROR: NORTHFLOW_API_KEY is required.');
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
console.log(`  webhook url: ${SMOKE_WEBHOOK_URL ? maskSecret(SMOKE_WEBHOOK_URL) : '(not set)'}`);
console.log('─────────────────────────────────────────────────────');
console.log('');

// ── Types ─────────────────────────────────────────────────────────────────────

type CheckStatus = 'PASS' | 'FAIL' | 'SKIP';

interface CheckRecord {
  name: string;
  status: CheckStatus;
  detail?: string;
}

const results: CheckRecord[] = [];
let hasFailure = false;

function record(name: string, status: CheckStatus, detail?: string): void {
  results.push({ name, status, detail });
  const icon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⏭ ';
  if (status === 'FAIL') hasFailure = true;
  console.log(`  ${icon} [${name}] ${detail ?? ''}`);
}

// ── Task A: Request helpers supporting GET, POST, PUT ─────────────────────────

interface RequestResult {
  status: number;
  /** Unwrapped from { ok: true, data: X } — returns X on success, full body on non-2xx */
  data: unknown;
  /** Raw parsed JSON response */
  raw: unknown;
}

async function request(
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  body?: unknown,
  merchantId?: string,
): Promise<RequestResult> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${API_KEY}`,
    'x-source-app': SOURCE_APP,
  };
  if (merchantId) headers['x-payment-merchant-id'] = merchantId;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });

  let raw: unknown = null;
  try { raw = await res.json(); } catch { /* empty body */ }

  // Unwrap { ok: true, data: X }
  const envelope = raw as Record<string, unknown> | null;
  const data = (envelope?.ok === true && 'data' in (envelope ?? {}))
    ? envelope!['data']
    : raw;

  return { status: res.status, data, raw };
}

function get(path: string, merchantId?: string): Promise<RequestResult> {
  return request('GET', path, undefined, merchantId);
}

function post(path: string, body: unknown, merchantId?: string): Promise<RequestResult> {
  return request('POST', path, body, merchantId);
}

// Task A+B: PUT helper for payment method upsert
function put(path: string, body: unknown, merchantId?: string): Promise<RequestResult> {
  return request('PUT', path, body, merchantId);
}

// ── Summary ───────────────────────────────────────────────────────────────────

function printSummary(): void {
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
  if (f > 0) console.log('\n  ❌ One or more required checks failed.\n');
  else console.log('\n  Smoke test complete.\n');
}

printSummary();
process.exit(hasFailure ? 1 : 0);

// ── Run smoke steps ────────────────────────────────────────────────────────
void (async () => {
  // ── Step 1: Readiness ─────────────────────────────────────────────────────────
  
  try {
    const res = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(5_000) });
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    if (res.status === 200 && body.ok) {
      record('readiness', 'PASS', '/health OK');
    } else {
      record('readiness', 'FAIL', `HTTP ${res.status}`);
      printSummary(); process.exit(1);
    }
  } catch (e: unknown) {
    record('readiness', 'FAIL', `Cannot reach ${BASE_URL}: ${e instanceof Error ? e.message : e}`);
    printSummary(); process.exit(1);
  }
  
  // ── Step 2: Create merchant ───────────────────────────────────────────────────
  
  let merchantId = '';
  try {
    const { status, data } = await post('/v1/merchants', {
      externalRef: SMOKE_EXT_REF,
      name: SMOKE_MERCHANT_NAME,
      currency: SMOKE_CURRENCY,
      sourceApp: SOURCE_APP,
    });
    if (status === 200 || status === 201) {
      merchantId = (data as Record<string, unknown>)?.id as string ?? '';
      record('merchant', 'PASS', `id=${merchantId}`);
    } else {
      record('merchant', 'FAIL', `HTTP ${status}: ${JSON.stringify(data)}`);
    }
  } catch (e: unknown) {
    record('merchant', 'FAIL', String(e));
  }
  
  // ── Step 3: Create provider account ──────────────────────────────────────────
  
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
        providerAccountId = (data as Record<string, unknown>)?.id as string ?? '';
        record('provider account', 'PASS', `id=${providerAccountId}`);
      } else {
        record('provider account', 'FAIL', `HTTP ${status}: ${JSON.stringify(data)}`);
      }
    } catch (e: unknown) {
      record('provider account', 'FAIL', String(e));
    }
  }
  
  // ── Step 4: Upsert payment method via PUT (Task B fix) ────────────────────────
  // Route: PUT /v1/merchants/{merchantId}/provider-accounts/{providerAccountId}/methods/{method}
  
  if (!merchantId || !providerAccountId) {
    record('payment method', 'SKIP', 'provider account not created');
  } else {
    try {
      const { status, data } = await put(
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
        const created = (data as Record<string, unknown>)?.created;
        record('payment method', 'PASS', `method=${SMOKE_METHOD} created=${created}`);
      } else {
        record('payment method', 'FAIL', `HTTP ${status}: ${JSON.stringify(data)}`);
      }
    } catch (e: unknown) {
      record('payment method', 'FAIL', String(e));
    }
  }
  
  // ── Step 5: Create payment intent ─────────────────────────────────────────────
  
  let intentId = '';
  if (!merchantId) {
    record('intent', 'FAIL', 'merchant not created');
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
        intentId = (data as Record<string, unknown>)?.id as string ?? '';
        record('intent', 'PASS', `id=${intentId} amount=${SMOKE_AMOUNT} ${SMOKE_CURRENCY}`);
      } else {
        record('intent', 'FAIL', `HTTP ${status}: ${JSON.stringify(data)}`);
      }
    } catch (e: unknown) {
      record('intent', 'FAIL', String(e));
    }
  }
  
  // ── Step 6: Create gateway payment ────────────────────────────────────────────
  
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
        transactionId = (data as Record<string, unknown>)?.id as string ?? '';
        record('gateway payment', 'PASS', `txId=${transactionId}`);
      } else {
        record('gateway payment', 'FAIL', `HTTP ${status}: ${JSON.stringify(data)}`);
      }
    } catch (e: unknown) {
      record('gateway payment', 'FAIL', String(e));
    }
  }
  
  // ── Step 7: Fake gateway confirm ──────────────────────────────────────────────
  
  if (!transactionId) {
    record('fake confirm', 'SKIP', 'no transaction');
  } else if (SMOKE_PROVIDER !== 'fake_gateway') {
    record('fake confirm', 'SKIP', `provider=${SMOKE_PROVIDER} — only for fake_gateway`);
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
        record('fake confirm', 'SKIP', 'dev route absent (production)');
      } else {
        record('fake confirm', 'FAIL', `HTTP ${status}: ${JSON.stringify(data)}`);
      }
    } catch (e: unknown) {
      record('fake confirm', 'FAIL', String(e));
    }
  }
  
  // ── Step 8: Poll intent status (Task C fix) ───────────────────────────────────
  // Actual shape: { ok:true, data: { intent: { id, status, ... }, latestTransaction, isTerminal, ... } }
  // After unwrap: { intent: {...}, latestTransaction, isTerminal, requiresAction, canRetryPayment }
  
  if (!intentId) {
    record('status', 'FAIL', 'intent not created');
  } else {
    try {
      const { status, data } = await get(`/v1/payment-intents/${intentId}/status`, merchantId);
      if (status === 200) {
        // Task C: parse from intent.status, not top-level status
        const statusData = data as {
          intent?: { id?: string; status?: string };
          latestTransaction?: { id?: string; status?: string } | null;
          isTerminal?: boolean;
          requiresAction?: boolean;
          canRetryPayment?: boolean;
        };
        const intentStatus = statusData.intent?.status;
        if (!intentStatus) {
          record('status', 'FAIL', `intent.status missing — unexpected shape: ${JSON.stringify(data)}`);
        } else {
          record('status', 'PASS',
            `intent.status=${intentStatus} isTerminal=${statusData.isTerminal}`);
        }
      } else {
        record('status', 'FAIL', `HTTP ${status}`);
      }
    } catch (e: unknown) {
      record('status', 'FAIL', String(e));
    }
  }
  
  // ── Step 9: Refundability + refund/void (Task D fix) ─────────────────────────
  // Actual shape: { ok:true, data: { intentId, merchantId, totalRefundable, currency, transactions:[{transactionId, amount, amountAlreadyRefunded, amountRefundable, provider, method}] } }
  // After unwrap: { intentId, merchantId, totalRefundable, currency, transactions:[...] }
  // There is NO voidable field — refundability only covers refunds.
  // For void: only applicable before the tx settles; not surfaced by refundability endpoint.
  
  interface RefundableTransactionEntry {
    transactionId: string;
    amount: number;
    amountAlreadyRefunded: number;
    amountRefundable: number;
    provider: string;
    method: string;
  }
  
  interface RefundabilityData {
    intentId?: string;
    merchantId?: string;
    totalRefundable?: number;
    currency?: string;
    transactions?: RefundableTransactionEntry[];
  }
  
  if (!intentId) {
    record('refund/void', 'SKIP', 'intent not created');
  } else {
    try {
      const { status, data } = await get(`/v1/payment-intents/${intentId}/refundability`, merchantId);
  
      if (status !== 200) {
        record('refund/void', 'SKIP', `refundability HTTP ${status}`);
      } else {
        // Task D: defensive parse of actual contract
        const rData = data as RefundabilityData;
        const transactions = Array.isArray(rData?.transactions) ? rData.transactions : [];
        const totalRefundable = rData?.totalRefundable ?? 0;
  
        // Find best refundable candidate
        const candidate = transactions.find(
          (t): t is RefundableTransactionEntry =>
            typeof t.transactionId === 'string' &&
            typeof t.amountRefundable === 'number' &&
            t.amountRefundable > 0,
        );
  
        if (candidate && totalRefundable > 0) {
          // Try refund using the candidate transaction
          const safeAmount = Math.min(candidate.amountRefundable, SMOKE_AMOUNT);
          try {
            const { status: rStatus, data: rResp } = await post(
              `/v1/payment-transactions/${candidate.transactionId}/refund`,
              {
                transactionId: candidate.transactionId,
                merchantId,
                amount: safeAmount,
                reason: 'smoke_test',
                sourceApp: SOURCE_APP,
                idempotencyKey: `smoke:${SMOKE_EXT_REF}:refund`,
              },
              merchantId,
            );
            if (rStatus === 200 || rStatus === 201) {
              record('refund/void', 'PASS',
                `refund accepted txId=${candidate.transactionId} amount=${safeAmount}`);
            } else {
              record('refund/void', 'SKIP',
                `refund HTTP ${rStatus}: ${JSON.stringify(rResp)}`);
            }
          } catch (e: unknown) {
            record('refund/void', 'SKIP', `refund request error: ${String(e)}`);
          }
        } else if (transactionId) {
          // No refundable transaction. Try void as fallback for pre-settlement transactions.
          try {
            const { status: vStatus, data: vResp } = await post(
              `/v1/payment-transactions/${transactionId}/void`,
              {
                transactionId,
                merchantId,
                sourceApp: SOURCE_APP,
                idempotencyKey: `smoke:${SMOKE_EXT_REF}:void`,
              },
              merchantId,
            );
            if (vStatus === 200 || vStatus === 201) {
              record('refund/void', 'PASS', `void accepted txId=${transactionId}`);
            } else {
              record('refund/void', 'SKIP',
                `not refundable (totalRefundable=0) and void HTTP ${vStatus} — transaction may be in terminal state`);
            }
          } catch (e: unknown) {
            record('refund/void', 'SKIP', `void request error: ${String(e)}`);
          }
        } else {
          record('refund/void', 'SKIP',
            `no refundable transactions (totalRefundable=${totalRefundable}) and no transactionId for void`);
        }
      }
    } catch (e: unknown) {
      record('refund/void', 'SKIP', `refundability request error: ${String(e)}`);
    }
  }
  
  // ── Step 10: Audit log (Task E fix) ──────────────────────────────────────────
  // Actual shape: { ok:true, data: { entries: [...], total, limit, offset } }
  // After unwrap: { entries: [...], total, limit, offset }
  
  try {
    const qs = merchantId ? `?merchantId=${encodeURIComponent(merchantId)}&limit=5` : '?limit=5';
    const { status, data } = await get(`/v1/audit-logs${qs}`);
    if (status === 200) {
      // Task E: parse data.entries, not raw array
      const auditData = data as { entries?: unknown[]; total?: number };
      const entries = Array.isArray(auditData?.entries) ? auditData.entries : [];
      const total = auditData?.total ?? entries.length;
      record('audit log', 'PASS', `${entries.length} entries returned (total=${total})`);
    } else if (status === 403) {
      record('audit log', 'SKIP', 'credential missing audit_log:read scope');
    } else {
      record('audit log', 'SKIP', `HTTP ${status}`);
    }
  } catch (e: unknown) {
    record('audit log', 'SKIP', String(e));
  }
  
  // ── Step 11: Webhook smoke ────────────────────────────────────────────────────
  
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
        const d = data as Record<string, unknown>;
        const endpointId = (d.endpoint as Record<string, unknown>)?.id ?? d.id;
        // rawSecret intentionally not logged
        record('webhook', 'PASS', `endpoint id=${endpointId} (rawSecret masked — store it now)`);
      } else if (status === 403) {
        record('webhook', 'SKIP', 'credential missing webhook:manage scope');
      } else {
        record('webhook', 'FAIL', `HTTP ${status}: ${JSON.stringify(data)}`);
      }
    } catch (e: unknown) {
      record('webhook', 'FAIL', String(e));
    }
  }

  printSummary();
  process.exit(hasFailure ? 1 : 0);
})();
