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

const RELEASE_BASE = 'https://github.com/sailingnaturali/journey-data/releases/download'

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

// Track bbox [minLon, minLat, maxLon, maxLat] and top-level path groups.
function makeCollector() {
  const groups = new Set()
  let bbox = null
  function see(values) {
    for (const v of values) {
      if (v.path) groups.add(v.path.split('.')[0])
      if (v.path === 'navigation.position' && v.value &&
          typeof v.value.latitude === 'number' && typeof v.value.longitude === 'number') {
        const { latitude: lat, longitude: lon } = v.value
        bbox = bbox
          ? [Math.min(bbox[0], lon), Math.min(bbox[1], lat), Math.max(bbox[2], lon), Math.max(bbox[3], lat)]
          : [lon, lat, lon, lat]
      }
    }
  }
  return { see, get: () => ({ bbox, paths: [...groups].sort() }) }
}

async function publish(opts) {
  const compiled = compile(JSON.parse(fs.readFileSync(opts.scrubListPath, 'utf8')))
  const converter = createConverter()
  const collector = makeCollector()
  fs.mkdirSync(opts.outDir, { recursive: true })

  const deltasFile = path.join(opts.outDir, `${opts.id}.jsonl.gz`)
  const rawFile = path.join(opts.outDir, `${opts.id}.raw.log.gz`)
  const gzOut = zlib.createGzip()
  const outStream = fs.createWriteStream(deltasFile)
  gzOut.pipe(outStream)

  // Fix 1: byte-faithful raw copy — pipe each input directly through gzip without
  // touching the bytes (preserves \r, blank lines, exact encoding).
  // Sequentially append all inputs into one gzip stream: write file1 bytes then file2 bytes.
  const rawGz = zlib.createGzip()
  const rawStream = fs.createWriteStream(rawFile)
  rawGz.pipe(rawStream)
  for (let i = 0; i < opts.inputs.length; i++) {
    const src = fs.createReadStream(opts.inputs[i])
    await pipeline(src, rawGz, { end: i === opts.inputs.length - 1 })
  }
  await new Promise(r => rawStream.on('finish', r))

  // Fix 2: CLI-owned malformed counter — non-blank lines that aren't valid mux format.
  // converter.stats.lines then counts only records handed to convert(); that's correct.
  let malformed = 0
  let firstTs = null
  let lastTs = null
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
        const clean = scrubDelta(delta, compiled)
        if (!clean) continue
        firstTs = firstTs === null ? rec.ts : firstTs
        lastTs = rec.ts
        for (const u of clean.updates) collector.see(u.values || [])
        bodyLines.push(JSON.stringify(clean))
      }
    }
  }

  const { bbox, paths } = collector.get()
  const meta = {
    journeyDataVersion: 1, id: opts.id, title: opts.title, region: opts.region,
    start: firstTs && new Date(firstTs).toISOString(),
    end: lastTs && new Date(lastTs).toISOString(), bbox, paths
  }
  gzOut.write(JSON.stringify(meta) + '\n')
  for (const l of bodyLines) gzOut.write(l + '\n')
  gzOut.end()
  await new Promise(r => outStream.on('finish', r))

  const entry = {
    id: opts.id, title: opts.title,
    start: meta.start, end: meta.end,
    region: opts.region, bbox, paths,
    files: {
      deltas: { url: `${RELEASE_BASE}/${opts.id}/${opts.id}.jsonl.gz`, sha256: sha256(deltasFile), bytes: fs.statSync(deltasFile).size },
      raw: { url: `${RELEASE_BASE}/${opts.id}/${opts.id}.raw.log.gz`, sha256: sha256(rawFile), bytes: fs.statSync(rawFile).size }
    },
    ...(opts.video ? { video: opts.video } : {}),
    ...(opts.post ? { post: opts.post } : {})
  }
  upsertTrip(opts.manifestPath, entry)
  return { entry, stats: { ...converter.stats, malformed }, deltasFile, rawFile }
}

async function main() {
  const { values, positionals } = parseArgs({
    options: {
      id: { type: 'string' }, title: { type: 'string' }, region: { type: 'string' },
      video: { type: 'string' }, post: { type: 'string' },
      out: { type: 'string', default: 'dist' },
      manifest: { type: 'string', default: 'manifest.json' },
      'scrub-list': { type: 'string', default: 'scrub-list.json' }
    },
    allowPositionals: true
  })
  if (!values.id || !values.title || positionals.length === 0) {
    console.error('usage: node src/cli.js --id <id> --title <t> [--region r] [--video url] [--post url] <raw.log>...')
    process.exit(2)
  }
  const r = await publish({
    inputs: positionals, id: values.id, title: values.title, region: values.region,
    video: values.video, post: values.post, outDir: values.out,
    manifestPath: values.manifest, scrubListPath: values['scrub-list']
  })
  console.log(JSON.stringify(r.stats))
  console.log(`\nwrote ${r.deltasFile} and ${r.rawFile}; manifest updated.`)
  console.log(`publish with:\n  gh release create ${r.entry.id} ${r.deltasFile} ${r.rawFile} --title "${r.entry.title}" --notes "See manifest.json"`)
  console.log('then commit manifest.json.')
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1) })
module.exports = { publish }
