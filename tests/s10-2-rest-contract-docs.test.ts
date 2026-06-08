import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

function read(path: string) {
  return readFileSync(path, 'utf8');
}

function integrationDocsText() {
  return readdirSync('docs/integration')
    .filter((name) => name.endsWith('.md'))
    .map((name) => read(join('docs/integration', name)))
    .join('\n');
}

test('S10.2 integration docs mention backend-only secret handling', () => {
  const docs = integrationDocsText();
  assert.match(docs, /backend-only secret rule/i);
  assert.match(docs, /Never use `NEXT_PUBLIC_`, `VITE_`, `EXPO_PUBLIC_`/);
  assert.match(docs, /frontend polls the merchant backend/i);
});

test('S10.2 integration docs and examples do not mention named external consumer projects', () => {
  const text = [integrationDocsText(), read('examples/merchant-backend/README.md'), read('examples/merchant-backend/rest-checkout-flow.md'), read('examples/merchant-backend/sdk-checkout-flow.ts')].join('\n');
  assert.doesNotMatch(text, new RegExp(['consumer', '[-]', '[abc]'].join(''), 'i'));
});

test('S10.2 REST quickstart includes required auth, merchant, source app, and content headers', () => {
  const rest = read('docs/integration/rest-quickstart.md');
  for (const header of [
    'Authorization: Bearer <NORTHFLOW_API_KEY>',
    'x-payment-merchant-id: <merchantId>',
    'x-source-app: <sourceApp>',
    'Content-Type: application/json',
  ]) {
    assert.match(rest, new RegExp(header.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('S10.2 docs document merchant outbound webhook as future, not current', () => {
  const text = integrationDocsText();
  assert.match(text, /Merchant outbound webhook\/callback delivery is a future phase and is not part of S10\.2\./);
  assert.doesNotMatch(text, /merchant outbound webhook is implemented|callback delivery is implemented/i);
});
