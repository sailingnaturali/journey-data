#!/usr/bin/env node
'use strict'
const { parseArgs } = require('node:util')
const fs = require('node:fs')
const { loadTrip, toOverlay, OVERLAY_FIELDS } = require('./overlay')

// "hh:mm:ss" or "mm:ss" or "ss" -> seconds
function parseClock(s) {
  const parts = String(s).split(':').map(Number)
  if (parts.some((n) => !Number.isFinite(n))) throw new Error(`bad --at clock: ${s}`)
  return parts.reduce((acc, n) => acc * 60 + n, 0)
}

function resolveTime(v) {
  if (v.time) return Date.parse(v.time)
  if (v['video-start'] && v.at != null) return Date.parse(v['video-start']) + parseClock(v.at) * 1000
  throw new Error('provide --time <UTC>, or --video-start <UTC> with --at <clock>')
}

function prettyAt(fields) {
  const f = fields
  const dir = f.windDirTrueDeg == null ? '—' : `${f.windDirTrueDeg}°`
  const lines = [
    `Wind:  ${f.windSpeedTrueKn ?? '—'} kn @ ${dir} (true) · AWA ${f.windAngleApparentDeg ?? '—'}°`,
    `Boat:  STW ${f.speedThroughWaterKn ?? '—'} kn · SOG ${f.speedOverGroundKn ?? '—'} kn · HDG ${f.headingTrueDeg ?? '—'}°`,
    `Depth: ${f.depthBelowKeel ?? '—'} (below keel) · Sea state ${f.seaState ?? '—'}${f.seaStateLabel ? ` (${f.seaStateLabel})` : ''}`,
    `Power: SOC ${f.batterySocPct ?? '—'}% · ${f.batteryPowerW ?? '—'} W · solar ${f.solarPowerW ?? '—'} W · regen ${f.regenPowerW ?? '—'} W`,
  ]
  return lines.join('\n')
}

function csvCell(x) {
  if (x === null || x === undefined) return ''
  const s = String(x)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
function csvLine(cells) { return cells.map(csvCell).join(',') }

function rowsToCsv(rows, columns) {
  const out = [csvLine(columns)]
  for (const r of rows) out.push(csvLine(columns.map((c) => r[c])))
  return out.join('\n') + '\n'
}

function emit(text, outPath) {
  if (outPath) fs.writeFileSync(outPath, text)
  else process.stdout.write(text)
}

// minimal CSV reader: first row is the header; returns array of row objects
function readCsv(file) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l.length)
  if (lines.length === 0) return []
  const header = lines[0].split(',')
  return lines.slice(1).map((l) => {
    const cells = l.split(',')
    return Object.fromEntries(header.map((h, i) => [h.trim(), (cells[i] ?? '').trim()]))
  })
}

async function main() {
  const { values, positionals } = parseArgs({
    options: {
      time: { type: 'string' }, 'video-start': { type: 'string' }, at: { type: 'string' },
      json: { type: 'boolean', default: false }, feet: { type: 'boolean', default: false },
      'max-stale': { type: 'string' }, hz: { type: 'string' }, moments: { type: 'string' },
      out: { type: 'string', short: 'o' },
    },
    allowPositionals: true,
  })
  const [cmd, trip] = positionals
  if (!trip || !['at', 'export', 'moments'].includes(cmd)) {
    console.error('usage: node src/overlay-cli.js <at|export|moments> <trip.jsonl[.gz]> [options]')
    process.exit(2)
  }
  const opts = { feet: values.feet }
  if (values['max-stale'] != null) opts.maxStaleSec = Number(values['max-stale'])
  const tl = await loadTrip(trip)

  if (cmd === 'export') {
    const hz = values.hz != null ? Number(values.hz) : 1
    const rows = tl.resample(hz, opts)
    emit(rowsToCsv(rows, ['timestamp', ...OVERLAY_FIELDS]), values.out)
    return
  }

  if (cmd === 'moments') {
    if (!values.moments) { console.error('moments: --moments <file.csv> required'); process.exit(2) }
    const input = readCsv(values.moments)
    if (input.length === 0) console.error('warning: no moments in input')
    const rows = input.map((m) => {
      const ms = Date.parse(m.timestamp)
      const fields = toOverlay(tl.at(ms, opts), opts)
      return { timestamp: m.timestamp, label: m.label ?? '', ...fields }
    })
    emit(rowsToCsv(rows, ['timestamp', 'label', ...OVERLAY_FIELDS]), values.out)
    return
  }

  // cmd === 'at'
  const ms = resolveTime(values)
  if (ms < tl.start || ms > tl.end) console.error(`warning: ${new Date(ms).toISOString()} is outside trip [${new Date(tl.start).toISOString()}, ${new Date(tl.end).toISOString()}]`)
  const provenance = tl.at(ms, opts)
  const fields = toOverlay(provenance, opts)
  if (values.json) console.log(JSON.stringify({ time: new Date(ms).toISOString(), fields, provenance }, null, 2))
  else console.log(prettyAt(fields))
}

if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1) })
module.exports = { parseClock, resolveTime, main }
