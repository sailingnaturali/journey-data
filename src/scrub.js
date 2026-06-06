'use strict'
// Declarative scrubbing per scrub-list.json: dropPaths are globs where '*'
// matches anything; redactPatterns are regex sources applied to string values.
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

function compile(list) {
  return {
    drop: (list.dropPaths || []).map(
      g => new RegExp('^' + g.split('*').map(escapeRe).join('.*') + '$')
    ),
    redact: (list.redactPatterns || []).map(p => new RegExp(p, 'g'))
  }
}

function scrubDelta(delta, compiled) {
  const updates = []
  for (const u of delta.updates || []) {
    const values = (u.values || [])
      .filter(v => !compiled.drop.some(re => re.test(v.path || '')))
      .map(v => {
        if (typeof v.value !== 'string') return v
        const value = compiled.redact.reduce((s, re) => s.replace(re, '[redacted]'), v.value)
        return { ...v, value }
      })
    if (values.length) updates.push({ ...u, values })
  }
  return updates.length ? { ...delta, updates } : null
}
module.exports = { compile, scrubDelta }
