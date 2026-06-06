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

test('A lines count as unsupported; skipped vs unrecognized are distinct; neither throws', () => {
  const c = createConverter()

  // disc:'A' → unsupported (disc not handled)
  assert.deepStrictEqual(c.convert({ ts: 1, disc: 'A', payload: 'A173321.107 23FF7 1F513 012F3070002F30709F' }), [])

  // '$GPXXX,borked*00' — parser THROWS "Sentence is invalid" (bad checksum on
  // an unrecognized type) → skipped
  assert.deepStrictEqual(c.convert({ ts: 1, disc: 'N', payload: '$GPXXX,borked*00' }), [])

  // Bad checksum on a KNOWN sentence → parser throws → skipped
  assert.deepStrictEqual(c.convert({ ts: 1, disc: 'N', payload: '$GPGLL,6005.071,N,02332.346,E,095559,A,D*00' }), [])

  // Valid checksum, unknown sentence type → parser returns null → unrecognized
  // Checksum: XOR of 'GPZZZ,1,2,3' = 0x51
  assert.deepStrictEqual(c.convert({ ts: 1, disc: 'N', payload: '$GPZZZ,1,2,3*51' }), [])

  // Valid JSON I-line with no updates array → unrecognized
  assert.deepStrictEqual(c.convert({ ts: 1, disc: 'I', payload: '{"hello":1}' }), [])

  // Corrupt JSON → JSON.parse throws → skipped
  assert.deepStrictEqual(c.convert({ ts: 1, disc: 'I', payload: '{not json' }), [])

  assert.strictEqual(c.stats.unsupported,   1, 'unsupported')
  assert.strictEqual(c.stats.skipped,       3, 'skipped')      // GPXXX, bad-checksum GPGLL, bad JSON
  assert.strictEqual(c.stats.unrecognized,  2, 'unrecognized') // GPZZZ valid-cs, JSON no-updates
})

test('shared Parser accumulates multipart AIS state across convert() calls', () => {
  // AIS type 5 (vessel static data) arrives as two !AIVDM fragments.
  // A single shared Parser is stateful: it buffers frag 1 and assembles
  // the delta only when frag 2 arrives.  If someone switches to `new Parser()`
  // per call both fragments return [] and this test fails.
  const frag1 = '!AIVDM,2,1,3,B,55P5TL01VIaAL@7WKO@mBplU@<PDhh000000001S;AJ::4A80?4i@E53,0*3E'
  const frag2 = '!AIVDM,2,2,3,B,1@0000000000000,2*55'

  const c = createConverter()

  // Fragment 1: parser buffers it — no delta yet
  const out1 = c.convert({ ts: 1754000000000, disc: 'N', payload: frag1 })
  assert.deepStrictEqual(out1, [], 'frag 1 should yield no delta (buffered)')

  // Fragment 2: parser assembles the complete sentence — delta emitted
  const out2 = c.convert({ ts: 1754000001000, disc: 'N', payload: frag2 })
  assert.strictEqual(out2.length, 1, 'frag 2 should yield exactly one delta')

  // Spot-check: delta contains vessel MMSI via navigation or context
  const delta = out2[0]
  assert.ok(
    delta.context && delta.context.includes('369190000'),
    `expected MMSI 369190000 in context, got: ${delta.context}`
  )

  // Timestamp must be overridden to the record ts
  const ts = new Date(1754000001000).toISOString()
  for (const u of delta.updates) {
    assert.strictEqual(u.timestamp, ts, 'timestamp should be overridden')
  }
})
