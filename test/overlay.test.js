'use strict'
const { test } = require('node:test')
const assert = require('node:assert')
const {
  round1, mpsToKnots, radToDeg360, radToDegSigned, ratioToPct, secToHours,
  mToFeet, seaStateLabel,
} = require('../src/overlay')

test('mpsToKnots converts m/s to knots, 1 decimal', () => {
  assert.strictEqual(mpsToKnots(7.7), 15.0)
  assert.strictEqual(mpsToKnots(0), 0)
})

test('radToDeg360 normalizes to [0,360)', () => {
  assert.strictEqual(radToDeg360(0), 0)
  assert.strictEqual(radToDeg360(Math.PI), 180)
  assert.strictEqual(radToDeg360(-Math.PI / 2), 270) // wraps negative
})

test('radToDegSigned maps to (-180,180]', () => {
  assert.strictEqual(radToDegSigned(Math.PI), 180)
  assert.strictEqual(radToDegSigned(-Math.PI / 2), -90)
  assert.strictEqual(radToDegSigned(1.5 * Math.PI), -90) // 270 -> -90
})

test('ratioToPct, secToHours, mToFeet', () => {
  assert.strictEqual(ratioToPct(0.553), 55.3)
  assert.strictEqual(secToHours(44280), 12.3)
  assert.strictEqual(mToFeet(10), 32.8)
})

test('seaStateLabel maps Douglas scale; out of range -> null', () => {
  assert.strictEqual(seaStateLabel(0), 'Calm (glassy)')
  assert.strictEqual(seaStateLabel(5), 'Rough')
  assert.strictEqual(seaStateLabel(9), 'Phenomenal')
  assert.strictEqual(seaStateLabel(12), null)
})

const { buildTimeline } = require('../src/overlay')

function delta(ts, path, value) {
  return { context: 'vessels.self', updates: [{ timestamp: ts, values: [{ path, value }] }] }
}

test('Timeline.at returns most-recent value at-or-before the time', () => {
  const tl = buildTimeline([
    delta('2026-06-06T00:00:00.000Z', 'environment.wind.speedTrue', 5),
    delta('2026-06-06T00:00:10.000Z', 'environment.wind.speedTrue', 7),
    delta('2026-06-06T00:00:20.000Z', 'environment.wind.speedTrue', 9),
  ])
  const r = tl.at('2026-06-06T00:00:15.000Z')
  assert.strictEqual(r['environment.wind.speedTrue'].value, 7)
  assert.strictEqual(r['environment.wind.speedTrue'].stale, false)
})

test('Timeline.at: exact-timestamp hit and pre-first -> null entry', () => {
  const tl = buildTimeline([delta('2026-06-06T00:00:10.000Z', 'navigation.speedThroughWater', 3)])
  assert.strictEqual(tl.at('2026-06-06T00:00:10.000Z')['navigation.speedThroughWater'].value, 3)
  const pre = tl.at('2026-06-06T00:00:00.000Z')['navigation.speedThroughWater']
  assert.strictEqual(pre.value, null)
  assert.strictEqual(pre.stale, true)
})

test('Timeline.at flags stale beyond maxStaleSec', () => {
  const tl = buildTimeline([delta('2026-06-06T00:00:00.000Z', 'environment.depth.belowKeel', 38)])
  const fresh = tl.at('2026-06-06T00:00:20.000Z', { maxStaleSec: 30 })['environment.depth.belowKeel']
  assert.strictEqual(fresh.stale, false)
  const stale = tl.at('2026-06-06T00:01:00.000Z', { maxStaleSec: 30 })['environment.depth.belowKeel']
  assert.strictEqual(stale.value, 38) // value still returned
  assert.strictEqual(stale.stale, true)
})

test('buildTimeline exposes start and end epoch ms', () => {
  const tl = buildTimeline([
    delta('2026-06-06T00:00:20.000Z', 'x', 1),
    delta('2026-06-06T00:00:00.000Z', 'x', 2),
  ])
  assert.strictEqual(tl.start, Date.parse('2026-06-06T00:00:00.000Z'))
  assert.strictEqual(tl.end, Date.parse('2026-06-06T00:00:20.000Z'))
})
