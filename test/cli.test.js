'use strict'
const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const zlib = require('node:zlib')
const { publish } = require('../src/cli')

test('publishes fixture trip: jsonl.gz + raw.gz + manifest + stats', async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-cli-'))
  const manifestPath = path.join(out, 'manifest.json')
  const result = await publish({
    inputs: [path.join(__dirname, 'fixtures', 'mini-trip.mux.log')],
    id: 'demo-mini', title: 'Mini fixture trip', region: 'Salish Sea, BC',
    video: 'https://youtube.com/example',
    outDir: out, manifestPath,
    scrubListPath: path.join(__dirname, '..', 'scrub-list.json')
  })

  const gz = path.join(out, 'demo-mini.jsonl.gz')
  const lines = zlib.gunzipSync(fs.readFileSync(gz)).toString('utf8').trim().split('\n')
  const meta = JSON.parse(lines[0])
  assert.strictEqual(meta.journeyDataVersion, 1)
  assert.strictEqual(meta.id, 'demo-mini')
  const deltas = lines.slice(1).map(l => JSON.parse(l))
  const paths = deltas.flatMap(d => d.updates.flatMap(u => u.values.map(v => v.path)))
  assert.ok(paths.includes('navigation.position'))
  assert.ok(paths.includes('environment.depth.belowSurface'))
  assert.ok(!paths.some(p => p.startsWith('notes.')), 'scrub list must apply')

  assert.ok(fs.existsSync(path.join(out, 'demo-mini.raw.log.gz')))
  const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  const trip = m.trips.find(t => t.id === 'demo-mini')
  assert.strictEqual(trip.start, new Date(1754000000000).toISOString())
  assert.strictEqual(trip.end, new Date(1754000005000).toISOString())
  assert.ok(Array.isArray(trip.bbox) && trip.bbox.length === 4)
  assert.match(trip.files.deltas.sha256, /^[0-9a-f]{64}$/)
  assert.ok(trip.files.deltas.bytes > 0)
  assert.ok(trip.files.deltas.url.includes('releases/download/demo-mini/'))

  assert.strictEqual(result.stats.unsupported, 1)
  assert.ok(result.stats.skipped >= 1)
})
