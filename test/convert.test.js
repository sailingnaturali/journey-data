'use strict'
const { test } = require('node:test')
const assert = require('node:assert')
const { createConverter } = require('../src/convert')

test('N line converts to a delta with the log timestamp', () => {
  const c = createConverter()
  const out = c.convert({
    ts: 1754000000000, disc: 'N',
    payload: '$GPGLL,6005.071,N,02332.346,E,095559,A,D*43'
  })
  assert.strictEqual(out.length, 1)
  const paths = out[0].updates.flatMap(u => (u.values || []).map(v => v.path))
  assert.ok(paths.includes('navigation.position'), `got paths: ${paths}`)
  for (const u of out[0].updates) {
    assert.strictEqual(u.timestamp, new Date(1754000000000).toISOString())
  }
})

test('I line passes through as a delta, timestamp overridden', () => {
  const c = createConverter()
  const payload = JSON.stringify({
    context: 'vessels.self',
    updates: [{ timestamp: '2020-01-01T00:00:00Z', values: [{ path: 'environment.depth.belowSurface', value: 38.2 }] }]
  })
  const out = c.convert({ ts: 1754000001000, disc: 'I', payload })
  assert.strictEqual(out[0].updates[0].timestamp, new Date(1754000001000).toISOString())
  assert.strictEqual(out[0].updates[0].values[0].value, 38.2)
})

test('A lines count as unsupported; garbage counts as skipped; neither throws', () => {
  const c = createConverter()
  assert.deepStrictEqual(c.convert({ ts: 1, disc: 'A', payload: 'A173321.107 23FF7 1F513 012F3070002F30709F' }), [])
  assert.deepStrictEqual(c.convert({ ts: 1, disc: 'N', payload: '$GPXXX,borked*00' }), [])
  assert.deepStrictEqual(c.convert({ ts: 1, disc: 'I', payload: '{not json' }), [])
  assert.strictEqual(c.stats.unsupported, 1)
  assert.strictEqual(c.stats.skipped, 2)
})
