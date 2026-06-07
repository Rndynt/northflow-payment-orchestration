/**
 * s9-4-canonical-request — unit tests for canonicalRequest.ts
 *
 * Tests the deterministic canonical string builder and HMAC signature computation
 * shared between the service verifier and the SDK signer.
 *
 * Run with: node --import tsx/esm --test apps/service/tests/s9-4-canonical-request.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  buildCanonicalString,
  canonicalQuery,
  computeSignature,
  signRequest,
  hashBody,
  CANONICAL_ALGORITHM,
  SIGNATURE_VERSION,
  EMPTY_BODY_HASH,
} from '@northflow/payment-orchestration-core';

describe('canonicalQuery', () => {
  it('returns empty string for empty input', () => {
    assert.equal(canonicalQuery({}), '');
    assert.equal(canonicalQuery(''), '');
    assert.equal(canonicalQuery('?'), '');
  });

  it('sorts keys lexicographically', () => {
    const result = canonicalQuery({ z: 'last', a: 'first', m: 'mid' });
    assert.equal(result, 'a=first&m=mid&z=last');
  });

  it('handles multiple values for same key (sorted by value)', () => {
    const result = canonicalQuery({ tag: ['beta', 'alpha', 'gamma'] });
    assert.equal(result, 'tag=alpha&tag=beta&tag=gamma');
  });

  it('percent-encodes special chars in keys and values', () => {
    const result = canonicalQuery({ 'foo bar': 'baz&qux' });
    assert.equal(result, 'foo%20bar=baz%26qux');
  });

  it('handles query string input (string form)', () => {
    const result = canonicalQuery('?b=2&a=1');
    assert.equal(result, 'a=1&b=2');
  });

  it('handles key with no value', () => {
    const result = canonicalQuery({ key: '' });
    assert.equal(result, 'key=');
  });

  it('handles undefined values by skipping them', () => {
    const result = canonicalQuery({ a: '1', b: undefined });
    assert.equal(result, 'a=1');
  });

  it('is deterministic (same output for same input)', () => {
    const input = { z: 'z', a: 'a', m: 'm' };
    assert.equal(canonicalQuery(input), canonicalQuery(input));
  });
});

describe('hashBody', () => {
  it('returns EMPTY_BODY_HASH for null', () => {
    assert.equal(hashBody(null), EMPTY_BODY_HASH);
  });

  it('returns EMPTY_BODY_HASH for undefined', () => {
    assert.equal(hashBody(undefined), EMPTY_BODY_HASH);
  });

  it('returns EMPTY_BODY_HASH for empty string', () => {
    assert.equal(hashBody(''), EMPTY_BODY_HASH);
  });

  it('returns EMPTY_BODY_HASH for empty Buffer', () => {
    assert.equal(hashBody(Buffer.alloc(0)), EMPTY_BODY_HASH);
  });

  it('returns correct hash for non-empty string', () => {
    const hash = hashBody('hello');
    assert.equal(hash, '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });

  it('returns correct hash for Buffer body', () => {
    const hash = hashBody(Buffer.from('hello'));
    assert.equal(hash, '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });

  it('returns correct hash for JSON body', () => {
    const json = JSON.stringify({ amount: 5000, currency: 'IDR' });
    const hash = hashBody(json);
    assert.match(hash, /^[0-9a-f]{64}$/);
  });
});

describe('buildCanonicalString', () => {
  it('produces correct structure for a POST with body', () => {
    const bodyHash = hashBody('{"amount":5000}');
    const result = buildCanonicalString({
      timestampMs: 1749312000000,
      nonce: 'testnonce123',
      method: 'POST',
      path: '/v1/payment-intents',
      query: {},
      bodyHash,
    });

    const lines = result.split('\n');
    assert.equal(lines.length, 7);
    assert.equal(lines[0], CANONICAL_ALGORITHM);
    assert.equal(lines[1], '1749312000000');
    assert.equal(lines[2], 'testnonce123');
    assert.equal(lines[3], 'POST');
    assert.equal(lines[4], '/v1/payment-intents');
    assert.equal(lines[5], '');
    assert.equal(lines[6], bodyHash);
  });

  it('produces correct structure for a GET with query params', () => {
    const result = buildCanonicalString({
      timestampMs: 1749312000000,
      nonce: 'abc',
      method: 'GET',
      path: '/v1/payment-intents/intent123/status',
      query: { merchantId: 'mer_cafe', includeExpired: 'false' },
      bodyHash: EMPTY_BODY_HASH,
    });

    const lines = result.split('\n');
    assert.equal(lines[3], 'GET');
    assert.equal(lines[5], 'includeExpired=false&merchantId=mer_cafe');
    assert.equal(lines[6], EMPTY_BODY_HASH);
  });

  it('upcases method', () => {
    const result = buildCanonicalString({
      timestampMs: 1000,
      nonce: 'n',
      method: 'post',
      path: '/v1/test',
      bodyHash: EMPTY_BODY_HASH,
    });
    assert.equal(result.split('\n')[3], 'POST');
  });

  it('is deterministic for same inputs', () => {
    const input = {
      timestampMs: 1749312000000,
      nonce: 'stable-nonce',
      method: 'POST',
      path: '/v1/merchants',
      query: { env: 'live' },
      bodyHash: hashBody('{}'),
    };
    assert.equal(buildCanonicalString(input), buildCanonicalString(input));
  });
});

describe('computeSignature', () => {
  it('returns a 64-char lowercase hex string', () => {
    const sig = computeSignature('my-secret', 'some-canonical-string');
    assert.match(sig, /^[0-9a-f]{64}$/);
  });

  it('is deterministic', () => {
    const s1 = computeSignature('secret', 'canonical');
    const s2 = computeSignature('secret', 'canonical');
    assert.equal(s1, s2);
  });

  it('is different for different secrets', () => {
    const s1 = computeSignature('secret-a', 'canonical');
    const s2 = computeSignature('secret-b', 'canonical');
    assert.notEqual(s1, s2);
  });

  it('is different for different canonical strings', () => {
    const s1 = computeSignature('secret', 'canonical-a');
    const s2 = computeSignature('secret', 'canonical-b');
    assert.notEqual(s1, s2);
  });
});

describe('signRequest', () => {
  it('returns both signature and canonicalString', () => {
    const result = signRequest('my-secret', {
      timestampMs: 1749312000000,
      nonce: 'nonce123',
      method: 'POST',
      path: '/v1/payment-intents',
      bodyHash: EMPTY_BODY_HASH,
    });

    assert.ok(typeof result.signature === 'string');
    assert.ok(typeof result.canonicalString === 'string');
    assert.match(result.signature, /^[0-9a-f]{64}$/);
    assert.ok(result.canonicalString.startsWith(CANONICAL_ALGORITHM));
  });

  it('signature verifies correctly', () => {
    const secret = 'test-signing-secret-32bytes-pad!!';
    const input = {
      timestampMs: 1749312000000,
      nonce: 'unique-nonce-abc',
      method: 'GET',
      path: '/v1/merchants',
      bodyHash: EMPTY_BODY_HASH,
    };

    const { signature, canonicalString } = signRequest(secret, input);

    // Re-compute independently using top-level import
    const expected = createHmac('sha256', secret).update(canonicalString).digest('hex');
    assert.equal(signature, expected);
  });

  it('signature version constant is v1', () => {
    assert.equal(SIGNATURE_VERSION, 'v1');
  });

  it('canonical algorithm constant is correct', () => {
    assert.equal(CANONICAL_ALGORITHM, 'NF-HMAC-SHA256-V1');
  });
});
