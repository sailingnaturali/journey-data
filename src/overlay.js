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

const OVERLAY_FIELDS = [
  'windSpeedTrueKn', 'windSpeedApparentKn', 'windDirTrueDeg', 'windAngleApparentDeg',
  'speedThroughWaterKn', 'speedOverGroundKn', 'headingTrueDeg', 'courseOverGroundDeg',
  'lat', 'lon', 'depthBelowKeel', 'depthBelowTransducer', 'seaState', 'seaStateLabel',
  'batterySocPct', 'batteryVoltage', 'batteryCurrentA', 'batteryPowerW',
  'solarPowerW', 'regenPowerW', 'freshWaterPct', 'blackWaterPct', 'greyWaterPct',
  'portEngineHours', 'stbdEngineHours',
]

function round6(x) { return Math.round(x * 1e6) / 1e6 }

// atResult: { [path]: { value, stale, ... } } from Timeline.at
function toOverlay(atResult, { feet = false, dropStale = true } = {}) {
  const v = (path) => {
    const e = atResult[path]
    if (!e || e.value === undefined || e.value === null) return null
    if (dropStale && e.stale) return null
    return e.value
  }
  const conv = (path, fn) => { const x = v(path); return x === null ? null : fn(x) }
  const depth = (path) => conv(path, (x) => (feet ? mToFeet(x) : round1(x)))

  const pos = v('navigation.position')
  const seaState = v('environment.water.swell.state')
  const volt = v('electrical.batteries.house.voltage')
  const amp = v('electrical.batteries.house.current')
  const pPort = v('propulsion.port.power')
  const pStbd = v('propulsion.starboard.power')
  let regenPowerW = null
  if (pPort !== null || pStbd !== null) {
    const total = (pPort || 0) + (pStbd || 0)
    regenPowerW = total < 0 ? Math.round(-total) : 0
  }
  const solar = v('electrical.solar.0.panelPower')

  return {
    windSpeedTrueKn: conv('environment.wind.speedTrue', mpsToKnots),
    windSpeedApparentKn: conv('environment.wind.speedApparent', mpsToKnots),
    windDirTrueDeg: conv('environment.wind.directionTrue', radToDeg360),
    windAngleApparentDeg: conv('environment.wind.angleApparent', radToDegSigned),
    speedThroughWaterKn: conv('navigation.speedThroughWater', mpsToKnots),
    speedOverGroundKn: conv('navigation.speedOverGround', mpsToKnots),
    headingTrueDeg: conv('navigation.headingTrue', radToDeg360),
    courseOverGroundDeg: conv('navigation.courseOverGroundTrue', radToDeg360),
    lat: pos === null ? null : round6(pos.latitude),
    lon: pos === null ? null : round6(pos.longitude),
    depthBelowKeel: depth('environment.depth.belowKeel'),
    depthBelowTransducer: depth('environment.depth.belowTransducer'),
    seaState: seaState === null ? null : seaState,
    seaStateLabel: seaState === null ? null : seaStateLabel(seaState),
    batterySocPct: conv('electrical.batteries.house.capacity.stateOfCharge', ratioToPct),
    batteryVoltage: volt === null ? null : round1(volt),
    batteryCurrentA: amp === null ? null : round1(amp),
    batteryPowerW: (volt === null || amp === null) ? null : Math.round(volt * amp),
    solarPowerW: solar === null ? null : Math.round(solar),
    regenPowerW,
    freshWaterPct: conv('tanks.freshWater.0.currentLevel', ratioToPct),
    blackWaterPct: conv('tanks.blackWater.0.currentLevel', ratioToPct),
    greyWaterPct: conv('tanks.greyWater.0.currentLevel', ratioToPct),
    portEngineHours: conv('propulsion.port.runTime', secToHours),
    stbdEngineHours: conv('propulsion.starboard.runTime', secToHours),
  }
}

module.exports = {
  round1, mpsToKnots, radToDeg360, radToDegSigned, ratioToPct, secToHours,
  mToFeet, seaStateLabel, buildTimeline, Timeline, toOverlay, OVERLAY_FIELDS,
}
