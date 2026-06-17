'use strict'

function round1(x) { return Math.round(x * 10) / 10 }
function mpsToKnots(v) { return round1(v * 1.943844) }
function radToDeg360(v) { let d = (v * 57.29578) % 360; if (d < 0) d += 360; return round1(d) }
function radToDegSigned(v) { let d = (v * 57.29578) % 360; if (d < 0) d += 360; d = Math.round(d * 100) / 100; if (d > 180) d -= 360; return round1(d) }
function ratioToPct(v) { return round1(v * 100) }
function secToHours(v) { return round1(v / 3600) }
function mToFeet(v) { return round1(v * 3.28084) }

const DOUGLAS = [
  'Calm (glassy)', 'Calm (rippled)', 'Smooth', 'Slight', 'Moderate',
  'Rough', 'Very rough', 'High', 'Very high', 'Phenomenal',
]
function seaStateLabel(n) { return DOUGLAS[n] ?? null }

// Largest index i with arr[i].t <= ms, or -1 if none. arr sorted ascending by t.
function lastAtOrBefore(arr, ms) {
  let lo = 0, hi = arr.length - 1, ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (arr[mid].t <= ms) { ans = mid; lo = mid + 1 } else { hi = mid - 1 }
  }
  return ans
}

class Timeline {
  constructor(series, start, end) { this.series = series; this.start = start; this.end = end }

  at(t, { maxStaleSec = 30 } = {}) {
    const ms = typeof t === 'number' ? t : Date.parse(t)
    const out = {}
    for (const [path, arr] of this.series) {
      const idx = lastAtOrBefore(arr, ms)
      if (idx === -1) { out[path] = { value: null, t: null, ageSec: null, stale: true }; continue }
      const s = arr[idx]
      const ageSec = (ms - s.t) / 1000
      out[path] = { value: s.value, t: s.t, ageSec: round1(ageSec), stale: ageSec > maxStaleSec }
    }
    return out
  }
}

function buildTimeline(deltas) {
  const series = new Map()
  let start = null, end = null
  for (const d of deltas) {
    for (const u of d.updates || []) {
      const t = Date.parse(u.timestamp)
      if (!Number.isFinite(t)) continue
      start = start === null ? t : Math.min(start, t)
      end = end === null ? t : Math.max(end, t)
      for (const v of u.values || []) {
        if (!v || !v.path) continue
        if (!series.has(v.path)) series.set(v.path, [])
        series.get(v.path).push({ t, value: v.value })
      }
    }
  }
  for (const arr of series.values()) arr.sort((a, b) => a.t - b.t)
  return new Timeline(series, start, end)
}

module.exports = {
  round1, mpsToKnots, radToDeg360, radToDegSigned, ratioToPct, secToHours,
  mToFeet, seaStateLabel, buildTimeline, Timeline,
}
