'use strict'
const { parseArgs } = require('node:util')
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
  if (cmd !== 'at' || !trip) {
    console.error('usage: node src/overlay-cli.js at <trip.jsonl[.gz]> (--time <UTC> | --video-start <UTC> --at <clock>) [--json] [--feet] [--max-stale <sec>]')
    process.exit(2)
  }
  const opts = { feet: values.feet }
  if (values['max-stale'] != null) opts.maxStaleSec = Number(values['max-stale'])

  const tl = await loadTrip(trip)
  const ms = resolveTime(values)
  if (ms < tl.start || ms > tl.end) console.error(`warning: ${new Date(ms).toISOString()} is outside trip [${new Date(tl.start).toISOString()}, ${new Date(tl.end).toISOString()}]`)
  const provenance = tl.at(ms, opts)
  const fields = toOverlay(provenance, opts)
  if (values.json) console.log(JSON.stringify({ time: new Date(ms).toISOString(), fields, provenance }, null, 2))
  else console.log(prettyAt(fields))
}

if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1) })
module.exports = { parseClock, resolveTime, main }
