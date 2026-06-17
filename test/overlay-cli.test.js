'use strict'
const { test } = require('node:test')
const assert = require('node:assert')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const CLI = path.join(__dirname, '..', 'src', 'overlay-cli.js')

function delta(ts, path_, value) {
  return { context: 'vessels.self', updates: [{ timestamp: ts, values: [{ path: path_, value }] }] }
}
function tripFile(lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'overlay-cli-'))
  const file = path.join(dir, 't.jsonl')
  fs.writeFileSync(file, lines.join('\n') + '\n')
  return file
}
function run(args) { return execFileSync('node', [CLI, ...args], { encoding: 'utf8' }) }

const TRIP = () => tripFile([
  '{"journeyDataVersion":1}',
  JSON.stringify(delta('2026-06-06T00:00:00.000Z', 'environment.wind.speedTrue', 7.7)),
  JSON.stringify(delta('2026-06-06T00:00:00.000Z', 'environment.wind.directionTrue', Math.PI)),
])

test('at --json prints converted fields + provenance', () => {
  const out = run(['at', TRIP(), '--time', '2026-06-06T00:00:00.000Z', '--json'])
  const o = JSON.parse(out)
  assert.strictEqual(o.fields.windSpeedTrueKn, 15.0)
  assert.strictEqual(o.fields.windDirTrueDeg, 180)
  assert.ok(o.provenance['environment.wind.speedTrue'])
})

test('at --video-start + --at maps clip offset to UTC', () => {
  const out = run(['at', TRIP(), '--video-start', '2026-06-05T23:59:30.000Z', '--at', '00:30', '--json'])
  assert.strictEqual(JSON.parse(out).fields.windSpeedTrueKn, 15.0)
})

test('at pretty output mentions wind', () => {
  const out = run(['at', TRIP(), '--time', '2026-06-06T00:00:00.000Z'])
  assert.match(out, /Wind/)
})

const TRIP2 = () => tripFile([
  '{"journeyDataVersion":1}',
  JSON.stringify(delta('2026-06-06T00:00:00.000Z', 'environment.wind.speedTrue', 7.7)),
  JSON.stringify(delta('2026-06-06T00:00:02.000Z', 'environment.wind.speedTrue', 9.26)),
])

test('export writes a CSV with header timestamp + overlay fields', () => {
  const out = run(['export', TRIP2(), '--hz', '1'])
  const lines = out.trim().split('\n')
  assert.match(lines[0], /^timestamp,windSpeedTrueKn,/)
  assert.strictEqual(lines.length, 1 + 3) // header + 3 rows (t=0,1,2)
  assert.match(lines[1], /2026-06-06T00:00:00.000Z,15/)
})

test('moments resolves a CSV of timestamps to overlay rows', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'moments-'))
  const mfile = path.join(dir, 'm.csv')
  fs.writeFileSync(mfile, 'timestamp,label\n2026-06-06T00:00:00.000Z,gust\n')
  const out = run(['moments', TRIP2(), '--moments', mfile])
  const lines = out.trim().split('\n')
  assert.match(lines[0], /^timestamp,label,windSpeedTrueKn,/)
  assert.match(lines[1], /^2026-06-06T00:00:00.000Z,gust,15/)
})
