#!/usr/bin/env tsx
/**
 * s10-5-bootstrap-smoke.ts
 *
 * Bootstrap smoke test for a running Northflow service.
 * Exercises the full fake_gateway payment flow end-to-end.
 *
 * WARNING: Creates data. Run in sandbox/staging only.
 *
 * Runtime contract fixes:
 *   - Payment method upsert uses PUT.
 *   - Gateway payment transaction id is parsed from data.transaction.id.
 *   - Status is parsed from data.intent.status.
 *   - Refundability uses the actual { totalRefundable, transactions[] } contract.
 *   - Audit log reads data.entries defensively.
 *   - Wrapped in async IIFE for CJS compatibility.
 */

const MASK = '***';

function maskSecret(v: string | undefined): string {
  if (!v) return '(not set)';
  if (v.length <= 8) return MASK;
  return v.slice(0, 4) + MASK;
}

function env(k: string): string | undefined {
  return process.env[k];
}

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

WARNING: Creates data. Run in sandbox/staging only.

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

type CheckStatus = 'PASS' | 'FAIL' | 'SKIP';
interface CheckRecord { name: string; status: CheckStatus; detail?: string; }
interface RequestResult { status: number; data: unknown; raw: unknown; }

const results: CheckRecord[] = [];
let hasFailure = false;

function record(name: string, status: CheckStatus, detail?: string): void {
  results.push({ name, status, detail });
  const icon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⏭ ';
  if (status === 'FAIL') hasFailure = true;
  console.log(`  ${icon} [${name}] ${detail ?? ''}`);
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
  try {
    raw = await res.json();
  } catch {
    raw = null;
  }

  const envelope = raw as Record<string, unknown> | null;
  const data = envelope?.ok === true && 'data' in (envelope ?? {})
    ? envelope['data']
    : raw;

  return { status: res.status, data, raw };
}

function get(path: string, merchantId?: string): Promise<RequestResult> {
  return request('GET', path, undefined, merchantId);
}

function post(path: string, body: unknown, merchantId?: string): Promise<RequestResult> {
  return request('POST', path, body, merchantId);
}

function put(path: string, body: unknown, merchantId?: string): Promise<RequestResult> {
  return request('PUT', path, body, merchantId);
}

function extractId(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function printSummary(): void {
  console.log('');
  console.log('─────────────────────────────────────────────────────');
  console.log('S10.5 Smoke Summary');
  console.log('─────────────────────────────────────────────────────');
  for (const r of results) {
    const icon = r.status === 'PASS' ? '✅' : r.status === 'FAIL' ? '❌' : '⏭ ';
    console.log(`  ${icon} ${r.name.padEnd(22)} ${r.status}${r.detail ? ` — ${r.detail}` : ''}`);
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

void (async () => {
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

  try {
    const res = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(5_000) });
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    if (res.status === 200 && body.ok) {
      record('readiness', 'PASS', '/health OK');
    } else {
      record('readiness', 'FAIL', `HTTP ${res.status}`);
      printSummary();
      process.exit(1);
    }
  } catch (e: unknown) {
    record('readiness', 'FAIL', `Cannot reach ${BASE_URL}: ${e instanceof Error ? e.message : e}`);
    printSummary();
    process.exit(1);
  }

  let merchantId = '';
  try {
    const { status, data } = await post('/v1/merchants', {
      externalRef: SMOKE_EXT_REF,
      name: SMOKE_MERCHANT_NAME,
      currency: SMOKE_CURRENCY,
      sourceApp: SOURCE_APP,
    });
    if (status === 200 || status === 201) {
      merchantId = extractId((data as Record<string, unknown>)?.id);
      if (!merchantId) record('merchant', 'FAIL', `id missing from response: ${JSON.stringify(data)}`);
      else record('merchant', 'PASS', `id=${merchantId}`);
    } else {
      record('merchant', 'FAIL', `HTTP ${status}: ${JSON.stringify(data)}`);
    }
  } catch (e: unknown) {
    record('merchant', 'FAIL', String(e));
  }

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
          providerAccountRef: `smoke-pa-${Date.now()}`,
          environment: 'sandbox',
          sourceApp: SOURCE_APP,
        },
        merchantId,
      );
      if (status === 200 || status === 201) {
        providerAccountId = extractId((data as Record<string, unknown>)?.id);
        if (!providerAccountId) record('provider account', 'FAIL', `id missing from response: ${JSON.stringify(data)}`);
        else record('provider account', 'PASS', `id=${providerAccountId}`);
      } else {
        record('provider account', 'FAIL', `HTTP ${status}: ${JSON.stringify(data)}`);
      }
    } catch (e: unknown) {
      record('provider account', 'FAIL', String(e));
    }
  }

  // Payment method upsert must use PUT, not POST.
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
        record('payment method', 'PASS', `method=${SMOKE_METHOD} created=${(data as Record<string, unknown>)?.created}`);
      } else {
        record('payment method', 'FAIL', `HTTP ${status}: ${JSON.stringify(data)}`);
      }
    } catch (e: unknown) {
      record('payment method', 'FAIL', String(e));
    }
  }

  let intentId = '';
  if (!merchantId) {
    record('intent', 'FAIL', 'merchant not created');
  } else {
    try {
      const { status, data } = await post('/v1/payment-intents', {
        merchantId,
        sourceApp: SOURCE_APP,
        externalPayableType: 'smoke_order',
        externalPayableId: `smoke-order-${Date.now()}`,
        currency: SMOKE_CURRENCY,
        amountDue: SMOKE_AMOUNT,
        idempotencyKey: `smoke:${SMOKE_EXT_REF}:intent`,
      }, merchantId);
      if (status === 200 || status === 201) {
        intentId = extractId((data as Record<string, unknown>)?.id);
        if (!intentId) record('intent', 'FAIL', `id missing from response: ${JSON.stringify(data)}`);
        else record('intent', 'PASS', `id=${intentId}`);
      } else {
        record('intent', 'FAIL', `HTTP ${status}: ${JSON.stringify(data)}`);
      }
    } catch (e: unknown) {
      record('intent', 'FAIL', String(e));
    }
  }

  let transactionId = '';
  if (!intentId || !providerAccountId) {
    record('gateway payment', !intentId ? 'FAIL' : 'SKIP', !intentId ? 'intent not created' : 'no provider account');
  } else {
    try {
      const { status, data } = await post(`/v1/payment-intents/${intentId}/gateway-payments`, {
        merchantId,
        provider: SMOKE_PROVIDER,
        providerAccountId,
        method: SMOKE_METHOD,
        amount: SMOKE_AMOUNT,
        sourceApp: SOURCE_APP,
        idempotencyKey: `smoke:${SMOKE_EXT_REF}:payment`,
      }, merchantId);

      if (status === 200 || status === 201) {
        const gatewayPaymentData = data as { transaction?: { id?: string; status?: string }; intent?: { id?: string; status?: string } };
        transactionId = extractId(gatewayPaymentData.transaction?.id);
        if (!transactionId) {
          record('gateway payment', 'FAIL', `transaction.id missing from response: ${JSON.stringify(data)}`);
        } else {
          record('gateway payment', 'PASS', `txId=${transactionId} txStatus=${gatewayPaymentData.transaction?.status ?? '?'}`);
        }
      } else {
        record('gateway payment', 'FAIL', `HTTP ${status}: ${JSON.stringify(data)}`);
      }
    } catch (e: unknown) {
      record('gateway payment', 'FAIL', String(e));
    }
  }

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
      if (status === 200 || status === 201) record('fake confirm', 'PASS', `txId=${transactionId} confirmed`);
      else if (status === 404) record('fake confirm', 'SKIP', 'dev route absent (production)');
      else record('fake confirm', 'FAIL', `HTTP ${status}: ${JSON.stringify(data)}`);
    } catch (e: unknown) {
      record('fake confirm', 'FAIL', String(e));
    }
  }

  if (!intentId) {
    record('status', 'FAIL', 'intent not created');
  } else {
    try {
      const { status, data } = await get(`/v1/payment-intents/${intentId}/status`, merchantId);
      if (status === 200) {
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
          const latest = statusData.latestTransaction;
          const latestDetail = latest?.id ? ` latestTx=${latest.id}:${latest.status ?? '?'}` : '';
          record('status', 'PASS', `intent.status=${intentStatus} isTerminal=${statusData.isTerminal} requiresAction=${statusData.requiresAction}${latestDetail}`);
        }
      } else {
        record('status', 'FAIL', `HTTP ${status}`);
      }
    } catch (e: unknown) {
      record('status', 'FAIL', String(e));
    }
  }

  interface RefundableTx {
    transactionId: string;
    amount: number;
    amountAlreadyRefunded: number;
    amountRefundable: number;
    provider: string;
    method: string;
  }

  if (!intentId) {
    record('refund/void', 'SKIP', 'intent not created');
  } else {
    try {
      const { status, data } = await get(`/v1/payment-intents/${intentId}/refundability`, merchantId);
      if (status !== 200) {
        record('refund/void', 'SKIP', `refundability HTTP ${status}`);
      } else {
        const rData = data as { intentId?: string; totalRefundable?: number; currency?: string; transactions?: RefundableTx[] };
        const transactions = Array.isArray(rData?.transactions) ? rData.transactions : [];
        const totalRefundable = rData?.totalRefundable ?? 0;
        const candidate = transactions.find(t => typeof t.transactionId === 'string' && t.amountRefundable > 0);

        if (candidate && totalRefundable > 0) {
          const safeAmount = Math.min(candidate.amountRefundable, SMOKE_AMOUNT);
          try {
            const { status: rs, data: rd } = await post(`/v1/payment-transactions/${candidate.transactionId}/refund`, {
              transactionId: candidate.transactionId,
              merchantId,
              amount: safeAmount,
              reason: 'smoke_test',
              sourceApp: SOURCE_APP,
              idempotencyKey: `smoke:${SMOKE_EXT_REF}:refund`,
            }, merchantId);
            if (rs === 200 || rs === 201) record('refund/void', 'PASS', `refund accepted txId=${candidate.transactionId} amount=${safeAmount}`);
            else record('refund/void', 'SKIP', `refund HTTP ${rs}: ${JSON.stringify(rd)}`);
          } catch (e: unknown) {
            record('refund/void', 'SKIP', `refund error: ${String(e)}`);
          }
        } else if (transactionId) {
          try {
            const { status: vs } = await post(`/v1/payment-transactions/${transactionId}/void`, {
              transactionId,
              merchantId,
              sourceApp: SOURCE_APP,
              idempotencyKey: `smoke:${SMOKE_EXT_REF}:void`,
            }, merchantId);
            if (vs === 200 || vs === 201) record('refund/void', 'PASS', `void accepted txId=${transactionId}`);
            else record('refund/void', 'SKIP', `not refundable (totalRefundable=${totalRefundable}) and void HTTP ${vs}`);
          } catch (e: unknown) {
            record('refund/void', 'SKIP', `void error: ${String(e)}`);
          }
        } else {
          record('refund/void', 'SKIP', `no refundable transactions (totalRefundable=${totalRefundable})`);
        }
      }
    } catch (e: unknown) {
      record('refund/void', 'SKIP', String(e));
    }
  }

  try {
    const qs = merchantId ? `?merchantId=${encodeURIComponent(merchantId)}&limit=5` : '?limit=5';
    const { status, data } = await get(`/v1/audit-logs${qs}`);
    if (status === 200) {
      const auditData = data as { entries?: unknown[]; total?: number };
      const entries = Array.isArray(auditData?.entries) ? auditData.entries : [];
      record('audit log', 'PASS', `${entries.length} entries (total=${auditData?.total ?? entries.length})`);
    } else if (status === 403) {
      record('audit log', 'SKIP', 'credential missing audit_log:read scope');
    } else {
      record('audit log', 'SKIP', `HTTP ${status}`);
    }
  } catch (e: unknown) {
    record('audit log', 'SKIP', String(e));
  }

  if (!SMOKE_WEBHOOK_URL) {
    record('webhook', 'SKIP', 'NORTHFLOW_SMOKE_WEBHOOK_URL not set');
  } else if (!merchantId) {
    record('webhook', 'SKIP', 'merchant not created');
  } else {
    try {
      const { status, data } = await post(`/v1/merchants/${merchantId}/webhooks/endpoints`, {
        url: SMOKE_WEBHOOK_URL,
        subscribedEvents: ['payment_intent.paid', 'payment_intent.failed'],
      }, merchantId);
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
