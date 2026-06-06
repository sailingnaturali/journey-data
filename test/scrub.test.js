'use strict'
const { test } = require('node:test')
const assert = require('node:assert')
const { compile, scrubDelta } = require('../src/scrub')

const compiled = compile({
  dropPaths: ['communication.*', 'notes.*'],
  redactPatterns: ['(sk|ghp)_[A-Za-z0-9_]{8,}']
})

function delta(values) {
  return { context: 'vessels.self', updates: [{ timestamp: 't', values }] }
}

test('drops values matching dropPaths globs', () => {
  const out = scrubDelta(delta([
    { path: 'communication.crewNames', value: ['Bryan'] },
    { path: 'navigation.position', value: { latitude: 48.76, longitude: -123.05 } }
  ]), compiled)
  assert.strictEqual(out.updates[0].values.length, 1)
  assert.strictEqual(out.updates[0].values[0].path, 'navigation.position')
})

test('returns null when nothing survives', () => {
  assert.strictEqual(scrubDelta(delta([{ path: 'notes.private', value: 'x' }]), compiled), null)
})

test('redacts token-shaped strings in surviving values', () => {
  const out = scrubDelta(delta([{ path: 'some.path', value: 'token sk_abcdefgh1234 end' }]), compiled)
  assert.strictEqual(out.updates[0].values[0].value, 'token [redacted] end')
})

test('non-string values pass through untouched', () => {
  const out = scrubDelta(delta([{ path: 'environment.wind.speedApparent', value: 5.4 }]), compiled)
  assert.strictEqual(out.updates[0].values[0].value, 5.4)
})
