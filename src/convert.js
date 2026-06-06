'use strict'
const { Parser } = require('@signalk/nmea0183-signalk')

// Converts mux records to SignalK deltas. The raw log's timestamp is the
// truth: it overwrites every update's timestamp (ISO). Unparseable payloads
// are tallied in stats and never throw — the spec's error model is
// "skip, count, report at the end".
//
// Stats counters:
//   skipped      — corrupt input: parser.parse or JSON.parse threw (bad checksum,
//                  invalid syntax, etc.)
//   unrecognized — clean parse but no usable delta: parser returned null/undefined
//                  (unknown-but-valid sentence type) or valid JSON lacked a
//                  non-empty updates array.
//
// Invariant: lines === deltas + skipped + unsupported + unrecognized
function createConverter() {
  const parser = new Parser()
  const stats = { lines: 0, deltas: 0, skipped: 0, unsupported: 0, unrecognized: 0 }

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
      stats.unrecognized++
      return []
    }
    for (const u of delta.updates) u.timestamp = iso
    stats.deltas++
    return [delta]
  }
  return { convert, stats }
}
module.exports = { createConverter }
