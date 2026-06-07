/**
 * extraction-check.ts
 *
 * Phase 8L.1: Validates that the standalone northflow-payment-orchestration repo
 * is complete, self-contained, and ready to push to the standalone payment repo.
 *
 * Checks:
 * 1. Required directories exist.
 * 2. Required package.json / tsconfig.json / config files present.
 * 3. Root package.json has required scripts (check, build, dev:service, start:service).
 * 4. Service package.json has start and build scripts.
 * 5. Key source entry points present.
 * 6. Migrations directory is not empty.
 * 7. Docs and OpenAPI spec present.
 * 8. Phase 8L extraction report exists.
 * 9. .env.example files contain no real-looking secrets.
 * 10. README opens as standalone product (not as a child of another project).
 * 11. Docker docs use correct -f apps/service/Dockerfile flag.
 * 12. No forbidden legacy imports in standalone source.
 * 13. No shared/schema references in standalone source.
 * 14. Package name consistency.
 * 15. No random assets/logs/build outputs in repo.
 *
 * Run:
 *   npx tsx --tsconfig tests/tsconfig.json scripts/extraction-check.ts
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
let passed = 0;
let failed = 0;

function check(description: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`  ✅ ${description}`);
    passed++;
  } else {
    console.error(`  ❌ ${description}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

function exists(rel: string): boolean {
  return existsSync(join(ROOT, rel));
}

function readText(rel: string): string {
  const full = join(ROOT, rel);
  if (!existsSync(full)) return '';
  return readFileSync(full, 'utf8');
}

function readJson(rel: string): Record<string, unknown> {
  const text = readText(rel);
  if (!text) return {};
  return JSON.parse(text) as Record<string, unknown>;
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.turbo') continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

console.log('\n═══════════════════════════════════════════════════════════════════');
console.log('  Northflow Payment Orchestration — Phase 8L.1 Extraction Check');
console.log('═══════════════════════════════════════════════════════════════════\n');

// ── Section 1: Directory structure ────────────────────────────────────────────
console.log('Section 1: Directory structure');
check('packages/core/ exists', exists('packages/core'));
check('packages/client-sdk/ exists', exists('packages/client-sdk'));
check('apps/service/ exists', exists('apps/service'));
check('migrations/ exists', exists('migrations'));
check('tests/ exists', exists('tests'));
check('docs/ exists', exists('docs'));
check('docs/reports/ exists', exists('docs/reports'));
check('scripts/ exists', exists('scripts'));

// ── Section 2: Config files ───────────────────────────────────────────────────
console.log('\nSection 2: Config files');
check('package.json (root)', exists('package.json'));
check('pnpm-workspace.yaml', exists('pnpm-workspace.yaml'));
check('turbo.json', exists('turbo.json'));
check('tsconfig.base.json', exists('tsconfig.base.json'));
check('.env.example (root)', exists('.env.example'));
check('.gitignore', exists('.gitignore'));
check('packages/core/package.json', exists('packages/core/package.json'));
check('packages/core/tsconfig.json', exists('packages/core/tsconfig.json'));
check('packages/client-sdk/package.json', exists('packages/client-sdk/package.json'));
check('packages/client-sdk/tsconfig.json', exists('packages/client-sdk/tsconfig.json'));
check('apps/service/package.json', exists('apps/service/package.json'));
check('apps/service/tsconfig.json', exists('apps/service/tsconfig.json'));
check('apps/service/drizzle.config.ts', exists('apps/service/drizzle.config.ts'));
check('apps/service/.env.example', exists('apps/service/.env.example'));
check('apps/service/Dockerfile', exists('apps/service/Dockerfile'));
check('tests/tsconfig.json', exists('tests/tsconfig.json'));

// ── Section 3: Root package.json required scripts ─────────────────────────────
console.log('\nSection 3: Root package.json scripts');
const rootPkg = readJson('package.json');
const rootScripts = (rootPkg['scripts'] as Record<string, string>) ?? {};
check('root scripts.check exists', 'check' in rootScripts, `got: ${JSON.stringify(rootScripts['check'])}`);
check('root scripts.build exists', 'build' in rootScripts, `got: ${JSON.stringify(rootScripts['build'])}`);
check('root scripts.dev:service exists', 'dev:service' in rootScripts);
check('root scripts.start:service exists', 'start:service' in rootScripts);
check('root scripts.dev exists', 'dev' in rootScripts);
check('root scripts.type-check exists', 'type-check' in rootScripts);
check('root scripts.test exists', 'test' in rootScripts);
check('root scripts.db:migrate exists', 'db:migrate' in rootScripts);
check('root scripts.db:generate exists', 'db:generate' in rootScripts);
check('root scripts.worker exists', 'worker' in rootScripts);
check('root scripts.extraction-check exists', 'extraction-check' in rootScripts);

// ── Section 4: Service package.json required scripts ──────────────────────────
console.log('\nSection 4: Service package.json scripts');
const servicePkg = readJson('apps/service/package.json');
const serviceScripts = (servicePkg['scripts'] as Record<string, string>) ?? {};
check('service scripts.dev exists', 'dev' in serviceScripts);
check('service scripts.start exists', 'start' in serviceScripts);
check('service scripts.build exists', 'build' in serviceScripts);
check('service scripts.type-check exists', 'type-check' in serviceScripts);
check('service scripts.worker exists', 'worker' in serviceScripts);
check('service scripts.db:migrate exists', 'db:migrate' in serviceScripts);

// ── Section 5: Source entry points ───────────────────────────────────────────
console.log('\nSection 5: Source entry points');
check('packages/core/src/index.ts', exists('packages/core/src/index.ts'));
check('packages/client-sdk/src/index.ts', exists('packages/client-sdk/src/index.ts'));
check('packages/client-sdk/src/client.ts', exists('packages/client-sdk/src/client.ts'));
check('packages/client-sdk/src/errors.ts', exists('packages/client-sdk/src/errors.ts'));
check('apps/service/src/index.ts', exists('apps/service/src/index.ts'));
check('apps/service/src/app.ts', exists('apps/service/src/app.ts'));
check('apps/service/src/container.ts', exists('apps/service/src/container.ts'));
check('apps/service/src/config/env.ts', exists('apps/service/src/config/env.ts'));
check('apps/service/src/infrastructure/schema.ts', exists('apps/service/src/infrastructure/schema.ts'));
check('apps/service/src/infrastructure/db.ts', exists('apps/service/src/infrastructure/db.ts'));

// ── Section 6: Migrations not empty ──────────────────────────────────────────
console.log('\nSection 6: Migrations');
const migrationFiles = exists('migrations')
  ? readdirSync(join(ROOT, 'migrations')).filter((f) => f.endsWith('.sql'))
  : [];
check('migrations/ contains at least one .sql file', migrationFiles.length > 0, `found: ${migrationFiles.length}`);

// ── Section 7: Docs and OpenAPI spec ─────────────────────────────────────────
console.log('\nSection 7: Docs');
check('docs/payment-orchestration-api-contract.md', exists('docs/payment-orchestration-api-contract.md'));
check('docs/payment-orchestration-sdk-contract.md', exists('docs/payment-orchestration-sdk-contract.md'));
check('docs/payment-orchestration-error-codes.md', exists('docs/payment-orchestration-error-codes.md'));
check('docs/payment-orchestration-deployment.md', exists('docs/payment-orchestration-deployment.md'));
check('docs/payment-orchestration-worker-operations.md', exists('docs/payment-orchestration-worker-operations.md'));
check('docs/openapi/payment-orchestration.openapi.json', exists('docs/openapi/payment-orchestration.openapi.json'));


// ── Section 7B: Legacy payment parity hardening artifacts ───────────────────
console.log('\nSection 7B: Legacy payment parity hardening');
const refundUseCase = readText('apps/service/src/application/use-cases/RefundPaymentTransaction.ts');
const voidUseCase = readText('apps/service/src/application/use-cases/VoidPaymentTransaction.ts');
const providerContract = readText('apps/service/src/infrastructure/providers/StandalonePaymentProvider.ts');
const sdkClient = readText('packages/client-sdk/src/client.ts');
const sdkTypes = readText('packages/client-sdk/src/types.ts');
const openApi = readText('docs/openapi/payment-orchestration.openapi.json');
const apiDoc = readText('docs/payment-orchestration-api-contract.md');
const sdkDoc = readText('docs/payment-orchestration-sdk-contract.md');
const errorDoc = readText('docs/payment-orchestration-error-codes.md');

check('RefundPaymentTransaction.ts exists', exists('apps/service/src/application/use-cases/RefundPaymentTransaction.ts'));
check('VoidPaymentTransaction.ts exists', exists('apps/service/src/application/use-cases/VoidPaymentTransaction.ts'));
check('StandaloneManualProvider.ts exists', exists('apps/service/src/infrastructure/providers/StandaloneManualProvider.ts'));
check('provider contract exposes cancelPayment', providerContract.includes('cancelPayment?'));
check('provider contract exposes refundPayment', providerContract.includes('refundPayment?'));
check('SDK client exposes refundPaymentTransaction', sdkClient.includes('refundPaymentTransaction('));
check('SDK client exposes voidPaymentTransaction', sdkClient.includes('voidPaymentTransaction('));
for (const typeName of [
  'RefundPaymentTransactionRequest',
  'RefundPaymentTransactionResponse',
  'VoidPaymentTransactionRequest',
  'VoidPaymentTransactionResponse',
]) {
  check(`SDK types include ${typeName}`, sdkTypes.includes(`interface ${typeName}`));
}
check('OpenAPI contains refund endpoint', openApi.includes('/v1/payment-transactions/{transactionId}/refund'));
check('OpenAPI contains void endpoint', openApi.includes('/v1/payment-transactions/{transactionId}/void'));
check('parity matrix exists', exists('docs/reports/legacy-payment-to-northflow-parity-matrix.md'));
check('final parity migration report exists', exists('docs/reports/legacy-payment-parity-migration-report.md'));
check('docs mention provider refund unsupported behavior',
  apiDoc.includes('PROVIDER_REFUND_UNSUPPORTED') && sdkDoc.includes('PROVIDER_REFUND_UNSUPPORTED') && errorDoc.includes('PROVIDER_REFUND_UNSUPPORTED'));
check('docs mention provider cancel unsupported behavior',
  apiDoc.includes('PROVIDER_CANCEL_UNSUPPORTED') && sdkDoc.includes('PROVIDER_CANCEL_UNSUPPORTED') && errorDoc.includes('PROVIDER_CANCEL_UNSUPPORTED'));
check('refund use case includes idempotency conflict', refundUseCase.includes('IDEMPOTENCY_CONFLICT'));
check('void use case accepts idempotencyKey', voidUseCase.includes('idempotencyKey?: string | null'));

// ── Section 8: Phase 8L extraction report ────────────────────────────────────
console.log('\nSection 8: Extraction report');
check(
  'docs/reports/phase-8l-standalone-repo-extraction-report.md exists',
  exists('docs/reports/phase-8l-standalone-repo-extraction-report.md'),
);

// ── Section 9: Env examples — no real-looking secrets ────────────────────────
console.log('\nSection 9: Env examples clean');
const FORBIDDEN_ENV_PATTERNS = [
  'xnd_development_replace_with_real_key',
  'xnd_production_',
];
for (const envFile of ['.env.example', 'apps/service/.env.example']) {
  const content = readText(envFile);
  const hasRealSecret = FORBIDDEN_ENV_PATTERNS.some((p) => content.includes(p));
  check(`${envFile} has no real-looking Xendit key`, !hasRealSecret);
}
check('no .env file committed (only .env.example)', !exists('.env'));

// ── Section 10: README opens as standalone product ───────────────────────────
console.log('\nSection 10: README standalone wording');
const readmeText = readText('README.md');
const firstParagraph = readmeText.split('\n').slice(0, 6).join('\n');
const legacyChildPhrases = [
  'extracted from the legacy monorepo',
  'child project',
  'part of another project',
];
const hasLegacyChildWording = legacyChildPhrases.some((p) => firstParagraph.includes(p));
check('README does not open with legacy-child wording', !hasLegacyChildWording,
  hasLegacyChildWording ? `Found in first 6 lines: "${firstParagraph.slice(0, 100)}..."` : undefined);
check('README mentions standalone payment orchestration', readmeText.includes('standalone payment orchestration'));

// ── Section 11: Docker docs use -f flag ──────────────────────────────────────
console.log('\nSection 11: Docker docs');
check(
  'README docker build uses -f apps/service/Dockerfile',
  readmeText.includes('-f apps/service/Dockerfile'),
  'Expected: docker build -f apps/service/Dockerfile ...',
);
const deploymentDoc = readText('docs/payment-orchestration-deployment.md');
if (deploymentDoc.includes('docker build')) {
  const hasWrongDockerBuild = deploymentDoc.includes('docker build -t') &&
    !deploymentDoc.includes('-f apps/service/Dockerfile') &&
    !deploymentDoc.includes('-f ');
  check('deployment doc docker build uses -f flag (if present)', !hasWrongDockerBuild);
} else {
  check('deployment doc docker build (not present — skipped)', true);
}

// ── Section 12: Boundary purity ───────────────────────────────────────────────
console.log('\nSection 12: Boundary purity');
const SCOPES = ['packages/core', 'packages/client-sdk', 'apps/service'];
const FORBIDDEN_IMPORT_PATTERNS = [
  /from ['"]@pos\//,
  /from ['"].*apps\/api/,
  /from ['"].*packages\/application\/payments/,
  /from ['"].*packages\/domain\/payments/,
  /from ['"].*packages\/infrastructure\/payments/,
  /from ['"].*pos-terminal-web/,
];
const SHARED_SCHEMA_PATTERN = /from ['"].*shared\/schema/;

const allSourceFiles = SCOPES.flatMap((scope) => sourceFiles(join(ROOT, scope)));
const importViolations: string[] = [];
const schemaViolations: string[] = [];

for (const file of allSourceFiles) {
  const source = readFileSync(file, 'utf8');
  for (const pattern of FORBIDDEN_IMPORT_PATTERNS) {
    if (pattern.test(source)) {
      importViolations.push(`${relative(ROOT, file)}: ${pattern}`);
    }
  }
  if (SHARED_SCHEMA_PATTERN.test(source)) {
    schemaViolations.push(relative(ROOT, file));
  }
}

check('No forbidden @pos/* or legacy imports in standalone source', importViolations.length === 0,
  importViolations.length > 0 ? `\n    ${importViolations.join('\n    ')}` : undefined);
check('No shared/schema references in standalone source', schemaViolations.length === 0,
  schemaViolations.length > 0 ? `\n    ${schemaViolations.join('\n    ')}` : undefined);

// ── Section 13: No random assets/logs/build outputs ───────────────────────────
console.log('\nSection 13: No build artifacts');
const FORBIDDEN_ARTIFACTS = ['dist/', '*.log', '.next/', '.cache/', 'build/', '__pycache__/'];
for (const artifact of FORBIDDEN_ARTIFACTS) {
  const clean = artifact.replace(/[*/]/g, '');
  check(`no ${artifact} in repo root`, !exists(clean));
}

// ── Section 14: Package name consistency ──────────────────────────────────────
console.log('\nSection 14: Package name consistency');
function readPackageName(rel: string): string | null {
  const pkg = readJson(rel);
  return typeof pkg['name'] === 'string' ? pkg['name'] : null;
}
check('packages/core name = @northflow/payment-orchestration-core',
  readPackageName('packages/core/package.json') === '@northflow/payment-orchestration-core');
check('packages/client-sdk name = @northflow/payment-orchestration-client-sdk',
  readPackageName('packages/client-sdk/package.json') === '@northflow/payment-orchestration-client-sdk');
check('apps/service name = @northflow/payment-orchestration-service',
  readPackageName('apps/service/package.json') === '@northflow/payment-orchestration-service');

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n═══════════════════════════════════════════════════════════════════');
console.log(`  Result: ${passed} passed, ${failed} failed`);
if (failed === 0) {
  console.log('  Final decision: IN_REPO_STANDALONE_FOLDER_READY_TO_PUSH_TO_PAYMENT_REPO');
} else {
  console.log('  Final decision: BLOCKED — fix failures above before pushing');
}
console.log('═══════════════════════════════════════════════════════════════════\n');

if (failed > 0) {
  process.exit(1);
}
