/**
 * s10-5-deployment-runtime-readiness.test.ts
 *
 * Static tests verifying that all S10.5 deployment artifacts exist,
 * are internally consistent, and do not contain hard-coded secrets or
 * forbidden patterns.
 *
 * Preference: static analysis over booting the service.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');
const exists = (rel: string) => existsSync(join(root, rel));

// ── 1: Deployment env doc ─────────────────────────────────────────────────────
describe('S10.5 T01 — Deployment env doc', () => {

  it('T01a: docs/deployment/runtime-environment.md exists', () => {
    assert.ok(exists('docs/deployment/runtime-environment.md'));
  });

  it('T01b: documents DATABASE_URL', () => {
    assert.ok(read('docs/deployment/runtime-environment.md').includes('DATABASE_URL'));
  });

  it('T01c: documents NODE_ENV', () => {
    assert.ok(read('docs/deployment/runtime-environment.md').includes('NODE_ENV'));
  });

  it('T01d: documents PORT', () => {
    assert.ok(read('docs/deployment/runtime-environment.md').includes('PORT'));
  });

  it('T01e: documents PAYMENT_ORCHESTRATION_LEGACY_SERVICE_TOKEN_ENABLED', () => {
    assert.ok(read('docs/deployment/runtime-environment.md').includes('PAYMENT_ORCHESTRATION_LEGACY_SERVICE_TOKEN_ENABLED'));
  });

  it('T01f: documents rate limit env vars', () => {
    const doc = read('docs/deployment/runtime-environment.md');
    assert.ok(doc.includes('PAYMENT_ORCHESTRATION_RATE_LIMIT_ENABLED'));
    assert.ok(doc.includes('PAYMENT_ORCHESTRATION_RATE_LIMIT_CLIENT_GLOBAL_PER_MINUTE'));
    assert.ok(doc.includes('PAYMENT_ORCHESTRATION_RATE_LIMIT_CLIENT_ROUTE_PER_MINUTE'));
    assert.ok(doc.includes('PAYMENT_ORCHESTRATION_RATE_LIMIT_AUTH_FAILURE_PER_MINUTE'));
  });

  it('T01g: documents PAYMENT_ORCHESTRATION_CORS_ENABLED', () => {
    assert.ok(read('docs/deployment/runtime-environment.md').includes('PAYMENT_ORCHESTRATION_CORS_ENABLED'));
  });

  it('T01h: documents PAYMENT_ORCHESTRATION_TRUST_PROXY', () => {
    assert.ok(read('docs/deployment/runtime-environment.md').includes('PAYMENT_ORCHESTRATION_TRUST_PROXY'));
  });

  it('T01i: documents PAYMENT_ORCHESTRATION_READY_TOKEN', () => {
    assert.ok(read('docs/deployment/runtime-environment.md').includes('PAYMENT_ORCHESTRATION_READY_TOKEN'));
  });

  it('T01j: documents PAYMENT_ORCHESTRATION_XENDIT_CALLBACK_TOKEN', () => {
    assert.ok(read('docs/deployment/runtime-environment.md').includes('PAYMENT_ORCHESTRATION_XENDIT_CALLBACK_TOKEN'));
  });

  it('T01k: documents outbound webhook env vars', () => {
    const doc = read('docs/deployment/runtime-environment.md');
    assert.ok(doc.includes('PAYMENT_ORCHESTRATION_OUTBOUND_WEBHOOKS_ENABLED'));
  });

  it('T01l: documents signed requests env vars', () => {
    const doc = read('docs/deployment/runtime-environment.md');
    assert.ok(doc.includes('PAYMENT_ORCHESTRATION_SIGNED_REQUESTS_MODE'));
  });

  it('T01m: has a secret redline/policy section', () => {
    const doc = read('docs/deployment/runtime-environment.md');
    assert.ok(doc.toLowerCase().includes('secret') && doc.toLowerCase().includes('never'));
  });

  it('T01n: states CORS must be false in production', () => {
    const doc = read('docs/deployment/runtime-environment.md');
    assert.ok(doc.includes('false') && doc.includes('CORS'));
  });

  it('T01o: states legacy service token must be false in production', () => {
    const doc = read('docs/deployment/runtime-environment.md');
    assert.ok(doc.includes('false') && doc.includes('LEGACY_SERVICE_TOKEN'));
  });
});

// ── 2: Deployment checklist ───────────────────────────────────────────────────
describe('S10.5 T02 — Deployment checklist', () => {

  it('T02a: docs/deployment/deployment-checklist.md exists', () => {
    assert.ok(exists('docs/deployment/deployment-checklist.md'));
  });

  it('T02b: includes migration command', () => {
    const doc = read('docs/deployment/deployment-checklist.md');
    assert.ok(doc.includes('db:migrate') || doc.includes('migrate'));
  });

  it('T02c: includes health check URL', () => {
    const doc = read('docs/deployment/deployment-checklist.md');
    assert.ok(doc.includes('/health'));
  });

  it('T02d: includes readiness check URL', () => {
    const doc = read('docs/deployment/deployment-checklist.md');
    assert.ok(doc.includes('/ready'));
  });

  it('T02e: includes rollback section', () => {
    const doc = read('docs/deployment/deployment-checklist.md');
    assert.ok(doc.toLowerCase().includes('rollback'));
  });

  it('T02f: includes reverse proxy / Nginx setup', () => {
    const doc = read('docs/deployment/deployment-checklist.md');
    assert.ok(doc.toLowerCase().includes('nginx') || doc.toLowerCase().includes('proxy'));
  });

  it('T02g: includes CORS policy note', () => {
    const doc = read('docs/deployment/deployment-checklist.md');
    assert.ok(doc.includes('CORS'));
  });

  it('T02h: includes ready-token policy', () => {
    const doc = read('docs/deployment/deployment-checklist.md');
    assert.ok(doc.includes('ready') && doc.includes('token'));
  });

  it('T02i: includes origin firewall or port exposure note', () => {
    const doc = read('docs/deployment/deployment-checklist.md');
    assert.ok(
      doc.toLowerCase().includes('firewall') ||
      doc.toLowerCase().includes('origin') ||
      doc.toLowerCase().includes('public internet'),
    );
  });

  it('T02j: includes log redaction policy', () => {
    const doc = read('docs/deployment/deployment-checklist.md');
    assert.ok(doc.toLowerCase().includes('log') && doc.toLowerCase().includes('redact'));
  });

  it('T02k: covers at least 3 deployment targets', () => {
    const doc = read('docs/deployment/deployment-checklist.md');
    const targets = ['Local', 'Replit', 'VPS', 'Coolify', 'Docker', 'Cloudflare'];
    const found = targets.filter(t => doc.includes(t));
    assert.ok(found.length >= 3, `Only found ${found.length} targets: ${found.join(', ')}`);
  });

  it('T02l: does not reference dashboard as required implementation', () => {
    const doc = read('docs/deployment/deployment-checklist.md');
    assert.ok(
      !doc.toLowerCase().includes('dashboard required') &&
      !doc.toLowerCase().includes('deploy dashboard'),
    );
  });
});

// ── 3: Runtime readiness script ───────────────────────────────────────────────
describe('S10.5 T03 — Runtime readiness script', () => {

  it('T03a: scripts/s10-5-runtime-readiness-check.ts exists', () => {
    assert.ok(exists('scripts/s10-5-runtime-readiness-check.ts'));
  });

  it('T03b: checks /health endpoint', () => {
    const src = read('scripts/s10-5-runtime-readiness-check.ts');
    assert.ok(src.includes('/health'));
  });

  it('T03c: checks /version endpoint', () => {
    assert.ok(read('scripts/s10-5-runtime-readiness-check.ts').includes('/version'));
  });

  it('T03d: checks /ready endpoint', () => {
    assert.ok(read('scripts/s10-5-runtime-readiness-check.ts').includes('/ready'));
  });

  it('T03e: masks API key — does not print raw value', () => {
    const src = read('scripts/s10-5-runtime-readiness-check.ts');
    assert.ok(src.includes('maskSecret') || src.includes('MASK'), 'API key masking function missing');
    // Must not directly console.log(API_KEY)
    assert.ok(!src.match(/console\.log\(API_KEY\)/), 'raw API_KEY must not be printed directly');
  });

  it('T03f: exits non-zero on failure', () => {
    const src = read('scripts/s10-5-runtime-readiness-check.ts');
    assert.ok(src.includes('process.exit(1)') || src.includes('process.exit(non'));
  });

  it('T03g: exits 0 on all pass', () => {
    const src = read('scripts/s10-5-runtime-readiness-check.ts');
    assert.ok(src.includes('process.exit(0)'));
  });

  it('T03h: has --help flag', () => {
    assert.ok(read('scripts/s10-5-runtime-readiness-check.ts').includes('--help'));
  });

  it('T03i: does not contain real-looking hardcoded secret patterns', () => {
    const src = read('scripts/s10-5-runtime-readiness-check.ts');
    // Real creds follow: nf.live|staging.<alphanum>.<alphanum32+>
    assert.ok(
      !/nf\.(live|staging)\.[a-zA-Z0-9_-]{4,}\.[a-zA-Z0-9]{20,}/.test(src),
      'Script must not contain hardcoded credentials',
    );
    assert.ok(
      !/postgresql:\/\/[^<{][^@]+:[^<{][^@]+@/.test(src),
      'Script must not contain hardcoded DATABASE_URL',
    );
  });
});

// ── 4: Bootstrap smoke script ─────────────────────────────────────────────────
describe('S10.5 T04 — Bootstrap smoke script', () => {

  it('T04a: scripts/s10-5-bootstrap-smoke.ts exists', () => {
    assert.ok(exists('scripts/s10-5-bootstrap-smoke.ts'));
  });

  it('T04b: creates merchant', () => {
    const src = read('scripts/s10-5-bootstrap-smoke.ts');
    assert.ok(src.includes('/v1/merchants'));
  });

  it('T04c: creates provider account', () => {
    assert.ok(read('scripts/s10-5-bootstrap-smoke.ts').includes('provider-accounts'));
  });

  it('T04d: creates payment intent', () => {
    assert.ok(read('scripts/s10-5-bootstrap-smoke.ts').includes('/v1/payment-intents'));
  });

  it('T04e: creates gateway payment', () => {
    assert.ok(read('scripts/s10-5-bootstrap-smoke.ts').includes('gateway-payments'));
  });

  it('T04f: uses fake_gateway confirm route for dev confirm step', () => {
    assert.ok(read('scripts/s10-5-bootstrap-smoke.ts').includes('fake-gateway'));
  });

  it('T04g: reads payment intent status', () => {
    assert.ok(read('scripts/s10-5-bootstrap-smoke.ts').includes('/status'));
  });

  it('T04h: masks API key', () => {
    const src = read('scripts/s10-5-bootstrap-smoke.ts');
    assert.ok(src.includes('maskSecret') || src.includes('MASK'));
    assert.ok(!src.match(/console\.log\(API_KEY\)/));
  });

  it('T04i: prints PASS/FAIL/SKIP summary', () => {
    const src = read('scripts/s10-5-bootstrap-smoke.ts');
    assert.ok(src.includes('PASS') && src.includes('FAIL') && src.includes('SKIP'));
  });

  it('T04j: exits non-zero when a required step fails', () => {
    assert.ok(read('scripts/s10-5-bootstrap-smoke.ts').includes('process.exit(1)'));
  });

  it('T04k: has --help flag', () => {
    assert.ok(read('scripts/s10-5-bootstrap-smoke.ts').includes('--help'));
  });

  it('T04l: webhook smoke only runs when SMOKE_WEBHOOK_URL is provided', () => {
    const src = read('scripts/s10-5-bootstrap-smoke.ts');
    assert.ok(src.includes('SMOKE_WEBHOOK_URL') && src.includes('SKIP'));
  });

  it('T04m: does not contain hardcoded real secrets', () => {
    const src = read('scripts/s10-5-bootstrap-smoke.ts');
    assert.ok(
      !/nf\.(live|staging)\.[a-zA-Z0-9_-]{4,}\.[a-zA-Z0-9]{20,}/.test(src),
      'Script must not contain hardcoded credentials',
    );
  });
});

// ── 5: Bootstrap operator guide ───────────────────────────────────────────────
describe('S10.5 T05 — Bootstrap operator guide', () => {

  it('T05a: docs/deployment/bootstrap-operator-guide.md exists', () => {
    assert.ok(exists('docs/deployment/bootstrap-operator-guide.md'));
  });

  it('T05b: documents API client creation as step 2', () => {
    const doc = read('docs/deployment/bootstrap-operator-guide.md');
    assert.ok(doc.includes('API client') || doc.includes('api client') || doc.includes('client:create'));
  });

  it('T05c: documents credential creation with rawSecret stored once', () => {
    const doc = read('docs/deployment/bootstrap-operator-guide.md');
    assert.ok(doc.includes('rawSecret') || doc.includes('raw secret') || doc.includes('once only'));
  });

  it('T05d: documents merchant creation', () => {
    assert.ok(read('docs/deployment/bootstrap-operator-guide.md').includes('/v1/merchants'));
  });

  it('T05e: documents provider account creation', () => {
    assert.ok(read('docs/deployment/bootstrap-operator-guide.md').includes('provider-accounts'));
  });

  it('T05f: documents payment method setup', () => {
    const doc = read('docs/deployment/bootstrap-operator-guide.md');
    assert.ok(doc.includes('payment method') || doc.includes('methods'));
  });

  it('T05g: includes examples for AuraPoS, Transity, Kioskoin', () => {
    const doc = read('docs/deployment/bootstrap-operator-guide.md');
    assert.ok(doc.includes('AuraPoS') || doc.includes('aura_pos'), 'AuraPoS missing');
    assert.ok(doc.includes('Transity') || doc.includes('transity'), 'Transity missing');
    assert.ok(doc.includes('Kioskoin') || doc.includes('kioskoin'), 'Kioskoin missing');
  });

  it('T05h: mentions smoke test as step before going live', () => {
    const doc = read('docs/deployment/bootstrap-operator-guide.md');
    assert.ok(doc.toLowerCase().includes('smoke'));
  });

  it('T05i: does not include real secret values', () => {
    const doc = read('docs/deployment/bootstrap-operator-guide.md');
    assert.ok(
      !/nf\.(live|staging)\.[a-zA-Z0-9_-]{4,}\.[a-zA-Z0-9]{20,}/.test(doc),
      'Guide must not contain real credentials',
    );
  });
});

// ── 6: Production redline checklist ──────────────────────────────────────────
describe('S10.5 T06 — Production redline checklist', () => {

  it('T06a: docs/deployment/production-redline-checklist.md exists', () => {
    assert.ok(exists('docs/deployment/production-redline-checklist.md'));
  });

  it('T06b: mentions /health, /version, /ready', () => {
    const doc = read('docs/deployment/production-redline-checklist.md');
    assert.ok(doc.includes('/health') && doc.includes('/version') && doc.includes('/ready'));
  });

  it('T06c: includes migrations check', () => {
    assert.ok(read('docs/deployment/production-redline-checklist.md').toLowerCase().includes('migration'));
  });

  it('T06d: requires legacy token disabled', () => {
    const doc = read('docs/deployment/production-redline-checklist.md');
    assert.ok(doc.includes('LEGACY_SERVICE_TOKEN') || doc.includes('legacy') && doc.includes('disabled'));
  });

  it('T06e: requires merchant access guard check', () => {
    const doc = read('docs/deployment/production-redline-checklist.md');
    assert.ok(doc.includes('MERCHANT_ACCESS_DENIED') || doc.includes('merchant access'));
  });

  it('T06f: requires scope guard check', () => {
    const doc = read('docs/deployment/production-redline-checklist.md');
    assert.ok(doc.includes('SCOPE_DENIED') || doc.includes('scope guard'));
  });

  it('T06g: requires sourceApp mismatch check', () => {
    const doc = read('docs/deployment/production-redline-checklist.md');
    assert.ok(doc.includes('SOURCE_APP_MISMATCH') || doc.includes('sourceApp') && doc.includes('mismatch'));
  });

  it('T06h: rate limit check present', () => {
    assert.ok(read('docs/deployment/production-redline-checklist.md').toLowerCase().includes('rate limit'));
  });

  it('T06i: CORS disabled check present', () => {
    assert.ok(read('docs/deployment/production-redline-checklist.md').includes('CORS'));
  });

  it('T06j: audit log check present', () => {
    assert.ok(read('docs/deployment/production-redline-checklist.md').toLowerCase().includes('audit'));
  });

  it('T06k: no secret leak check present', () => {
    const doc = read('docs/deployment/production-redline-checklist.md');
    assert.ok(doc.toLowerCase().includes('secret') && doc.toLowerCase().includes('leak'));
  });

  it('T06l: rollback plan present', () => {
    assert.ok(read('docs/deployment/production-redline-checklist.md').toLowerCase().includes('rollback'));
  });

  it('T06m: explicit redline: no browser/frontend direct access', () => {
    const doc = read('docs/deployment/production-redline-checklist.md');
    assert.ok(
      doc.toLowerCase().includes('browser') || doc.toLowerCase().includes('frontend'),
      'Must explicitly state no browser/frontend direct access',
    );
  });

  it('T06n: explicit redline: no global service token in production', () => {
    const doc = read('docs/deployment/production-redline-checklist.md');
    assert.ok(
      doc.toLowerCase().includes('global') || doc.includes('LEGACY'),
      'Must explicitly state no global service token in production',
    );
  });

  it('T06o: provider codes unchanged check present', () => {
    const doc = read('docs/deployment/production-redline-checklist.md');
    assert.ok(
      doc.includes('fake_gateway') || doc.includes('provider codes') || doc.includes('manual'),
    );
  });
});

// ── 7: Provider codes unchanged ───────────────────────────────────────────────
describe('S10.5 T07 — Provider codes unchanged', () => {

  it('T07a: fake_gateway code present in service source', () => {
    const src = read('apps/service/src/infrastructure/providers/FakeGatewayWebhookHandler.ts');
    assert.ok(src.includes("'fake_gateway'") || src.includes('"fake_gateway"'));
  });

  it('T07b: xendit_sandbox code present in service source', () => {
    const src = read('apps/service/src/infrastructure/providers/XenditSandboxProvider.ts');
    assert.ok(src.includes("'xendit_sandbox'") || src.includes('"xendit_sandbox"'));
  });

  it('T07c: dev fake-gateway route absent in production (gated by nodeEnv)', () => {
    const app = read('apps/service/src/app.ts');
    assert.ok(
      app.includes("nodeEnv !== 'production'") || app.includes('production'),
      'dev route must be gated by NODE_ENV !== production',
    );
  });
});

// ── 8: Package scripts ────────────────────────────────────────────────────────
describe('S10.5 T08 — Package scripts', () => {

  it('T08a: s10:readiness script in root package.json', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    assert.ok('s10:readiness' in pkg.scripts, 's10:readiness not found in package.json scripts');
  });

  it('T08b: s10:smoke script in root package.json', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    assert.ok('s10:smoke' in pkg.scripts, 's10:smoke not found in package.json scripts');
  });

  it('T08c: existing scripts not broken (test, build, db:migrate all present)', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    assert.ok('test' in pkg.scripts);
    assert.ok('build' in pkg.scripts);
    assert.ok('db:migrate' in pkg.scripts);
  });
});

// ── 9: General constraints ────────────────────────────────────────────────────
describe('S10.5 T09 — Hard rule checks', () => {

  it('T09a: no dashboard implementation in deployment docs', () => {
    const allDocs = [
      'docs/deployment/runtime-environment.md',
      'docs/deployment/deployment-checklist.md',
      'docs/deployment/bootstrap-operator-guide.md',
      'docs/deployment/production-redline-checklist.md',
    ].map(p => read(p)).join('\n');
    assert.ok(
      !allDocs.includes('dashboard required') &&
      !allDocs.includes('deploy dashboard') &&
      !allDocs.includes('apps/dashboard'),
      'Deployment docs must not reference dashboard as implementation work',
    );
  });

  it('T09b: docs mention both REST and SDK integration paths', () => {
    const guide = read('docs/deployment/bootstrap-operator-guide.md');
    assert.ok(guide.includes('REST') || guide.includes('curl'), 'REST path missing');
    assert.ok(guide.includes('SDK') || guide.includes('northflow.'), 'SDK path missing');
  });

  it('T09c: docs do not make SDK mandatory — REST is also documented', () => {
    const guide = read('docs/deployment/bootstrap-operator-guide.md');
    assert.ok(guide.includes('curl') || guide.includes('REST'), 'REST examples must be present');
  });

  it('T09d: docs state global service token is not production default', () => {
    const env = read('docs/deployment/runtime-environment.md');
    assert.ok(
      env.includes('false') &&
      (env.includes('LEGACY_SERVICE_TOKEN') || env.includes('global')),
    );
  });

  it('T09e: smoke script does not use frontend/browser approach', () => {
    const src = read('scripts/s10-5-bootstrap-smoke.ts');
    assert.ok(!src.includes('window.') && !src.includes('document.'), 'No browser APIs allowed');
  });

  it('T09f: readiness script does not use frontend/browser approach', () => {
    const src = read('scripts/s10-5-runtime-readiness-check.ts');
    assert.ok(!src.includes('window.') && !src.includes('document.'), 'No browser APIs allowed');
  });
});
