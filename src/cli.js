'use strict'
const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')
const crypto = require('node:crypto')
const readline = require('node:readline')
const { pipeline } = require('node:stream/promises')
const { parseArgs } = require('node:util')
const { parseMuxLine } = require('./mux')
const { createConverter } = require('./convert')
const { compile, scrubDelta } = require('./scrub')
const { upsertTrip } = require('./manifest')
const { resolveConfig, RELEASE_BASE } = require('./config')

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

// Track bbox [minLon, minLat, maxLon, maxLat], top-level path groups, and vessel context.
function makeCollector() {
  const groups = new Set()
  let bbox = null
  // context frequency maps: positioned (deltas with a valid navigation.position)
  // and all (every delta that carries a non-empty context)
  const positionedCtx = new Map()
  const allCtx = new Map()

  function see(values, context) {
    let hasPosition = false
    for (const v of values) {
      if (v.path) groups.add(v.path.split('.')[0])
      if (v.path === 'navigation.position' && v.value &&
          typeof v.value.latitude === 'number' && isFinite(v.value.latitude) &&
          typeof v.value.longitude === 'number' && isFinite(v.value.longitude)) {
        const { latitude: lat, longitude: lon } = v.value
        bbox = bbox
          ? [Math.min(bbox[0], lon), Math.min(bbox[1], lat), Math.max(bbox[2], lon), Math.max(bbox[3], lat)]
          : [lon, lat, lon, lat]
        hasPosition = true
      }
    }
    if (context && typeof context === 'string' && context.length > 0) {
      allCtx.set(context, (allCtx.get(context) || 0) + 1)
      if (hasPosition) positionedCtx.set(context, (positionedCtx.get(context) || 0) + 1)
    }
  }

  function topKey(map) {
    let best = null; let bestCount = 0
    for (const [k, v] of map) { if (v > bestCount) { best = k; bestCount = v } }
    return best
  }

  function get() {
    const self = topKey(positionedCtx) || topKey(allCtx) || undefined
    return { bbox, paths: [...groups].sort(), self }
  }

  return { see, get }
}

async function publish(opts) {
  const compiled = compile(JSON.parse(fs.readFileSync(opts.scrubListPath, 'utf8')))
  const converter = createConverter()
  const collector = makeCollector()
  fs.mkdirSync(opts.outDir, { recursive: true })

  const deltasFile = path.join(opts.outDir, `${opts.id}.jsonl.gz`)

  // Fix 2: CLI-owned malformed counter — non-blank lines that aren't valid mux format.
  // converter.stats.lines then counts only records handed to convert(); that's correct.
  let malformed = 0
  let firstTs = null
  let lastTs = null

  // Privacy gate tracking: detect whether scrubbing altered any delta.
  let scrubbed = false
  let scrubbedCount = 0
  let firstAffected = null

  // Fix 3: meta line (start/end/bbox/paths) must be first and needs the full pass,
  // so the body is buffered; fine for a single-machine publish tool,
  // revisit only if legs outgrow RAM.
  const bodyLines = []

  for (const input of opts.inputs) {
    const rl = readline.createInterface({ input: fs.createReadStream(input), crlfDelay: Infinity })
    for await (const line of rl) {
      if (!line.trim()) continue
      const rec = parseMuxLine(line)
      if (!rec) { malformed++; continue }
      for (const delta of converter.convert(rec)) {
        // Compare pre-scrub vs post-scrub to detect any alteration.
        const preScrubJson = JSON.stringify(delta)
        const clean = scrubDelta(delta, compiled)

        // Detect if scrubbing altered this delta: null result OR JSON differs.
        if (clean === null || JSON.stringify(clean) !== preScrubJson) {
          scrubbed = true
          scrubbedCount++
          if (firstAffected === null) {
            firstAffected = { ts: rec.ts, line }
          }
        }

        if (!clean) continue
        firstTs = firstTs === null ? rec.ts : firstTs
        lastTs = rec.ts
        for (const u of clean.updates) collector.see(u.values || [], clean.context)
        bodyLines.push(JSON.stringify(clean))
      }
    }
  }

  // Write scrubbed deltas file.
  const gzOut = zlib.createGzip()
  const outStream = fs.createWriteStream(deltasFile)
  gzOut.pipe(outStream)

  const { bbox, paths, self: detectedSelf } = collector.get()
  const self = opts.self || detectedSelf
  const meta = {
    journeyDataVersion: 1, id: opts.id, title: opts.title, region: opts.region,
    start: firstTs && new Date(firstTs).toISOString(),
    end: lastTs && new Date(lastTs).toISOString(), bbox, paths,
    ...(self ? { self } : {})
  }
  gzOut.write(JSON.stringify(meta) + '\n')
  for (const l of bodyLines) gzOut.write(l + '\n')
  gzOut.end()
  await new Promise(r => outStream.on('finish', r))

  // Privacy gate: only write byte-faithful raw gzip if scrubbing changed nothing.
  let rawFile = null
  let rawWithheld = false
  const rawFilePath = path.join(opts.outDir, `${opts.id}.raw.log.gz`)

  if (!scrubbed) {
    // Safe to publish raw: re-read inputs and write byte-faithful gzip.
    rawFile = rawFilePath
    const rawGz = zlib.createGzip()
    const rawStream = fs.createWriteStream(rawFile)
    rawGz.pipe(rawStream)
    for (let i = 0; i < opts.inputs.length; i++) {
      const src = fs.createReadStream(opts.inputs[i])
      await pipeline(src, rawGz, { end: i === opts.inputs.length - 1 })
    }
    await new Promise(r => rawStream.on('finish', r))
  } else {
    rawWithheld = true
    // Delete any pre-existing raw file left by an earlier run when privacy gate withholds
    fs.rmSync(rawFilePath, { force: true })
  }

  const releaseBase = opts.releaseBase || RELEASE_BASE
  // Build manifest entry — files.raw only present when raw was published.
  const filesEntry = {
    deltas: { url: `${releaseBase}/${opts.id}/${opts.id}.jsonl.gz`, sha256: sha256(deltasFile), bytes: fs.statSync(deltasFile).size }
  }
  if (rawFile) {
    filesEntry.raw = { url: `${releaseBase}/${opts.id}/${opts.id}.raw.log.gz`, sha256: sha256(rawFile), bytes: fs.statSync(rawFile).size }
  }

  const entry = {
    id: opts.id, title: opts.title,
    start: meta.start, end: meta.end,
    region: opts.region, bbox, paths,
    files: filesEntry,
    ...(opts.video ? { video: opts.video } : {}),
    ...(opts.post ? { post: opts.post } : {})
  }
  upsertTrip(opts.manifestPath, entry, opts.publisher)
  return { entry, stats: { ...converter.stats, malformed }, deltasFile, rawFile, rawWithheld }
}

async function main() {
  const { values, positionals } = parseArgs({
    options: {
      id: { type: 'string' }, title: { type: 'string' }, region: { type: 'string' },
      self: { type: 'string' },
      video: { type: 'string' }, post: { type: 'string' },
      'release-base': { type: 'string' }, publisher: { type: 'string' },
      out: { type: 'string' },
      manifest: { type: 'string' },
      'scrub-list': { type: 'string' }
    },
    allowPositionals: true
  })
  if (!values.id || !values.title || positionals.length === 0) {
    console.error('usage: node src/cli.js --id <id> --title <t> [--region r] [--video url] [--self context] [--post url] [--release-base url|auto] [--publisher name] [--out dir] [--manifest path] [--scrub-list path] <raw.log>...')
    process.exit(2)
  }
  const cfg = resolveConfig({
    releaseBase: values['release-base'], publisher: values.publisher,
    out: values.out, manifest: values.manifest, scrubList: values['scrub-list']
  }, process.cwd())
  const r = await publish({
    inputs: positionals, id: values.id, title: values.title, region: values.region,
    self: values.self, video: values.video, post: values.post,
    outDir: cfg.out, manifestPath: cfg.manifest, scrubListPath: cfg.scrubList,
    releaseBase: cfg.releaseBase, publisher: cfg.publisher
  })
  console.log(JSON.stringify(r.stats))
  if (r.rawWithheld) {
    console.log(`\nraw log withheld: scrubbing affected delta(s) — publishing scrubbed deltas only`)
    console.log(`wrote ${r.deltasFile}; manifest updated.`)
    console.log(`publish with:\n  gh release create ${r.entry.id} ${r.deltasFile} --title "${r.entry.title}" --notes "See manifest.json"`)
  } else {
    console.log(`\nwrote ${r.deltasFile} and ${r.rawFile}; manifest updated.`)
    console.log(`publish with:\n  gh release create ${r.entry.id} ${r.deltasFile} ${r.rawFile} --title "${r.entry.title}" --notes "See manifest.json"`)
  }
  console.log('then commit manifest.json.')
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1) })
module.exports = { publish }
