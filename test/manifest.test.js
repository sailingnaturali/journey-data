'use strict'
const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { upsertTrip } = require('../src/manifest')

function tmpManifest() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jd-')), 'manifest.json')
}

test('creates manifest with header on first upsert', () => {
  const p = tmpManifest()
  const m = upsertTrip(p, { id: 'a', start: '2026-08-01T00:00:00Z' })
  assert.strictEqual(m.manifestVersion, 1)
  assert.strictEqual(m.publisher, 'sailingnaturali')
  assert.strictEqual(JSON.parse(fs.readFileSync(p, 'utf8')).trips.length, 1)
})

test('replaces by id, sorts newest-start first', () => {
  const p = tmpManifest()
  upsertTrip(p, { id: 'a', start: '2026-08-01T00:00:00Z', title: 'old' })
  upsertTrip(p, { id: 'b', start: '2026-09-01T00:00:00Z' })
  const m = upsertTrip(p, { id: 'a', start: '2026-08-01T00:00:00Z', title: 'new' })
  assert.strictEqual(m.trips.length, 2)
  assert.strictEqual(m.trips[0].id, 'b')
  assert.strictEqual(m.trips[1].title, 'new')
})

test('publisher arg: sets on create, overwrites on update, omitted leaves default/existing', () => {
  const p = tmpManifest()
  // create with explicit publisher
  let m = upsertTrip(p, { id: 'a', start: '2026-08-01T00:00:00Z' }, 'acme')
  assert.strictEqual(m.publisher, 'acme')
  // update with a new publisher overwrites
  m = upsertTrip(p, { id: 'a', start: '2026-08-01T00:00:00Z' }, 'acme2')
  assert.strictEqual(m.publisher, 'acme2')
  // omitted publisher leaves the existing value untouched
  m = upsertTrip(p, { id: 'b', start: '2026-09-01T00:00:00Z' })
  assert.strictEqual(m.publisher, 'acme2')
})

test('publisher omitted on a fresh manifest keeps the sailingnaturali default', () => {
  const p = tmpManifest()
  const m = upsertTrip(p, { id: 'a', start: '2026-08-01T00:00:00Z' })
  assert.strictEqual(m.publisher, 'sailingnaturali')
})
