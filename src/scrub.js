'use strict'
// Declarative scrubbing per scrub-list.json: dropPaths are globs where '*'
// matches anything; redactPatterns are regex sources applied to string values.
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

function compile(list) {
  const dropPaths = list.dropPaths || []
  const drop = dropPaths.map(g => new RegExp('^' + g.split('*').map(escapeRe).join('.*') + '$'))
  // prefix: the part before the first '*', trailing dot stripped.
  // e.g. 'communication.*' -> 'communication', 'notes.*' -> 'notes', 'exact' -> ''
  const prefixes = dropPaths.map(g => {
    const star = g.indexOf('*')
    if (star === -1) return ''
    return g.slice(0, star).replace(/\.$/, '')
  })
  return {
    drop,
    prefixes,
    redact: (list.redactPatterns || []).map(p => new RegExp(p, 'g'))
  }
}

// Recursively redact string leaves inside objects/arrays; returns new value (non-mutating).
function redactDeep(value, redactRes) {
  if (typeof value === 'string') {
    return redactRes.reduce((s, re) => s.replace(re, '[redacted]'), value)
  }
  if (Array.isArray(value)) {
    return value.map(item => redactDeep(item, redactRes))
  }
  if (value !== null && typeof value === 'object') {
    const result = {}
    for (const k of Object.keys(value)) {
      result[k] = redactDeep(value[k], redactRes)
    }
    return result
  }
  return value
}

// Flatten a plain object into dot-separated synthetic paths, yielding [syntheticPath, leafValue].
function* flattenObject(obj, prefix) {
  for (const k of Object.keys(obj)) {
    const synPath = prefix ? prefix + '.' + k : k
    const v = obj[k]
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      yield* flattenObject(v, synPath)
    } else {
      yield [synPath, v]
    }
  }
}

// Drop keys from a plain object whose synthetic paths match drop regexes or prefixes.
// Returns a new object; returns null if nothing survives.
function scrubPathEmptyObject(obj, { drop, prefixes }) {
  // Collect top-level keys to keep.
  const result = {}
  for (const k of Object.keys(obj)) {
    const topSynPath = k
    // Check if the top-level key itself matches a drop regex or prefix.
    const droppedByPrefix = prefixes.some(p => p !== '' && (topSynPath === p || topSynPath.startsWith(p + '.')))
    const droppedByRegex = drop.some(re => re.test(topSynPath))
    if (droppedByPrefix || droppedByRegex) continue

    const v = obj[k]
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      // For nested objects, check each leaf's synthetic path.
      const nested = {}
      let hasLeaf = false
      for (const [synPath] of flattenObject(v, k)) {
        // We only need to check if the full synthetic path is dropped.
        const leafDropped = drop.some(re => re.test(synPath)) ||
          prefixes.some(p => p !== '' && (synPath === p || synPath.startsWith(p + '.')))
        if (!leafDropped) {
          hasLeaf = true
        }
      }
      if (hasLeaf) {
        // Rebuild nested without dropped leaves (shallow: only need one level for now,
        // but recurse for full correctness).
        const sub = scrubPathEmptyObject(v, { drop, prefixes })
        if (sub !== null) result[k] = sub
      }
    } else {
      result[k] = v
    }
  }
  return Object.keys(result).length ? result : null
}

function scrubDelta(delta, compiled) {
  const updates = []
  for (const u of delta.updates || []) {
    const rawValues = u.values || []
    const values = []

    for (const v of rawValues) {
      const path = v.path || ''

      if (path === '' && v.value !== null && typeof v.value === 'object' && !Array.isArray(v.value)) {
        // Fix 1: path-'' vessel-level object — scrub nested keys against dropPaths, then redact.
        const scrubbed = scrubPathEmptyObject(v.value, compiled)
        if (scrubbed === null) continue
        const redacted = redactDeep(scrubbed, compiled.redact)
        values.push({ ...v, value: redacted })
      } else if (compiled.drop.some(re => re.test(path))) {
        // Drop this value entirely.
        continue
      } else {
        // Fix 2: redact strings inside any value (string, object, array).
        const redacted = redactDeep(v.value, compiled.redact)
        values.push({ ...v, value: redacted })
      }
    }

    // Fix 3: preserve meta-only updates even when values is empty.
    const hasMeta = u.meta && u.meta.length > 0
    if (values.length || hasMeta) {
      const next = { ...u }
      if (rawValues.length || values.length) next.values = values
      updates.push(next)
    }
  }
  return updates.length ? { ...delta, updates } : null
}

module.exports = { compile, scrubDelta }
