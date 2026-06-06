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

// Fix 1: path:'' object values — nested keys dropped per dropPaths
test('path:"" object values get nested keys dropped per dropPaths', () => {
  const out = scrubDelta(delta([{ path: '', value: {
    mmsi: '369190000', name: 'MT.MITCHELL',
    communication: { callsignVhf: 'WDA9674' }
  } }]), compiled)
  const v = out.updates[0].values[0].value
  assert.deepStrictEqual(v, { mmsi: '369190000', name: 'MT.MITCHELL' })
})

test('path:"" value that is entirely dropped removes the value', () => {
  const out = scrubDelta(delta([{ path: '', value: { communication: { callsignVhf: 'W' } } }]), compiled)
  assert.strictEqual(out, null)
})

// Fix 2: redact strings nested in object/array values
test('redacts token-shaped strings nested inside object values', () => {
  const out = scrubDelta(delta([{ path: 'some.path', value: { note: 'has sk_abcdefgh1234 inside', n: 1 } }]), compiled)
  assert.deepStrictEqual(out.updates[0].values[0].value, { note: 'has [redacted] inside', n: 1 })
})

// Fix 3: meta-only updates pass through
test('meta-only updates survive', () => {
  const out = scrubDelta({ context: 'vessels.self', updates: [{ timestamp: 't', meta: [{ path: 'tanks.fuel.0', value: { units: 'ratio' } }] }] }, compiled)
  assert.strictEqual(out.updates.length, 1)
  assert.deepStrictEqual(out.updates[0].meta, [{ path: 'tanks.fuel.0', value: { units: 'ratio' } }])
})

// Fix 4: production scrub-list.json sanity
test('production scrub-list.json compiles and redacts a JWT', () => {
  const prod = compile(require('../scrub-list.json'))
  const out = scrubDelta(delta([{ path: 'x.y', value: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U' }]), prod)
  assert.strictEqual(out.updates[0].values[0].value, '[redacted]')
})
