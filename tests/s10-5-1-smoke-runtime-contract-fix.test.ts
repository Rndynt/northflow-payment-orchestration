/**
 * s10-5-1-smoke-runtime-contract-fix.test.ts
 *
 * Asserts all S10.5.1 runtime contract fixes are present in the smoke script.
 * Static source analysis — no service boot required.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const smoke = readFileSync(join(root, 'scripts/s10-5-bootstrap-smoke.ts'), 'utf8');
const readiness = readFileSync(join(root, 'scripts/s10-5-runtime-readiness-check.ts'), 'utf8');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};

// ── Assertion 1: Smoke script exports / defines a PUT helper ─────────────────
describe('S10.5.1 fix 1 — PUT helper exists', () => {

  it('F1a: script defines a put() function', () => {
    assert.ok(
      smoke.includes('function put(') || smoke.match(/put\s*=\s*(async\s*)?\(/),
      'put() helper not found',
    );
  });

  it('F1b: put() calls request() or fetch() with method PUT', () => {
    assert.ok(
      smoke.includes("'PUT'") || smoke.includes('"PUT"'),
      "PUT method string not found in smoke script",
    );
  });

  it('F1c: request() helper supports GET, POST and PUT methods', () => {
    assert.ok(smoke.includes("'GET'") || smoke.includes('"GET"'), 'GET missing');
    assert.ok(smoke.includes("'POST'") || smoke.includes('"POST"'), 'POST missing');
    assert.ok(smoke.includes("'PUT'") || smoke.includes('"PUT"'), 'PUT missing');
  });
});

// ── Assertion 2: Payment method upsert uses PUT ───────────────────────────────
describe('S10.5.1 fix 2 — Payment method upsert uses PUT', () => {

  it('F2a: PUT is used on the /methods/{method} route', () => {
    // Check that put() is called with the methods path
    const methodsRoutePattern = /put\s*\(\s*[`'"].*\/methods\/\$\{SMOKE_METHOD\}/;
    assert.ok(
      methodsRoutePattern.test(smoke),
      'put() must be called with /methods/${SMOKE_METHOD} path',
    );
  });

  it('F2b: POST is NOT used for the payment method upsert route', () => {
    // Extract the payment method upsert section — between "Upsert payment method" and next step
    const upsertSection = smoke.match(/Step 4[\s\S]*?Step 5/)?.[0] ?? '';
    assert.ok(
      !upsertSection.match(/\bpost\s*\(/),
      'post() must not be used for payment method upsert — use put()',
    );
  });

  it('F2c: upsert route path contains /methods/ and the method variable', () => {
    assert.ok(
      smoke.includes('/methods/${SMOKE_METHOD}') ||
      smoke.includes("/methods/'") ||
      smoke.includes('/methods/`'),
      'upsert route must target /methods/{method}',
    );
  });
});

// ── Assertion 3: Status parsed from intent.status ────────────────────────────
describe('S10.5.1 fix 3 — Status parsing from intent.status', () => {

  it('F3a: script reads statusData.intent?.status (not data.status)', () => {
    assert.ok(
      smoke.includes('intent?.status') || smoke.includes('intent.status'),
      'status must be read from intent.status, not top-level data.status',
    );
  });

  it('F3b: script does NOT read status from top-level data (must use intent.status)', () => {
    // Extract the status step section
    const statusSection = smoke.match(/Step 8[\s\S]*?Step 9/)?.[0] ?? '';
    // The cast `data as { status: ... }` at top level is wrong.
    // The correct form is `data as { intent?: { status?:... } }`
    // Ensure the section reads from intent.status, not a top-level .status
    assert.ok(
      !statusSection.match(/\(data as\s*\{[^}]*\bstatus\b[^}]*\}[^.]*\)\.status/),
      'status must not be accessed directly from (data as { status }).status',
    );
    // Positive: intent.status access must be present
    assert.ok(
      statusSection.includes('intent?.status') || statusSection.includes('intent.status'),
      'intent.status access must be present in status section',
    );
  });

  it('F3c: type annotation for statusData includes intent field with status', () => {
    assert.ok(
      smoke.includes('intent?: { id?: string; status?: string }') ||
      smoke.includes('intent?:') && smoke.includes('status?: string'),
      'statusData type must include intent.status field',
    );
  });

  it('F3d: failure message when intent.status is missing', () => {
    assert.ok(
      smoke.includes('intent.status missing') || smoke.includes('intentStatus'),
      'script must fail clearly when intent.status is absent',
    );
  });
});

// ── Assertion 4: Refundability parsed from actual contract ───────────────────
describe('S10.5.1 fix 4 — Refundability parsing uses actual contract', () => {

  it('F4a: reads transactions array from refundability data', () => {
    assert.ok(
      smoke.includes('transactions') && smoke.includes('amountRefundable'),
      'refundability must read transactions[].amountRefundable',
    );
  });

  it('F4b: does NOT rely on fictional .refundable boolean on top-level data', () => {
    const refSection = smoke.match(/Step 9[\s\S]*?Step 10/)?.[0] ?? '';
    // Should not have patterns like r.refundable or data.refundable
    assert.ok(
      !refSection.match(/\br\.refundable\b/) &&
      !refSection.match(/data\.refundable\b/),
      'script must not read fictional r.refundable top-level boolean',
    );
  });

  it('F4c: does NOT rely on fictional .voidable boolean on top-level data', () => {
    const refSection = smoke.match(/Step 9[\s\S]*?Step 10/)?.[0] ?? '';
    assert.ok(
      !refSection.match(/\br\.voidable\b/) &&
      !refSection.match(/data\.voidable\b/),
      'script must not read fictional r.voidable top-level boolean',
    );
  });

  it('F4d: uses totalRefundable to decide whether refund is applicable', () => {
    assert.ok(
      smoke.includes('totalRefundable'),
      'script must read totalRefundable from refundability response',
    );
  });

  it('F4e: selects refundable candidate from transactions array', () => {
    assert.ok(
      smoke.includes('transactions.find') || smoke.includes('.find('),
      'script must find a candidate transaction from transactions array',
    );
  });

  it('F4f: refund uses candidate.transactionId (not raw transactionId)', () => {
    const refSection = smoke.match(/Step 9[\s\S]*?Step 10/)?.[0] ?? '';
    assert.ok(
      refSection.includes('candidate.transactionId') || refSection.includes('candidate?.transactionId'),
      'refund must use the transactionId from the candidate transaction',
    );
  });

  it('F4g: safe amount uses Math.min on amountRefundable', () => {
    assert.ok(
      smoke.includes('Math.min') && smoke.includes('amountRefundable'),
      'refund amount must be capped at amountRefundable with Math.min',
    );
  });

  it('F4h: refund/void step does not crash on unknown refundability shape', () => {
    // Defensive: checks for Array.isArray before accessing transactions
    assert.ok(
      smoke.includes('Array.isArray') && smoke.includes('transactions'),
      'refundability parsing must be defensive with Array.isArray check',
    );
  });

  it('F4i: SKIP with clear reason when not refundable', () => {
    assert.ok(
      smoke.includes('totalRefundable=0') ||
      smoke.includes('totalRefundable=${totalRefundable}') ||
      smoke.match(/totalRefundable.*SKIP/s) ||
      smoke.match(/SKIP.*totalRefundable/s),
      'must SKIP with clear reason including totalRefundable when nothing to refund',
    );
  });
});

// ── Assertion 5: Audit log parsed from data.entries ──────────────────────────
describe('S10.5.1 fix 5 — Audit log parsing uses data.entries', () => {

  it('F5a: reads entries array from audit log data', () => {
    assert.ok(
      smoke.includes('entries') && smoke.includes('auditData'),
      'audit log parsing must read auditData.entries',
    );
  });

  it('F5b: does NOT cast audit data directly as unknown[] array', () => {
    const auditSection = smoke.match(/Step 10[\s\S]*?Step 11/)?.[0] ?? '';
    assert.ok(
      !auditSection.includes('data as unknown[]'),
      'audit data must not be cast directly as unknown[]',
    );
  });

  it('F5c: uses Array.isArray on entries', () => {
    assert.ok(
      smoke.includes('Array.isArray(auditData') ||
      smoke.includes('Array.isArray(auditData?.entries'),
      'must use Array.isArray check on entries',
    );
  });

  it('F5d: SKIP with clear message when credential lacks audit permission (403)', () => {
    assert.ok(
      smoke.includes('audit_log:read') || smoke.includes('audit permission'),
      'must SKIP clearly when 403 from audit log endpoint',
    );
  });
});

// ── Assertion 6: Sensitive values masked ─────────────────────────────────────
describe('S10.5.1 fix 6 — Sensitive values masked', () => {

  it('F6a: maskSecret() function exists', () => {
    assert.ok(smoke.includes('function maskSecret'), 'maskSecret function missing');
  });

  it('F6b: API_KEY printed via maskSecret, not directly', () => {
    assert.ok(
      smoke.includes('maskSecret(API_KEY)'),
      'API_KEY must be printed via maskSecret()',
    );
    assert.ok(
      !smoke.match(/console\.log\s*\(\s*API_KEY\s*\)/),
      'API_KEY must not be logged directly',
    );
  });

  it('F6c: rawSecret not logged in webhook step', () => {
    const webhookSection = smoke.match(/Step 11[\s\S]*$/)?.[0] ?? '';
    assert.ok(
      !webhookSection.includes('console.log') ||
      webhookSection.includes('masked') ||
      webhookSection.includes('rawSecret intentionally not logged'),
      'rawSecret must not be logged in webhook step',
    );
  });
});

// ── Assertion 7: Provider codes unchanged ────────────────────────────────────
describe('S10.5.1 fix 7 — Provider codes unchanged', () => {

  it('F7a: fake_gateway default provider code present', () => {
    assert.ok(smoke.includes('fake_gateway'), 'fake_gateway provider code must be present');
  });

  it('F7b: xendit_sandbox provider code mentioned in docs', () => {
    const deployment = readFileSync(
      join(root, 'docs/deployment/bootstrap-operator-guide.md'), 'utf8',
    );
    assert.ok(deployment.includes('xendit_sandbox'), 'xendit_sandbox must remain in operator guide');
  });

  it('F7c: provider codes in service source unchanged', () => {
    const fakeHandler = readFileSync(
      join(root, 'apps/service/src/infrastructure/providers/FakeGatewayWebhookHandler.ts'),
      'utf8',
    );
    const xenditProvider = readFileSync(
      join(root, 'apps/service/src/infrastructure/providers/XenditSandboxProvider.ts'),
      'utf8',
    );
    assert.ok(fakeHandler.includes('fake_gateway'), 'fake_gateway code must be in FakeGatewayWebhookHandler');
    assert.ok(xenditProvider.includes('xendit_sandbox'), 'xendit_sandbox code must be in XenditSandboxProvider');
  });
});

// ── Assertion 8: --help flags still work ─────────────────────────────────────
describe('S10.5.1 fix 8 — --help flags present', () => {

  it('F8a: pnpm s10:readiness in package.json', () => {
    assert.ok('s10:readiness' in pkg.scripts, 's10:readiness missing from package.json');
  });

  it('F8b: pnpm s10:smoke in package.json', () => {
    assert.ok('s10:smoke' in pkg.scripts, 's10:smoke missing from package.json');
  });

  it('F8c: smoke script has --help handler', () => {
    assert.ok(smoke.includes('--help'), '--help flag missing from smoke script');
  });

  it('F8d: readiness script has --help handler', () => {
    assert.ok(readiness.includes('--help'), '--help flag missing from readiness script');
  });
});

// ── Assertion 9: request() helper contract ───────────────────────────────────
describe('S10.5.1 fix 9 — request() helper contract', () => {

  it('F9a: sends Authorization: Bearer header', () => {
    assert.ok(
      smoke.includes('Authorization') && smoke.includes('Bearer'),
      'request helper must send Authorization: Bearer header',
    );
  });

  it('F9b: sends x-source-app header', () => {
    assert.ok(smoke.includes('x-source-app'), 'request helper must send x-source-app header');
  });

  it('F9c: sends x-payment-merchant-id when merchantId present', () => {
    assert.ok(
      smoke.includes('x-payment-merchant-id'),
      'request helper must send x-payment-merchant-id header',
    );
  });

  it('F9d: unwraps { ok: true, data: X } envelope', () => {
    assert.ok(
      smoke.includes("envelope?.ok === true") || smoke.includes("ok === true"),
      'request helper must unwrap { ok:true, data } envelope',
    );
  });

  it('F9e: GET sends no body', () => {
    // The get() helper wrapper should call request with undefined body
    assert.ok(
      smoke.includes("request('GET', path, undefined") ||
      smoke.match(/get\s*\([^)]+\)\s*\{?\s*\n?\s*return request\('GET'/),
      'GET helper must send no body (undefined)',
    );
  });
});
