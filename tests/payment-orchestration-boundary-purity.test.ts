import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SCOPES = [
  'packages/core',
  'packages/client-sdk',
  'apps/service',
];

const FORBIDDEN = [
  /from ['"]@pos\//,
  /from ['"].*apps\/api/,
  /from ['"].*packages\/application\/payments/,
  /from ['"].*packages\/domain\/payments/,
  /from ['"].*packages\/infrastructure\/payments/,
  /from ['"].*pos-terminal-web/,
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.turbo') continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

describe('payment orchestration standalone boundary purity', () => {
  test('standalone package/service source does not import forbidden Consumer A runtime modules', () => {
    const files = SCOPES.flatMap((scope) => sourceFiles(join(ROOT, scope)));
    const violations: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const pattern of FORBIDDEN) {
        if (pattern.test(source)) violations.push(`${relative(ROOT, file)}: ${pattern}`);
      }
    }

    assert.deepEqual(violations, []);
  });
});
