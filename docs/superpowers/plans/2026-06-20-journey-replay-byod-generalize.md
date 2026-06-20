# Journey-Replay General Adoption — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the mechanical friction that blocks non–Sailing-Naturali users from replaying and producing journey-data: hardcoded release URLs, absolute-URL-only resolution, and an uninformative first run.

**Architecture:** Two repos, all changes additive and defaulting to today's behavior. `journey-data/src/cli.js` gains a config layer (`src/config.js`) for `--release-base` (incl. `auto` from git origin), `--publisher`, and an optional `journey.config.json`. The plugin resolves relative file URLs against the manifest URL and lists available trip ids on an empty/unknown selection.

**Tech Stack:** Node.js (CommonJS), `node:test` + `node:assert`, `node:util` `parseArgs`. No new dependencies.

**Working branch:** `claude/lucid-sagan-ij6trk` in **both** repos (already checked out). Commit in the repo each task names; never cross-stage.

**Hard invariant (verify after every task):** our own pipeline output and the published `sailingnaturali/journey-data` manifest are byte-identical to before. Existing tests in both repos must stay green — run the repo's `npm test` at the end of each task.

---

## Repo A — journey-data

### Task 1: `src/config.js` — flag/config/default resolution

**Files:**
- Create: `journey-data/src/config.js`
- Test: `journey-data/test/config.test.js`

- [ ] **Step 1: Write the failing test**

Create `journey-data/test/config.test.js`:

```js
'use strict'
const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { parseGitHubRemote, resolveConfig, RELEASE_BASE } = require('../src/config')

function tmpdir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'jd-cfg-')) }

test('parseGitHubRemote handles ssh and https forms', () => {
  assert.strictEqual(
    parseGitHubRemote('git@github.com:acme/journey-data.git'),
    'https://github.com/acme/journey-data/releases/download')
  assert.strictEqual(
    parseGitHubRemote('https://github.com/acme/journey-data.git'),
    'https://github.com/acme/journey-data/releases/download')
  assert.strictEqual(
    parseGitHubRemote('https://github.com/acme/journey-data'),
    'https://github.com/acme/journey-data/releases/download')
})

test('parseGitHubRemote throws on a non-GitHub remote', () => {
  assert.throws(() => parseGitHubRemote('https://gitlab.com/acme/x.git'))
})

test('resolveConfig: empty flags + no config file → built-in defaults', () => {
  const cfg = resolveConfig({}, tmpdir())
  assert.strictEqual(cfg.releaseBase, RELEASE_BASE)
  assert.strictEqual(cfg.out, 'dist')
  assert.strictEqual(cfg.manifest, 'manifest.json')
  assert.strictEqual(cfg.scrubList, 'scrub-list.json')
  assert.strictEqual(cfg.publisher, undefined) // no default — upsertTrip owns the create-default
})

test('resolveConfig precedence: flag > config file > default, per setting', () => {
  const dir = tmpdir()
  fs.writeFileSync(path.join(dir, 'journey.config.json'),
    JSON.stringify({ releaseBase: 'https://cfg.example/dl', publisher: 'from-config', out: 'cfg-out' }))
  const cfg = resolveConfig({ out: 'flag-out' }, dir)
  assert.strictEqual(cfg.out, 'flag-out')                       // flag wins
  assert.strictEqual(cfg.releaseBase, 'https://cfg.example/dl') // config wins over default
  assert.strictEqual(cfg.publisher, 'from-config')             // config-only key
  assert.strictEqual(cfg.manifest, 'manifest.json')            // default (unset everywhere)
})

test('resolveConfig: releaseBase "auto" resolves via parseGitHubRemote of origin', () => {
  // Use a temp git repo with a known origin so the auto path is deterministic.
  const dir = tmpdir()
  const { execFileSync } = require('node:child_process')
  execFileSync('git', ['init', '-q'], { cwd: dir })
  execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:acme/journey-data.git'], { cwd: dir })
  const cfg = resolveConfig({ releaseBase: 'auto' }, dir)
  assert.strictEqual(cfg.releaseBase, 'https://github.com/acme/journey-data/releases/download')
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd ~/src/sailingnaturali/journey-data && node --test test/config.test.js`
Expected: FAIL — `Cannot find module '../src/config'`.

- [ ] **Step 3: Write the implementation**

Create `journey-data/src/config.js`:

```js
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const RELEASE_BASE = 'https://github.com/sailingnaturali/journey-data/releases/download'

// Parse a GitHub `origin` remote (ssh or https form) into a releases/download base.
function parseGitHubRemote(remoteUrl) {
  const m = String(remoteUrl).trim()
    .match(/^(?:git@github\.com:|https:\/\/github\.com\/)([^/]+)\/(.+?)(?:\.git)?$/)
  if (!m) throw new Error(`cannot parse GitHub origin remote: ${remoteUrl}`)
  return `https://github.com/${m[1]}/${m[2]}/releases/download`
}

// Loud-fail (no silent fallback): a wrong base would generate wrong manifest URLs.
function releaseBaseFromGit(cwd) {
  let url
  try {
    url = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd, encoding: 'utf8' })
  } catch {
    throw new Error('--release-base auto: no git "origin" remote found')
  }
  return parseGitHubRemote(url)
}

// Merge CLI flags (camelCase keys, undefined when unset) with an optional
// journey.config.json in cwd and built-in defaults. Precedence per setting:
// flag > config file > default. `publisher` deliberately has NO default so it
// stays undefined unless set — that keeps upsertTrip's create-only default and
// leaves an existing manifest's publisher untouched on update.
function resolveConfig(flags, cwd) {
  const defaults = { releaseBase: RELEASE_BASE, out: 'dist', manifest: 'manifest.json', scrubList: 'scrub-list.json' }
  const cfgPath = path.join(cwd, 'journey.config.json')
  const cfg = fs.existsSync(cfgPath) ? JSON.parse(fs.readFileSync(cfgPath, 'utf8')) : {}
  const pick = (k) => (flags[k] !== undefined ? flags[k] : (cfg[k] !== undefined ? cfg[k] : defaults[k]))

  let releaseBase = pick('releaseBase')
  if (releaseBase === 'auto') releaseBase = releaseBaseFromGit(cwd)

  return {
    releaseBase,
    publisher: flags.publisher !== undefined ? flags.publisher : cfg.publisher, // may be undefined
    out: pick('out'),
    manifest: pick('manifest'),
    scrubList: pick('scrubList')
  }
}

module.exports = { RELEASE_BASE, parseGitHubRemote, releaseBaseFromGit, resolveConfig }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd ~/src/sailingnaturali/journey-data && node --test test/config.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
cd ~/src/sailingnaturali/journey-data
git add src/config.js test/config.test.js
git commit -m "feat: config resolution for cli (release-base, publisher, journey.config.json)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `src/manifest.js` — optional `publisher` arg on `upsertTrip`

**Files:**
- Modify: `journey-data/src/manifest.js`
- Test: `journey-data/test/manifest.test.js` (extend)

- [ ] **Step 1: Write the failing test**

Append to `journey-data/test/manifest.test.js`:

```js
test('publisher arg: sets on create, overwrites on update, omitted leaves default/existing', () => {
  const p = tmpManifest()
  // create with explicit publisher
  let m = upsertTrip(p, { id: 'a', start: '2026-08-01T00:00:00Z' }, 'acme')
  assert.strictEqual(m.publisher, 'acme')
  // update with a new publisher overwrites
  m = upsertTrip(p, { id: 'a', start: '2026-08-01T00:00:00Z' }, 'acme2')
  assert.strictEqual(m.publisher, 'acme2')
  // omitted publisher leaves the existing value untouched
  m = upsertTrip(p, { id: 'b', start: '2026-09-01T00:00:00Z' })
  assert.strictEqual(m.publisher, 'acme2')
})

test('publisher omitted on a fresh manifest keeps the sailingnaturali default', () => {
  const p = tmpManifest()
  const m = upsertTrip(p, { id: 'a', start: '2026-08-01T00:00:00Z' })
  assert.strictEqual(m.publisher, 'sailingnaturali')
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd ~/src/sailingnaturali/journey-data && node --test test/manifest.test.js`
Expected: FAIL — first new test gets `m.publisher === 'sailingnaturali'`, not `'acme'`.

- [ ] **Step 3: Write the implementation**

Edit `journey-data/src/manifest.js`. Replace the function with:

```js
function upsertTrip(manifestPath, entry, publisher) {
  const manifest = fs.existsSync(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    : { manifestVersion: 1, publisher: 'sailingnaturali', trips: [] }
  if (publisher) manifest.publisher = publisher
  const i = manifest.trips.findIndex(t => t.id === entry.id)
  if (i >= 0) manifest.trips[i] = entry
  else manifest.trips.push(entry)
  manifest.trips.sort((a, b) => (a.start < b.start ? 1 : -1))
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  return manifest
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd ~/src/sailingnaturali/journey-data && node --test test/manifest.test.js`
Expected: PASS (4 tests — 2 existing, 2 new).

- [ ] **Step 5: Commit**

```bash
cd ~/src/sailingnaturali/journey-data
git add src/manifest.js test/manifest.test.js
git commit -m "feat: upsertTrip accepts optional publisher (create/overwrite, else untouched)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Wire config + release base + publisher into `src/cli.js`

**Files:**
- Modify: `journey-data/src/cli.js`
- Test: `journey-data/test/cli.test.js` (extend)

- [ ] **Step 1: Write the failing test**

Append to `journey-data/test/cli.test.js`:

```js
test('publish honors opts.releaseBase and opts.publisher', async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-cli-base-'))
  const manifestPath = path.join(out, 'manifest.json')
  await publish({
    inputs: [path.join(__dirname, 'fixtures', 'mini-trip.mux.log')],
    id: 'demo-mini', title: 'Mini fixture trip', region: 'Salish Sea, BC',
    outDir: out, manifestPath,
    scrubListPath: path.join(__dirname, '..', 'scrub-list.json'),
    releaseBase: 'https://cdn.example.com/dl', publisher: 'acme'
  })
  const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  assert.strictEqual(m.publisher, 'acme')
  const trip = m.trips.find(t => t.id === 'demo-mini')
  assert.ok(trip.files.deltas.url.startsWith('https://cdn.example.com/dl/demo-mini/'),
    `unexpected url: ${trip.files.deltas.url}`)
})

test('publish without releaseBase falls back to the default RELEASE_BASE', async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-cli-defbase-'))
  const manifestPath = path.join(out, 'manifest.json')
  await publish({
    inputs: [path.join(__dirname, 'fixtures', 'mini-trip.mux.log')],
    id: 'demo-mini', title: 'Mini fixture trip',
    outDir: out, manifestPath,
    scrubListPath: path.join(__dirname, '..', 'scrub-list.json')
  })
  const trip = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).trips.find(t => t.id === 'demo-mini')
  assert.ok(trip.files.deltas.url.includes('github.com/sailingnaturali/journey-data/releases/download/demo-mini/'))
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd ~/src/sailingnaturali/journey-data && node --test test/cli.test.js`
Expected: FAIL — `releaseBase`/`publisher` ignored; url uses the hardcoded base and `m.publisher` is `sailingnaturali`.

- [ ] **Step 3: Write the implementation**

In `journey-data/src/cli.js`:

(a) Replace the top-level constant line
```js
const RELEASE_BASE = 'https://github.com/sailingnaturali/journey-data/releases/download'
```
with an import (add near the other requires):
```js
const { resolveConfig, RELEASE_BASE } = require('./config')
```

(b) In `publish()`, before building `filesEntry`, derive the base and thread the publisher. Change the `filesEntry`/`upsertTrip` region to:
```js
  const releaseBase = opts.releaseBase || RELEASE_BASE
  // Build manifest entry — files.raw only present when raw was published.
  const filesEntry = {
    deltas: { url: `${releaseBase}/${opts.id}/${opts.id}.jsonl.gz`, sha256: sha256(deltasFile), bytes: fs.statSync(deltasFile).size }
  }
  if (rawFile) {
    filesEntry.raw = { url: `${releaseBase}/${opts.id}/${opts.id}.raw.log.gz`, sha256: sha256(rawFile), bytes: fs.statSync(rawFile).size }
  }
```
and change the `upsertTrip` call to pass the publisher:
```js
  upsertTrip(opts.manifestPath, entry, opts.publisher)
```

(c) In `main()`, add the new options and remove the per-flag defaults that the config layer now owns. Replace the `parseArgs({...})` options block with:
```js
    options: {
      id: { type: 'string' }, title: { type: 'string' }, region: { type: 'string' },
      self: { type: 'string' },
      video: { type: 'string' }, post: { type: 'string' },
      'release-base': { type: 'string' }, publisher: { type: 'string' },
      out: { type: 'string' },
      manifest: { type: 'string' },
      'scrub-list': { type: 'string' }
    },
```

(d) Update the usage line to mention the new flags:
```js
    console.error('usage: node src/cli.js --id <id> --title <t> [--region r] [--video url] [--self context] [--post url] [--release-base url|auto] [--publisher name] [--out dir] [--manifest path] [--scrub-list path] <raw.log>...')
```

(e) Replace the `publish({...})` call in `main()` with config resolution + mapped opts:
```js
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
```

- [ ] **Step 4: Run the full journey-data suite**

Run: `cd ~/src/sailingnaturali/journey-data && npm test`
Expected: PASS — all suites green, including the two new cli cases and the unchanged fixture cases (which still produce the `sailingnaturali` release URL).

- [ ] **Step 5: Commit**

```bash
cd ~/src/sailingnaturali/journey-data
git add src/cli.js test/cli.test.js
git commit -m "feat: cli wires release-base/publisher/config; publish() honors both

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: journey-data docs + `journey.config.json.example`

**Files:**
- Create: `journey-data/journey.config.json.example`
- Modify: `journey-data/README.md`
- Modify: `journey-data/docs/BRING-YOUR-OWN-DATA.md`

- [ ] **Step 1: Create the example config**

Create `journey-data/journey.config.json.example`:

```json
{
  "releaseBase": "https://github.com/your-org/journey-data/releases/download",
  "publisher": "your-org"
}
```

- [ ] **Step 2: Mention the config file in README**

In `journey-data/README.md`, in the "Pipeline (this repo)" section, after the
existing `node src/cli.js …` sentence, add:

```markdown
Forking? Copy `journey.config.json.example` → `journey.config.json` and set
`releaseBase`/`publisher` once (or pass `--release-base <url|auto> --publisher
<name>`); the CLI prefers a flag, then the config file, then our defaults. See
[`docs/BRING-YOUR-OWN-DATA.md`](docs/BRING-YOUR-OWN-DATA.md).
```

- [ ] **Step 3: Update BRING-YOUR-OWN-DATA.md — relative URLs now supported**

In `journey-data/docs/BRING-YOUR-OWN-DATA.md`, in the "Replay-only" section,
replace the **"File URLs must be absolute."** bullet with:

```markdown
- **File URLs may be relative to the manifest URL.** The plugin resolves each
  `files.*.url` against `manifestUrl` (`new URL(url, manifestUrl)`), so if you
  commit `my-trip.jsonl.gz` next to `manifest.json` you can write
  `"url": "my-trip.jsonl.gz"`. Absolute `https://…` URLs still work and are
  required when the archives live on a different host than the manifest.
```

- [ ] **Step 4: Update BRING-YOUR-OWN-DATA.md — new flags + config file**

In the "Step 2 — convert + scrub + archive" flags table, add three rows after
`--post`:

```markdown
| `--release-base` | no | our releases URL | Base for generated `files.*.url`. `auto` derives it from your `git remote get-url origin`. |
| `--publisher` | no | `sailingnaturali` (on create) | Sets the manifest's top-level `publisher`. |
```

And after that table, add:

```markdown
Forkers: set `releaseBase` and `publisher` once in a `journey.config.json` at
the repo root (copy `journey.config.json.example`) instead of repeating flags.
Precedence is flag > config file > built-in default. **Without one of these your
generated `files.*.url` point at Sailing Naturali's releases** — that's the
default base.
```

- [ ] **Step 5: Update BRING-YOUR-OWN-DATA.md — demote the gotcha + fix the forking note**

In the "Gotchas, in one place" list, replace the **"Absolute URLs only."** bullet with:

```markdown
- **File URLs: absolute or relative.** Relative `files.*.url` resolve against
  `manifestUrl`; absolute URLs are used as-is. Co-locate archives with the
  manifest and go relative, or point absolute URLs at any host.
```

In the "Step 3 — host it" section, replace the `> **Forking gotcha — release
URLs are hardcoded.** …` blockquote with:

```markdown
> **Forking:** point generated URLs at your host with `--release-base <url>`,
> or `--release-base auto` to derive it from your `git origin`, or set
> `releaseBase` in `journey.config.json`. Set `publisher` the same way. No
> hand-editing of generated URLs needed.
```

Finally, in the "Step 3 — host it" GitHub Pages bullet, update the first-run note
nothing-to-change (leave as is), and in the "Replay-only" section after the
minimal example, replace the sentence beginning "The plugin's trip dropdown
populates…" with:

```markdown
The plugin's trip dropdown populates from the **cached** manifest. On the first
start it also writes the available trip ids into the plugin status line, so you
can type a `tripId` directly (it's free-text) or reopen the config to get the
dropdown.
```

- [ ] **Step 6: Commit**

```bash
cd ~/src/sailingnaturali/journey-data
git add journey.config.json.example README.md docs/BRING-YOUR-OWN-DATA.md
git commit -m "docs: relative URLs, --release-base/--publisher, journey.config.json

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Repo B — signalk-journey-replay

### Task 5: Resolve relative file URLs against the manifest URL

**Files:**
- Modify: `signalk-journey-replay/lib/manifest.js`
- Test: `signalk-journey-replay/test/manifest.test.js` (extend)

- [ ] **Step 1: Write the failing test**

Append to `signalk-journey-replay/test/manifest.test.js`:

```js
const { resolveTripUrls } = require('../lib/manifest')

test('resolveTripUrls resolves relative urls and passes absolutes through', () => {
  const base = 'https://host.example/data/manifest.json'
  const m = resolveTripUrls({
    trips: [
      { id: 'rel', files: { deltas: { url: 'rel.jsonl.gz', sha256: 'x' } } },
      { id: 'abs', files: { deltas: { url: 'https://cdn.example/abs.jsonl.gz', sha256: 'y' } } },
      { id: 'nofiles' }
    ]
  }, base)
  assert.strictEqual(m.trips[0].files.deltas.url, 'https://host.example/data/rel.jsonl.gz')
  assert.strictEqual(m.trips[1].files.deltas.url, 'https://cdn.example/abs.jsonl.gz')
  assert.deepStrictEqual(m.trips[2], { id: 'nofiles' })
})

test('resolveTripUrls handles files.raw too', () => {
  const m = resolveTripUrls({
    trips: [{ id: 'a', files: { deltas: { url: 'd.jsonl.gz' }, raw: { url: 'r.log.gz' } } }]
  }, 'https://h.example/m/manifest.json')
  assert.strictEqual(m.trips[0].files.deltas.url, 'https://h.example/m/d.jsonl.gz')
  assert.strictEqual(m.trips[0].files.raw.url, 'https://h.example/m/r.log.gz')
})

test('loadManifest returns resolved urls but caches raw urls', async () => {
  const body = JSON.stringify({ trips: [{ id: 'a', files: { deltas: { url: 'a.jsonl.gz', sha256: 'x' } } }] })
  const { s, url } = await serve((req, res) => res.end(body))
  const dir = tmp()
  const r = await loadManifest(url, dir)
  s.close()
  const expected = url.replace('manifest.json', 'a.jsonl.gz')
  assert.strictEqual(r.manifest.trips[0].files.deltas.url, expected)         // returned: resolved
  const cached = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'))
  assert.strictEqual(cached.trips[0].files.deltas.url, 'a.jsonl.gz')          // on disk: raw
})

test('loadManifest offline path resolves cache urls against the current url', async () => {
  const dir = tmp()
  fs.writeFileSync(path.join(dir, 'manifest.json'),
    JSON.stringify({ trips: [{ id: 'a', files: { deltas: { url: 'a.jsonl.gz' } } }] }))
  const r = await loadManifest('http://127.0.0.1:1/sub/manifest.json', dir) // unreachable → cache
  assert.strictEqual(r.fromCache, true)
  assert.strictEqual(r.manifest.trips[0].files.deltas.url, 'http://127.0.0.1:1/sub/a.jsonl.gz')
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd ~/src/sailingnaturali/signalk-journey-replay && node --test test/manifest.test.js`
Expected: FAIL — `resolveTripUrls is not a function`.

- [ ] **Step 3: Write the implementation**

Edit `signalk-journey-replay/lib/manifest.js`. Add the helper above `loadManifest`:

```js
// Resolve each trip's file urls (deltas, raw, …) against the manifest's own
// url, so a manifest may use relative paths for co-located archives. Absolute
// urls are returned unchanged (new URL(abs, base) ignores base). Non-mutating.
function resolveTripUrls(manifest, baseUrl) {
  if (!manifest || !Array.isArray(manifest.trips)) return manifest
  return {
    ...manifest,
    trips: manifest.trips.map(t => {
      if (!t.files) return t
      const files = {}
      for (const [k, f] of Object.entries(t.files)) {
        files[k] = (f && typeof f.url === 'string')
          ? { ...f, url: new URL(f.url, baseUrl).href }
          : f
      }
      return { ...t, files }
    })
  }
}
```

Then resolve on both return paths inside `loadManifest`. Change the success return:
```js
    return { manifest: resolveTripUrls(manifest, url), fromCache: false }
```
and the cache-fallback return:
```js
        return { manifest: resolveTripUrls(manifest, url), fromCache: true, error: String(err) }
```
(The `fs.writeFileSync(cacheFile, …)` line stays as-is, writing the **raw** manifest.)

Finally export the helper:
```js
module.exports = { loadManifest, resolveTripUrls }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd ~/src/sailingnaturali/signalk-journey-replay && node --test test/manifest.test.js`
Expected: PASS — existing manifest tests plus the four new ones.

- [ ] **Step 5: Commit**

```bash
cd ~/src/sailingnaturali/signalk-journey-replay
git add lib/manifest.js test/manifest.test.js
git commit -m "feat: resolve relative file urls against the manifest url

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: First-run trip discovery — list ids on empty/unknown selection

**Files:**
- Create: `signalk-journey-replay/lib/trips.js`
- Modify: `signalk-journey-replay/index.js`
- Test: `signalk-journey-replay/test/trips.test.js`

- [ ] **Step 1: Write the failing test**

Create `signalk-journey-replay/test/trips.test.js`:

```js
'use strict'
const { test } = require('node:test')
const assert = require('node:assert')
const { availableTripsMessage } = require('../lib/trips')

test('lists ids and names the missing selection', () => {
  const msg = availableTripsMessage(['a', 'b'], 'zzz')
  assert.match(msg, /trip not found: zzz/)
  assert.match(msg, /available: a, b/)
})

test('no selection yields a neutral head', () => {
  assert.match(availableTripsMessage(['a'], undefined), /no trip selected/)
})

test('empty manifest is stated plainly', () => {
  assert.match(availableTripsMessage([], 'x'), /manifest has no trips/)
})

test('caps long lists at 10 ids with a +N more suffix', () => {
  const ids = Array.from({ length: 13 }, (_, i) => 'id' + i)
  const msg = availableTripsMessage(ids, undefined)
  assert.match(msg, /\(\+3 more\)/)
  assert.ok(!msg.includes('id10'), 'should not list the 11th id')
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd ~/src/sailingnaturali/signalk-journey-replay && node --test test/trips.test.js`
Expected: FAIL — `Cannot find module '../lib/trips'`.

- [ ] **Step 3: Write the implementation**

Create `signalk-journey-replay/lib/trips.js`:

```js
'use strict'
// Status/error line shown when no trip (or an unknown trip) is selected. Lists
// the ids the user can type or pick. Pure, so it's unit-tested in isolation.
function availableTripsMessage(ids, selected) {
  const head = selected ? `trip not found: ${selected}` : 'no trip selected'
  if (!ids.length) return `${head} — manifest has no trips`
  const shown = ids.slice(0, 10)
  const list = shown.join(', ') + (ids.length > shown.length ? `, …(+${ids.length - shown.length} more)` : '')
  return `${head} — available: ${list} (type one as Trip, or reopen config for the dropdown)`
}
module.exports = { availableTripsMessage }
```

Edit `signalk-journey-replay/index.js`. Add the require near the top, after the
existing `lib` requires:
```js
const { availableTripsMessage } = require('./lib/trips')
```
Then, inside `run()`, replace the `if (!trip) { … }` block with:
```js
    if (!trip) {
      app.setPluginError(availableTripsMessage(manifest.trips.map(t => t.id), config.tripId))
      return
    }
```
(The `loadManifest` call already runs before this check, so the cache is warmed
and `manifest.trips` is available.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd ~/src/sailingnaturali/signalk-journey-replay && node --test test/trips.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Run the full plugin suite**

Run: `cd ~/src/sailingnaturali/signalk-journey-replay && npm test`
Expected: PASS — including `index.test.js` (confirm it doesn't assert the old
"choose a trip" string; if it does, update that assertion to match
`availableTripsMessage` output).

- [ ] **Step 6: Commit**

```bash
cd ~/src/sailingnaturali/signalk-journey-replay
git add lib/trips.js index.js test/trips.test.js
git commit -m "feat: list available trip ids when none/unknown is selected

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Plugin discoverability + README

**Files:**
- Modify: `signalk-journey-replay/package.json`
- Modify: `signalk-journey-replay/README.md`

- [ ] **Step 1: Add searchable keywords**

In `signalk-journey-replay/package.json`, replace the `keywords` array with:

```json
  "keywords": [
    "signalk-node-server-plugin",
    "signalk-category-utility",
    "replay",
    "playback",
    "voyage",
    "nmea",
    "demo"
  ],
```

- [ ] **Step 2: Note relative URLs + first-run in README**

In `signalk-journey-replay/README.md`, in the Configuration table, replace the
`manifestUrl` row's Notes cell with:

```markdown
Point at any conforming manifest to replay your own journeys. A trip's
`files.*.url` may be **relative to this URL** (co-locate archives with the
manifest) or absolute.
```

In the same table, replace the `tripId` row's Notes cell with:

```markdown
Select a trip from the dropdown, or type a trip id directly (it's free-text).
**First start** lists the available ids in the plugin status line and caches the
manifest, so reopen the config afterward to get the populated dropdown.
```

- [ ] **Step 3: Commit**

```bash
cd ~/src/sailingnaturali/signalk-journey-replay
git add package.json README.md
git commit -m "docs: searchable keywords + relative-url/first-run config notes

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final verification (run before declaring done)

- [ ] `cd ~/src/sailingnaturali/journey-data && npm test` → all green.
- [ ] `cd ~/src/sailingnaturali/signalk-journey-replay && npm test` → all green.
- [ ] Sanity-check the invariant — our default run is unchanged:
  `cd ~/src/sailingnaturali/journey-data && node src/cli.js --id _v --title _v test/fixtures/clean-trip.mux.log --out /tmp/jd-verify --manifest /tmp/jd-verify/manifest.json`
  then confirm the printed `files.deltas.url` contains
  `github.com/sailingnaturali/journey-data/releases/download/_v/`.
- [ ] Both repos: `git log --oneline` shows the task commits on
  `claude/lucid-sagan-ij6trk`. Do **not** push or open PRs unless asked.

---

## Self-review notes (author)

- **Spec coverage:** component 1 → Tasks 1–4; component 2 → Task 5; component 3 →
  Task 6; component 4 → Tasks 4 (journey-data docs) + 7 (plugin). Env-var cut and
  `auto`-opt-in honored.
- **Signatures consistent across tasks:** `resolveConfig(flags, cwd)`,
  `upsertTrip(manifestPath, entry, publisher)`, `publish({…, releaseBase,
  publisher})`, `resolveTripUrls(manifest, baseUrl)`,
  `availableTripsMessage(ids, selected)` — used identically wherever referenced.
- **Backward-compat anchors:** `publish()` defaults `releaseBase` to
  `RELEASE_BASE`; `upsertTrip` ignores an undefined `publisher`; `resolveTripUrls`
  leaves absolute urls and file-less trips untouched — existing tests in both
  repos stay valid.
