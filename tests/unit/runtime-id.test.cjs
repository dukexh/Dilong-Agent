const test = require('node:test')
const assert = require('node:assert/strict')
const { S } = require('../../src/services/workflows.ts')

function withCrypto(crypto, action) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: crypto })
  try { return action() } finally { if (previous) Object.defineProperty(globalThis, 'crypto', previous); else delete globalThis.crypto }
}
test('ID generation uses native randomUUID with its Crypto receiver and preserves the API', () => {
  const expected = '12345678-1234-4123-8123-123456789abc'
  let calls = 0
  const crypto = {
    randomUUID() { assert.equal(this, crypto); calls++; return expected },
    getRandomValues() { throw Error('Native UUID must take priority') },
  }
  const native = crypto.randomUUID
  assert.equal(calls, 0, 'Importing the pure service does not create a page owner or open storage before initializeWorkflows')
  assert.equal(withCrypto(crypto, () => S.createId()), expected)
  assert.equal(calls, 1); assert.equal(crypto.randomUUID, native)
})
test('HTTP fallback formats secure random bytes as UUID v4 without installing a global polyfill', () => {
  const crypto = { getRandomValues(bytes) { assert.equal(this, crypto); assert.equal(bytes.length, 16); for (let i = 0; i < bytes.length; i++) bytes[i] = i; return bytes } }
  assert.equal(withCrypto(crypto, () => S.createId()), '00010203-0405-4607-8809-0a0b0c0d0e0f')
  assert.equal(crypto.randomUUID, undefined)
})
test('UUID fallback forces the version and variant bits at both byte extremes', () => {
  for (const [fill, expected] of [[0, '00000000-0000-4000-8000-000000000000'], [255, 'ffffffff-ffff-4fff-bfff-ffffffffffff']]) {
    assert.equal(withCrypto({ randomUUID: null, getRandomValues: bytes => bytes.fill(fill) }, () => S.createId()), expected)
  }
})
test('missing secure randomness fails clearly instead of using a collision-prone ID fallback', () => {
  for (const crypto of [undefined, {}]) assert.throws(() => withCrypto(crypto, () => S.createId()), /不支持安全随机数/)
})
