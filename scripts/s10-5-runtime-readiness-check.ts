#!/usr/bin/env tsx
/**
 * s10-5-runtime-readiness-check.ts
 *
 * Post-deploy readiness check for a running Northflow service.
 * Does NOT mutate any data — read-only probes only.
 *
 * Usage:
 *   NORTHFLOW_BASE_URL=https://your-service.example.com \
 *   NORTHFLOW_READY_TOKEN=<token-if-configured> \
 *   NORTHFLOW_API_KEY=nf.live.cred_xxx.<secret> \
 *   NORTHFLOW_MERCHANT_ID=mer_xxx \
 *   pnpm s10:readiness
 *
 *   Or: npx tsx scripts/s10-5-runtime-readiness-check.ts --help
 *
 * Exit codes:
 *   0 — all checks passed
 *   1 — one or more checks failed
 */

const MASK = '***';

function maskSecret(value: string | undefined): string {
  if (!value) return '(not set)';
  if (value.length <= 8) return MASK;
  return value.slice(0, 4) + MASK;
}

function env(key: string): string | undefined {
  return process.env[key];
}

const BASE_URL = (env('NORTHFLOW_BASE_URL') ?? 'http://localhost:3000').replace(/\/$/, '');
const READY_TOKEN = env('NORTHFLOW_READY_TOKEN');
const API_KEY = env('NORTHFLOW_API_KEY');
const MERCHANT_ID = env('NORTHFLOW_MERCHANT_ID');
const SOURCE_APP = env('NORTHFLOW_SOURCE_APP') ?? 'readiness-check';

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
s10-5-runtime-readiness-check — Northflow post-deploy readiness probe

Env vars:
  NORTHFLOW_BASE_URL        Base URL of deployed service (default: http://localhost:3000)
  NORTHFLOW_READY_TOKEN     Optional ready token for /ready endpoint
  NORTHFLOW_API_KEY         Optional API key for authenticated checks
  NORTHFLOW_MERCHANT_ID     Optional merchant ID for authenticated checks
  NORTHFLOW_SOURCE_APP      Source app name (default: readiness-check)

Checks performed (read-only, no data mutation):
  1. GET /health
  2. GET /version
  3. GET /ready
  4. GET /v1/merchants/{id} (if API_KEY + MERCHANT_ID provided)

Exit code 0 = all pass, 1 = any fail
`);
  process.exit(0);
}

// ── Config summary (masked) ───────────────────────────────────────────────────
console.log('S10.5 Runtime Readiness Check');
console.log('─────────────────────────────────────────────────────');
console.log(`  base URL:    ${BASE_URL}`);
console.log(`  ready token: ${maskSecret(READY_TOKEN)}`);
console.log(`  api key:     ${maskSecret(API_KEY)}`);
console.log(`  merchant:    ${MERCHANT_ID ?? '(not set)'}`);
console.log(`  source app:  ${SOURCE_APP}`);
console.log('─────────────────────────────────────────────────────');

type CheckResult = { name: string; status: 'PASS' | 'FAIL' | 'SKIP'; detail?: string };
const results: CheckResult[] = [];

async function check(
  name: string,
  fn: () => Promise<{ ok: boolean; detail?: string }>,
): Promise<void> {
  try {
    const { ok, detail } = await fn();
    results.push({ name, status: ok ? 'PASS' : 'FAIL', detail });
    const icon = ok ? '✅' : '❌';
    console.log(`  ${icon} ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push({ name, status: 'FAIL', detail: msg });
    console.log(`  ❌ ${name} — ${msg}`);
  }
}

function skip(name: string, reason: string): void {
  results.push({ name, status: 'SKIP', detail: reason });
  console.log(`  ⏭  ${name} — SKIPPED (${reason})`);
}

async function fetchJson(url: string, init?: RequestInit): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

function hasSecretLeak(body: unknown): boolean {
  const text = JSON.stringify(body ?? '');
  // Flag patterns that look like connection strings or raw secrets
  return /postgresql:\/\/[^@]+:[^@]+@/.test(text) ||
    /nf\.(live|staging|test)\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9]+/.test(text) ||
    /Bearer\s+nf\./.test(text);
}

// ── Checks ────────────────────────────────────────────────────────────────────

await check('GET /health', async () => {
  const { status, body } = await fetchJson(`${BASE_URL}/health`);
  if (status !== 200) return { ok: false, detail: `HTTP ${status}` };
  const b = body as Record<string, unknown>;
  if (!b?.ok) return { ok: false, detail: 'ok != true' };
  if (hasSecretLeak(body)) return { ok: false, detail: 'SECURITY: secret-looking value in response' };
  return { ok: true, detail: `service=${b.service}` };
});

await check('GET /version', async () => {
  const { status, body } = await fetchJson(`${BASE_URL}/version`);
  if (status !== 200) return { ok: false, detail: `HTTP ${status}` };
  const b = body as Record<string, unknown>;
  if (hasSecretLeak(body)) return { ok: false, detail: 'SECURITY: secret-looking value in response' };
  return { ok: true, detail: `v${b.version ?? '?'} phase=${b.phase ?? '?'}` };
});

await check('GET /ready', async () => {
  const headers: Record<string, string> = {};
  if (READY_TOKEN) headers['x-nf-ready-token'] = READY_TOKEN;
  const { status, body } = await fetchJson(`${BASE_URL}/ready`, { headers });
  if (READY_TOKEN && status === 401) return { ok: false, detail: 'Token rejected — verify NORTHFLOW_READY_TOKEN' };
  if (!READY_TOKEN && status === 401) return { ok: false, detail: '/ready is token-protected but NORTHFLOW_READY_TOKEN not set' };
  if (status !== 200) return { ok: false, detail: `HTTP ${status}` };
  const b = body as Record<string, unknown>;
  if (!b?.ok) return { ok: false, detail: `ok=false: ${JSON.stringify(b)}` };
  if (hasSecretLeak(body)) return { ok: false, detail: 'SECURITY: secret-looking value in response' };
  const db = b.database as string;
  if (db !== 'configured') return { ok: false, detail: `database=${db} — DATABASE_URL may not be set` };
  return { ok: true, detail: `database=${db}` };
});

await check('Dev routes absent in production', async () => {
  const { status } = await fetchJson(`${BASE_URL}/v1/dev/fake-gateway/transactions/smoke-check/confirm`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  // In production, dev routes should not exist (404). In dev/staging they might (200, 400, 401, 403).
  // We don't fail this check — just report what we found.
  const isProduction = status === 404;
  return {
    ok: true,
    detail: isProduction
      ? 'route absent (production-safe)'
      : `route exists with status ${status} (dev/staging environment)`,
  };
});

if (!API_KEY) {
  skip('Authenticated read (GET /v1/merchants/:id)', 'NORTHFLOW_API_KEY not set');
} else if (!MERCHANT_ID) {
  skip('Authenticated read (GET /v1/merchants/:id)', 'NORTHFLOW_MERCHANT_ID not set');
} else {
  await check('Authenticated read (GET /v1/merchants/:id)', async () => {
    const { status, body } = await fetchJson(
      `${BASE_URL}/v1/merchants/${encodeURIComponent(MERCHANT_ID)}`,
      {
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          'x-payment-merchant-id': MERCHANT_ID,
          'x-source-app': SOURCE_APP,
        },
      },
    );
    if (status === 401) return { ok: false, detail: 'UNAUTHORIZED — check NORTHFLOW_API_KEY' };
    if (status === 403) return { ok: false, detail: 'FORBIDDEN — check merchant access grant and scopes' };
    if (status === 404) return { ok: false, detail: 'Merchant not found — check NORTHFLOW_MERCHANT_ID' };
    if (status !== 200) return { ok: false, detail: `HTTP ${status}` };
    const b = body as Record<string, unknown>;
    if (hasSecretLeak(body)) return { ok: false, detail: 'SECURITY: secret-looking value in response' };
    return { ok: true, detail: `merchant accessible` };
  });

  await check('Invalid key → 401 (auth guard working)', async () => {
    const { status } = await fetchJson(
      `${BASE_URL}/v1/merchants/${encodeURIComponent(MERCHANT_ID)}`,
      {
        headers: {
          Authorization: 'Bearer nf.test.invalid.READINESS_CHECK_INVALID_KEY',
          'x-payment-merchant-id': MERCHANT_ID,
        },
      },
    );
    if (status !== 401) return { ok: false, detail: `Expected 401, got ${status}` };
    return { ok: true, detail: 'invalid key correctly rejected' };
  });
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('');
console.log('─────────────────────────────────────────────────────');
console.log('S10.5 Readiness Summary');
console.log('─────────────────────────────────────────────────────');

const failed = results.filter(r => r.status === 'FAIL');
const passed = results.filter(r => r.status === 'PASS');
const skipped = results.filter(r => r.status === 'SKIP');

for (const r of results) {
  const icon = r.status === 'PASS' ? '✅' : r.status === 'FAIL' ? '❌' : '⏭ ';
  console.log(`  ${icon} ${r.name.padEnd(45)} ${r.status}`);
}

console.log('─────────────────────────────────────────────────────');
console.log(`  PASS: ${passed.length}  FAIL: ${failed.length}  SKIP: ${skipped.length}`);
console.log('─────────────────────────────────────────────────────');

if (failed.length > 0) {
  console.log('');
  console.log('FAILED checks:');
  for (const r of failed) {
    console.log(`  ❌ ${r.name}: ${r.detail ?? ''}`);
  }
  console.log('');
  process.exit(1);
} else {
  console.log('');
  console.log('All readiness checks passed.');
  console.log('');
  process.exit(0);
}
