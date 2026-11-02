'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../stage1.js'), 'utf8');
function load(crypto) {
  // Leave IndexedDB opening pending: ID generation must work during startup,
  // before storage or any React component has initialized.
  const context = { crypto, navigator: {}, indexedDB: { open: () => ({}) }, TextEncoder, TextDecoder };
  context.window = context;
  vm.runInNewContext(source, context);
  return context.DilongStage1.createId;
}

test('ID generation uses native randomUUID with its Crypto receiver and preserves the API', () => {
  const expected = '12345678-1234-4123-8123-123456789abc';
  let calls = 0;
  const crypto = {
    randomUUID() { assert.equal(this, crypto); calls++; return expected; },
    getRandomValues() { throw Error('Native UUID must take priority'); }
  };
  const native = crypto.randomUUID, id = load(crypto);
  assert.equal(calls, 1, 'startup owner already has an ID');
  assert.equal(id(), expected);
  assert.equal(calls, 2);
  assert.equal(crypto.randomUUID, native);
});

test('HTTP fallback formats secure random bytes as UUID v4 without installing a global polyfill', () => {
  const crypto = {
    getRandomValues(bytes) {
      assert.equal(this, crypto);
      assert.equal(bytes.length, 16);
      for (let i = 0; i < bytes.length; i++) bytes[i] = i;
      return bytes;
    }
  };
  const id = load(crypto);
  assert.equal(id(), '00010203-0405-4607-8809-0a0b0c0d0e0f');
  assert.equal(crypto.randomUUID, undefined);
});

test('UUID fallback forces the version and variant bits at both byte extremes', () => {
  for (const [fill, expected] of [
    [0, '00000000-0000-4000-8000-000000000000'],
    [255, 'ffffffff-ffff-4fff-bfff-ffffffffffff']
  ]) {
    const id = load({ randomUUID: null, getRandomValues: bytes => bytes.fill(fill) });
    assert.equal(id(), expected);
  }
});

test('missing secure randomness fails clearly instead of using a collision-prone ID fallback', () => {
  for (const crypto of [undefined, {}]) assert.throws(() => load(crypto), /不支持安全随机数/);
});
