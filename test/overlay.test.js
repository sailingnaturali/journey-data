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
