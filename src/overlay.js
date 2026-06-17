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

module.exports = {
  round1, mpsToKnots, radToDeg360, radToDegSigned, ratioToPct, secToHours,
  mToFeet, seaStateLabel,
}
