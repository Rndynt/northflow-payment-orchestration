/**
 * s10-5-1-smoke-runtime-contract-fix.test.ts
 *
 * Static assertions verifying all S10.5.1 runtime contract fixes in smoke script.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const smoke = readFileSync(join(root, 'scripts/s10-5-bootstrap-smoke.ts'), 'utf8');
const readiness = readFileSync(join(root, 'scripts/s10-5-runtime-readiness-check.ts'), 'utf8');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> };

describe('S10.5.1 Fix 1 — PUT helper exists', () => {
  it('F1a: put() function defined', () => {
    assert.ok(smoke.includes('function put('), 'put() helper not found');
  });
  it('F1b: request() supports GET POST PUT', () => {
    assert.ok(smoke.includes("'GET'") && smoke.includes("'POST'") && smoke.includes("'PUT'"));
  });
});

describe('S10.5.1 Fix 2 — Payment method upsert uses PUT', () => {
  it('F2a: put() called on /methods/${SMOKE_METHOD}', () => {
    assert.ok(/put\s*\(\s*`[^`]*\/methods\/\$\{SMOKE_METHOD\}/.test(smoke), 'put() must target /methods/${SMOKE_METHOD}');
  });
  it('F2b: step 4 comment section uses put not post', () => {
    const step4 = smoke.match(/\/\/ ── Step 4:[\s\S]*?\/\/ ── Step 5:/)?.[0] ?? '';
    assert.ok(step4.length > 0, 'Step 4 section not found');
    assert.ok(!step4.match(/\bpost\s*\(\s*`[^`]*\/methods\//), 'post() must not be used for /methods/ upsert in step 4');
  });
});

describe('S10.5.1 Fix 3 — Status from intent.status', () => {
  it('F3a: reads intent?.status', () => {
    assert.ok(smoke.includes('intent?.status') || smoke.includes('intent.status'));
  });
  it('F3b: has type annotation with intent field', () => {
    assert.ok(smoke.includes('intent?:') && smoke.includes('status?: string'));
  });
  it('F3c: fails clearly when intent.status absent', () => {
    assert.ok(smoke.includes('intent.status missing'));
  });
});

describe('S10.5.1 Fix 3b — Gateway payment transaction response', () => {
  const step6 = smoke.match(/Step 6:[\s\S]*?Step 7:/)?.[0] ?? '';

  it('F3b.1: step 6 section exists', () => {
    assert.ok(step6.length > 0, 'Step 6 gateway payment section not found');
  });

  it('F3b.2: reads transaction id from data.transaction.id', () => {
    assert.ok(
      step6.includes('gatewayPaymentData.transaction?.id'),
      'gateway payment transaction id must be parsed from data.transaction.id',
    );
  });

  it('F3b.3: fails clearly when transaction.id is missing', () => {
    assert.ok(step6.includes('transaction.id missing'), 'missing transaction.id must be a FAIL condition');
  });

  it('F3b.4: does not parse gateway payment transaction id from top-level data.id', () => {
    assert.ok(
      !step6.includes("(data as Record<string, unknown>)?.id"),
      'gateway payment must not parse transactionId from top-level data.id',
    );
  });
});

describe('S10.5.1 Fix 4 — Refundability uses actual contract', () => {
  it('F4a: reads transactions array and amountRefundable', () => {
    assert.ok(smoke.includes('transactions') && smoke.includes('amountRefundable'));
  });
  it('F4b: no fictional r.refundable boolean', () => {
    const s = smoke.match(/Step 9[\s\S]*?Step 10/)?.[0] ?? '';
    assert.ok(!s.match(/\br\.refundable\b/));
  });
  it('F4c: no fictional r.voidable boolean', () => {
    const s = smoke.match(/Step 9[\s\S]*?Step 10/)?.[0] ?? '';
    assert.ok(!s.match(/\br\.voidable\b/));
  });
  it('F4d: uses totalRefundable', () => {
    assert.ok(smoke.includes('totalRefundable'));
  });
  it('F4e: uses transactions.find', () => {
    assert.ok(smoke.includes('transactions.find'));
  });
  it('F4f: uses Math.min on amountRefundable', () => {
    assert.ok(smoke.includes('Math.min') && smoke.includes('amountRefundable'));
  });
  it('F4g: Array.isArray guard on transactions', () => {
    assert.ok(smoke.includes('Array.isArray') && smoke.includes('transactions'));
  });
  it('F4h: SKIP with totalRefundable value when nothing to refund', () => {
    assert.ok(smoke.includes('totalRefundable='));
  });
});

describe('S10.5.1 Fix 5 — Audit log from data.entries', () => {
  it('F5a: reads auditData.entries', () => {
    assert.ok(smoke.includes('auditData') && smoke.includes('entries'));
  });
  it('F5b: does not cast data directly as unknown[]', () => {
    const s = smoke.match(/Step 10[\s\S]*?Step 11/)?.[0] ?? '';
    assert.ok(!s.includes('data as unknown[]'));
  });
  it('F5c: Array.isArray on entries', () => {
    assert.ok(smoke.includes('Array.isArray(auditData'));
  });
});

describe('S10.5.1 Fix 6 — IIFE wrapping for CJS compat', () => {
  it('F6a: smoke script uses void (async IIFE', () => {
    assert.ok(smoke.includes('void (async ()'));
  });
  it('F6b: readiness script uses void (async IIFE', () => {
    assert.ok(readiness.includes('void (async ()'));
  });
});

describe('S10.5.1 Fix 7 — Secrets masked', () => {
  it('F7a: maskSecret function present', () => {
    assert.ok(smoke.includes('function maskSecret'));
  });
  it('F7b: API_KEY printed via maskSecret', () => {
    assert.ok(smoke.includes('maskSecret(API_KEY)'));
    assert.ok(!smoke.match(/console\.log\s*\(\s*API_KEY\s*\)/));
  });
  it('F7c: rawSecret not logged in webhook step', () => {
    assert.ok(smoke.includes('rawSecret intentionally not logged'));
  });
});

describe('S10.5.1 Fix 8 — Package scripts', () => {
  it('F8a: s10:readiness present', () => {
    assert.ok('s10:readiness' in pkg.scripts);
  });
  it('F8b: s10:smoke present', () => {
    assert.ok('s10:smoke' in pkg.scripts);
  });
  it('F8c: smoke --help flag', () => {
    assert.ok(smoke.includes('--help'));
  });
  it('F8d: readiness --help flag', () => {
    assert.ok(readiness.includes('--help'));
  });
});

describe('S10.5.1 Fix 9 — request() helper contract', () => {
  it('F9a: Authorization Bearer header', () => {
    assert.ok(smoke.includes('Authorization') && smoke.includes('Bearer'));
  });
  it('F9b: x-source-app header', () => {
    assert.ok(smoke.includes('x-source-app'));
  });
  it('F9c: x-payment-merchant-id header', () => {
    assert.ok(smoke.includes('x-payment-merchant-id'));
  });
  it('F9d: unwraps ok:true data envelope', () => {
    assert.ok(smoke.includes('envelope?.ok === true'));
  });
  it('F9e: GET passes undefined body', () => {
    assert.ok(smoke.includes("request('GET', path, undefined"));
  });
});

describe('S10.5.1 Fix 10 — Provider codes unchanged', () => {
  it('F10a: fake_gateway default', () => {
    assert.ok(smoke.includes('fake_gateway'));
  });
  it('F10b: fake_gateway in service source', () => {
    const src = readFileSync(join(root, 'apps/service/src/infrastructure/providers/FakeGatewayWebhookHandler.ts'), 'utf8');
    assert.ok(src.includes('fake_gateway'));
  });
  it('F10c: xendit_sandbox in service source', () => {
    const src = readFileSync(join(root, 'apps/service/src/infrastructure/providers/XenditSandboxProvider.ts'), 'utf8');
    assert.ok(src.includes('xendit_sandbox'));
  });
  it('F10d: no hardcoded real credentials in scripts', () => {
    assert.ok(!/nf\.(live|staging)\.[a-zA-Z0-9_-]{4,}\.[a-zA-Z0-9]{20,}/.test(smoke));
    assert.ok(!/nf\.(live|staging)\.[a-zA-Z0-9_-]{4,}\.[a-zA-Z0-9]{20,}/.test(readiness));
  });
});
