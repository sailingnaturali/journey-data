'use strict'
const { test } = require('node:test')
const assert = require('node:assert')
const { parseMuxLine } = require('../src/mux')

test('parses a well-formed N line', () => {
  const r = parseMuxLine('1754000000000;N;$GPGLL,6005.071,N,02332.346,E,095559,A,D*43')
  assert.deepStrictEqual(r, {
    ts: 1754000000000,
    disc: 'N',
    payload: '$GPGLL,6005.071,N,02332.346,E,095559,A,D*43'
  })
})

test('payload may itself contain semicolons', () => {
  const r = parseMuxLine('1754000000001;I;{"a":"x;y"}')
  assert.strictEqual(r.payload, '{"a":"x;y"}')
})

test('returns null for garbage', () => {
  assert.strictEqual(parseMuxLine('not a mux line'), null)
  assert.strictEqual(parseMuxLine('abc;N;$GPGLL'), null)
  assert.strictEqual(parseMuxLine(''), null)
  assert.strictEqual(parseMuxLine('0;N;payload'), null)
  assert.strictEqual(parseMuxLine('-100;N;payload'), null)
})
