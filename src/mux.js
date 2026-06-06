'use strict'
// One line of a SignalK raw multiplexed log: "<epochMillis>;<discriminator>;<payload>".
// Only the first two ';' delimit fields — payloads may contain ';'.
function parseMuxLine(line) {
  const first = line.indexOf(';')
  if (first === -1) return null
  const second = line.indexOf(';', first + 1)
  if (second === -1) return null
  const ts = Number(line.slice(0, first))
  if (!Number.isFinite(ts) || ts <= 0) return null
  return { ts, disc: line.slice(first + 1, second), payload: line.slice(second + 1) }
}
module.exports = { parseMuxLine }
