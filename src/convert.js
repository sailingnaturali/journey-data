'use strict'
const { Parser } = require('@signalk/nmea0183-signalk')

// Converts mux records to SignalK deltas. The raw log's timestamp is the
// truth: it overwrites every update's timestamp (ISO). Unparseable payloads
// are skipped (never throw) and tallied in stats — the spec's error model is
// "skip, count, report at the end".
function createConverter() {
  const parser = new Parser()
  const stats = { lines: 0, deltas: 0, skipped: 0, unsupported: 0 }

  function convert(rec) {
    stats.lines++
    const iso = new Date(rec.ts).toISOString()
    let delta = null
    try {
      if (rec.disc === 'N') delta = parser.parse(rec.payload)
      else if (rec.disc === 'I') delta = JSON.parse(rec.payload)
      else { stats.unsupported++; return [] }
    } catch {
      stats.skipped++
      return []
    }
    if (!delta || !Array.isArray(delta.updates) || delta.updates.length === 0) {
      stats.skipped++
      return []
    }
    for (const u of delta.updates) u.timestamp = iso
    stats.deltas++
    return [delta]
  }
  return { convert, stats }
}
module.exports = { createConverter }
