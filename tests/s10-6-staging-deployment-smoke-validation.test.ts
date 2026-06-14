/**
 * s10-6-staging-deployment-smoke-validation.test.ts
 *
 * Static assertions verifying all S10.6 staging deployment artifacts exist
 * and are internally consistent. No service boot required.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');
const exists = (rel: string) => existsSync(join(root, rel));
const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
const smoke = read('scripts/s10-5-bootstrap-smoke.ts');
const readiness = read('scripts/s10-5-runtime-readiness-check.ts');

// ── T01: Staging runbook ──────────────────────────────────────────────────────
describe('S10.6 T01 — Staging runbook', () => {
  it('T01a: docs/deployment/staging-runtime-smoke-runbook.md exists', () => {
    assert.ok(exists('docs/deployment/staging-runtime-smoke-runbook.md'));
  });

  it('T01b: runbook references pnpm s10:readiness', () => {
    assert.ok(read('docs/deployment/staging-runtime-smoke-runbook.md').includes('s10:readiness'));
  });

  it('T01c: runbook references pnpm s10:smoke', () => {
    assert.ok(read('docs/deployment/staging-runtime-smoke-runbook.md').includes('s10:smoke'));
  });

  it('T01d: runbook defines gate criteria before production promotion', () => {
    const doc = read('docs/deployment/staging-runtime-smoke-runbook.md');
    assert.ok(
      doc.toLowerCase().includes('production') &&
      (doc.toLowerCase().includes('gate') || doc.toLowerCase().includes('promote') || doc.toLowerCase().includes('promot')),
    );
  });

  it('T01e: runbook references readiness check step', () => {
    const doc = read('docs/deployment/staging-runtime-smoke-runbook.md');
    assert.ok(doc.includes('/health') && doc.includes('/ready'));
  });

  it('T01f: runbook defines rollback trigger', () => {
    assert.ok(read('docs/deployment/staging-runtime-smoke-runbook.md').toLowerCase().includes('rollback'));
  });

  it('T01g: runbook documents SKIP policy', () => {
    const doc = read('docs/deployment/staging-runtime-smoke-runbook.md');
    assert.ok(doc.includes('SKIP') && doc.includes('FAIL'));
  });

  it('T01h: runbook does not reference dashboard as required', () => {
    assert.ok(!read('docs/deployment/staging-runtime-smoke-runbook.md').includes('deploy dashboard'));
  });
});

// ── T02: Staging env template ─────────────────────────────────────────────────
describe('S10.6 T02 — Staging env template', () => {
  it('T02a: docs/deployment/staging-env-template.md exists', () => {
    assert.ok(exists('docs/deployment/staging-env-template.md'));
  });

  it('T02b: uses actual env var names from config/env.ts', () => {
    const doc = read('docs/deployment/staging-env-template.md');
    const required = [
      'DATABASE_URL',
      'NODE_ENV',
      'PAYMENT_ORCHESTRATION_LEGACY_SERVICE_TOKEN_ENABLED',
      'PAYMENT_ORCHESTRATION_SIGNED_REQUESTS_MODE',
      'PAYMENT_ORCHESTRATION_RATE_LIMIT_ENABLED',
      'PAYMENT_ORCHESTRATION_CORS_ENABLED',
      'PAYMENT_ORCHESTRATION_TRUST_PROXY',
      'PAYMENT_ORCHESTRATION_READY_TOKEN',
      'PAYMENT_ORCHESTRATION_XENDIT_SANDBOX_ENABLED',
      'PAYMENT_ORCHESTRATION_OUTBOUND_WEBHOOKS_ENABLED',
    ];
    const missing = required.filter(v => !doc.includes(v));
    assert.deepEqual(missing, [], `Missing env vars in staging template: ${missing.join(', ')}`);
  });

  it('T02c: documents smoke script env vars', () => {
    const doc = read('docs/deployment/staging-env-template.md');
    assert.ok(doc.includes('NORTHFLOW_BASE_URL'));
    assert.ok(doc.includes('NORTHFLOW_API_KEY'));
    assert.ok(doc.includes('NORTHFLOW_SMOKE_PROVIDER'));
  });

  it('T02d: notes staging vs production differences', () => {
    const doc = read('docs/deployment/staging-env-template.md');
    assert.ok(doc.toLowerCase().includes('production') && doc.toLowerCase().includes('staging'));
  });

  it('T02e: does not contain hardcoded real secrets', () => {
    const doc = read('docs/deployment/staging-env-template.md');
    assert.ok(!/nf\.(live|staging)\.[a-zA-Z0-9_-]{4,}\.[a-zA-Z0-9]{20,}/.test(doc));
    assert.ok(!/postgresql:\/\/[^<{][^@]+:[^<{][^@]+@/.test(doc));
  });

  it('T02f: includes secret handling rules', () => {
    const doc = read('docs/deployment/staging-env-template.md');
    assert.ok(doc.toLowerCase().includes('secret') && doc.toLowerCase().includes('never'));
  });
});

// ── T03: Staging smoke commands ───────────────────────────────────────────────
describe('S10.6 T03 — Staging smoke commands reference', () => {
  it('T03a: docs/deployment/staging-smoke-commands.md exists', () => {
    assert.ok(exists('docs/deployment/staging-smoke-commands.md'));
  });

  it('T03b: documents pnpm s10:readiness command', () => {
    assert.ok(read('docs/deployment/staging-smoke-commands.md').includes('s10:readiness'));
  });

  it('T03c: documents pnpm s10:smoke command', () => {
    assert.ok(read('docs/deployment/staging-smoke-commands.md').includes('s10:smoke'));
  });

  it('T03d: documents manual curl health probes', () => {
    const doc = read('docs/deployment/staging-smoke-commands.md');
    assert.ok(doc.includes('curl') && doc.includes('/health'));
  });

  it('T03e: documents auth guard spot-checks (401, 403)', () => {
    const doc = read('docs/deployment/staging-smoke-commands.md');
    assert.ok(doc.includes('401') && doc.includes('403'));
  });

  it('T03f: documents SKIP policy table', () => {
    const doc = read('docs/deployment/staging-smoke-commands.md');
    assert.ok(doc.includes('SKIP') && doc.includes('audit log'));
  });

  it('T03g: documents acceptable SKIP reasons for each skippable check', () => {
    const doc = read('docs/deployment/staging-smoke-commands.md');
    assert.ok(doc.includes('audit log') && doc.includes('webhook') && doc.includes('fake confirm'));
  });

  it('T03h: documents must-PASS checks', () => {
    const doc = read('docs/deployment/staging-smoke-commands.md');
    assert.ok(doc.includes('merchant') && doc.includes('intent') && doc.includes('status'));
  });

  it('T03i: documents CI integration pattern', () => {
    const doc = read('docs/deployment/staging-smoke-commands.md');
    assert.ok(doc.toLowerCase().includes('ci') || doc.toLowerCase().includes('github'));
  });

  it('T03j: documents exit codes', () => {
    const doc = read('docs/deployment/staging-smoke-commands.md');
    assert.ok(doc.includes('Exit code') || doc.includes('exit code'));
    assert.ok(doc.includes('0') && doc.includes('1'));
  });
});

// ── T04: Staging smoke result template ───────────────────────────────────────
describe('S10.6 T04 — Staging smoke result template', () => {
  it('T04a: docs/deployment/staging-smoke-result-template.md exists', () => {
    assert.ok(exists('docs/deployment/staging-smoke-result-template.md'));
  });

  it('T04b: has deployment info section', () => {
    const doc = read('docs/deployment/staging-smoke-result-template.md');
    assert.ok(doc.includes('version') && doc.includes('commit'));
  });

  it('T04c: has readiness check result table', () => {
    const doc = read('docs/deployment/staging-smoke-result-template.md');
    assert.ok(doc.includes('/health') && doc.includes('/ready') && doc.includes('PASS / FAIL'));
  });

  it('T04d: has smoke check result table covering all key checks', () => {
    const doc = read('docs/deployment/staging-smoke-result-template.md');
    const required = ['merchant', 'intent', 'gateway payment', 'status', 'audit log', 'webhook'];
    const missing = required.filter(c => !doc.includes(c));
    assert.deepEqual(missing, []);
  });

  it('T04e: has gate decision field', () => {
    const doc = read('docs/deployment/staging-smoke-result-template.md');
    assert.ok(doc.toLowerCase().includes('decision') || doc.toLowerCase().includes('gate'));
  });

  it('T04f: has sign-off / reviewer fields', () => {
    const doc = read('docs/deployment/staging-smoke-result-template.md');
    assert.ok(doc.toLowerCase().includes('sign') || doc.toLowerCase().includes('reviewer'));
  });

  it('T04g: does not contain filled secret values', () => {
    const doc = read('docs/deployment/staging-smoke-result-template.md');
    assert.ok(!/nf\.(live|staging)\.[a-zA-Z0-9_-]{4,}\.[a-zA-Z0-9]{20,}/.test(doc));
  });

  it('T04h: notes that secret values must not be included', () => {
    const doc = read('docs/deployment/staging-smoke-result-template.md');
    assert.ok(
      doc.toLowerCase().includes('secret') ||
      doc.toLowerCase().includes('do not include'),
    );
  });
});

// ── T05: Smoke script S10.5.1 contract correctness ───────────────────────────
describe('S10.6 T05 — Smoke script runtime contract (S10.5.1)', () => {
  it('T05a: PUT used for payment method upsert', () => {
    assert.ok(smoke.includes("'PUT'"), 'PUT method must be in smoke script');
    assert.ok(/put\s*\(/.test(smoke), 'put() helper must be called');
    assert.ok(
      !smoke.match(/post\s*\(\s*`[^`]*\/methods\/\$\{SMOKE_METHOD\}/),
      'post() must not be used for /methods/ upsert',
    );
  });

  it('T05b: status parsed from intent.status (not top-level data.status)', () => {
    assert.ok(
      smoke.includes('intent?.status') || smoke.includes('intent.status'),
      'status must be read from intent.status',
    );
  });

  it('T05c: refundability uses actual contract (totalRefundable + transactions array)', () => {
    assert.ok(smoke.includes('totalRefundable'), 'must read totalRefundable');
    assert.ok(smoke.includes('amountRefundable'), 'must read amountRefundable from transactions');
    assert.ok(smoke.includes('transactions.find'), 'must find refundable candidate in transactions array');
  });

  it('T05d: audit log reads data.entries not raw array', () => {
    assert.ok(smoke.includes('auditData') && smoke.includes('entries'));
    assert.ok(!smoke.includes('data as unknown[]'));
  });

  it('T05e: gateway payment parses transactionId from data.transaction.id', () => {
    assert.ok(
      smoke.includes('gatewayPaymentData.transaction?.id') ||
      smoke.includes('transaction?.id'),
      'transactionId must be parsed from transaction.id',
    );
  });

  it('T05f: smoke script is wrapped in async IIFE', () => {
    assert.ok(smoke.includes('void (async ()'));
  });

  it('T05g: readiness script is wrapped in async IIFE', () => {
    assert.ok(readiness.includes('void (async ()'));
  });
});

// ── T06: Package scripts exist ────────────────────────────────────────────────
describe('S10.6 T06 — Package scripts', () => {
  it('T06a: s10:readiness in package.json', () => {
    assert.ok('s10:readiness' in pkg.scripts);
  });

  it('T06b: s10:smoke in package.json', () => {
    assert.ok('s10:smoke' in pkg.scripts);
  });

  it('T06c: s10:readiness points to runtime-readiness-check script', () => {
    assert.ok(pkg.scripts['s10:readiness']!.includes('s10-5-runtime-readiness-check'));
  });

  it('T06d: s10:smoke points to bootstrap-smoke script', () => {
    assert.ok(pkg.scripts['s10:smoke']!.includes('s10-5-bootstrap-smoke'));
  });
});

// ── T07: Deployment dir completeness ─────────────────────────────────────────
describe('S10.6 T07 — Deployment docs completeness', () => {
  const requiredDocs = [
    'docs/deployment/runtime-environment.md',
    'docs/deployment/deployment-checklist.md',
    'docs/deployment/bootstrap-operator-guide.md',
    'docs/deployment/production-redline-checklist.md',
    'docs/deployment/staging-runtime-smoke-runbook.md',
    'docs/deployment/staging-env-template.md',
    'docs/deployment/staging-smoke-commands.md',
    'docs/deployment/staging-smoke-result-template.md',
  ];

  for (const doc of requiredDocs) {
    it(`T07: ${doc} exists`, () => {
      assert.ok(exists(doc), `Missing: ${doc}`);
    });
  }
});

// ── T08: No forbidden content ─────────────────────────────────────────────────
describe('S10.6 T08 — No forbidden content in staging docs', () => {
  const stagingDocs = [
    'docs/deployment/staging-runtime-smoke-runbook.md',
    'docs/deployment/staging-env-template.md',
    'docs/deployment/staging-smoke-commands.md',
    'docs/deployment/staging-smoke-result-template.md',
  ];

  it('T08a: no real credential patterns in staging docs', () => {
    const allDocs = stagingDocs.map(d => read(d)).join('\n');
    assert.ok(
      !/nf\.(live|staging)\.[a-zA-Z0-9_-]{4,}\.[a-zA-Z0-9]{20,}/.test(allDocs),
      'Staging docs must not contain hardcoded real credentials',
    );
  });

  it('T08b: no hardcoded DATABASE_URL with credentials in staging docs', () => {
    const allDocs = stagingDocs.map(d => read(d)).join('\n');
    assert.ok(
      !/postgresql:\/\/[^<{][^@]+:[^<{][^@]+@/.test(allDocs),
      'Staging docs must not contain hardcoded DATABASE_URL with credentials',
    );
  });

  it('T08c: no dashboard implementation referenced as required', () => {
    const allDocs = stagingDocs.map(d => read(d)).join('\n');
    assert.ok(
      !allDocs.includes('deploy dashboard') &&
      !allDocs.includes('dashboard required'),
    );
  });

  it('T08d: no browser/frontend direct access pattern', () => {
    const runbook = read('docs/deployment/staging-runtime-smoke-runbook.md');
    assert.ok(!runbook.includes('window.') && !runbook.includes('document.'));
  });
});

// ── T09: Provider codes unchanged ────────────────────────────────────────────
describe('S10.6 T09 — Provider codes unchanged', () => {
  it('T09a: fake_gateway provider code in smoke script', () => {
    assert.ok(smoke.includes('fake_gateway'));
  });

  it('T09b: fake_gateway default SMOKE_PROVIDER in smoke script', () => {
    assert.ok(smoke.includes("'fake_gateway'") || smoke.includes('"fake_gateway"'));
  });

  it('T09c: xendit_sandbox in FakeGateway handler', () => {
    const src = read('apps/service/src/infrastructure/providers/FakeGatewayWebhookHandler.ts');
    assert.ok(src.includes('fake_gateway'));
  });

  it('T09d: xendit_sandbox in XenditSandbox provider', () => {
    const src = read('apps/service/src/infrastructure/providers/XenditSandboxProvider.ts');
    assert.ok(src.includes('xendit_sandbox'));
  });
});
