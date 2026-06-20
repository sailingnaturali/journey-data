# Bring your own journey data

`@sailingnaturali/signalk-journey-replay` replays any conforming manifest, not
just ours. This is the spec for the manifest + archive format, documented from
the code (`src/cli.js`, `src/manifest.js`, and the plugin's `lib/`), plus an
end-to-end recipe for producing and hosting your own.

There are two ways in:

- **Replay-only** — point the plugin's `manifestUrl` at any conforming manifest
  you host. No fork, no pipeline. Write the manifest by hand if you like.
- **Produce-your-own** — fork this repo and run the capture → convert → scrub →
  publish pipeline against your own SignalK server.

---

## 1. Replay-only

Set the plugin's `manifestUrl` (Plugin Config → Journey Replay) to a URL that
serves a manifest matching the schema below. That's the whole contract. The
plugin downloads each trip's delta archive once, verifies its `sha256`, caches
it, and replays it.

Two things the code enforces that bite if you miss them:

- **File URLs may be relative to the manifest URL.** The plugin resolves each
  `files.*.url` against `manifestUrl` (`new URL(url, manifestUrl)`), so if you
  commit `my-trip.jsonl.gz` next to `manifest.json` you can write
  `"url": "my-trip.jsonl.gz"`. Absolute `https://…` URLs still work and are
  required when the archives live on a different host than the manifest.
- **`sha256` must match the archive.** A mismatch is retried once, then fails
  the trip. `bytes` is only used to render the download-progress percentage;
  omitting it just means no percentage.

### Manifest schema

#### Top level (`manifest.json`)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `trips` | array | **yes** | The plugin reads only this. |
| `manifestVersion` | number | no | `1`. Informational; the plugin ignores it. The pipeline writes it. |
| `publisher` | string | no | Informational; the plugin ignores it. The pipeline defaults it to `sailingnaturali` — change it if you fork. |

#### Each trip in `trips[]`

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | string | **yes** | Matched against the plugin's `tripId`; also the cache-dir name. Keep it filesystem- and URL-safe. |
| `title` | string | **yes** | Shown in the status line during replay. |
| `files` | object | **yes** | See below. |
| `start` / `end` | ISO 8601 string | no | Trip bounds. The pipeline derives them from the first/last delta. Used to sort `trips[]` newest-first; not required for replay. |
| `region` | string | no | Free text (e.g. `"Salish Sea, BC"`). |
| `bbox` | `[minLon, minLat, maxLon, maxLat]` | no | Lon/lat order. The pipeline derives it from `navigation.position`. |
| `paths` | string[] | no | Top-level SignalK groups present (e.g. `["navigation","environment"]`). Pipeline-derived; for browsing. |
| `video` | string | no | A URL shown in the status line during replay (we use a YouTube episode link). There is **no `youtube` field** — it's `video`. |
| `post` | string | no | A URL carried in the manifest. Not read by the current plugin. |

#### `files`

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `files.deltas` | object | **yes** | The archive the plugin replays. |
| `files.deltas.url` | string | **yes** | Absolute URL to the `.jsonl.gz` archive. |
| `files.deltas.sha256` | string | **yes** | Hex digest of the archive; verified after download. |
| `files.deltas.bytes` | number | no | Size, for the progress percentage only. |
| `files.raw` | object | no | `{url, sha256, bytes}` for a byte-faithful raw server log. The pipeline emits it **only when scrubbing changed nothing** (privacy gate). The plugin does not use it — it's for SignalK's native file playback. |

#### Minimal working example

Everything the plugin actually needs:

```json
{
  "trips": [
    {
      "id": "my-first-trip",
      "title": "Shakedown across the bay",
      "files": {
        "deltas": {
          "url": "https://example.com/journeys/my-first-trip.jsonl.gz",
          "sha256": "a23104234fd244e91477beb26b9d8f7921a405ef35481bc369d5698a8d1364f5",
          "bytes": 24477
        }
      }
    }
  ]
}
```

The plugin's trip dropdown populates from the **cached** manifest. On the first
start it also writes the available trip ids into the plugin status line, so you
can type a `tripId` directly (it's free-text) or reopen the config to get the
dropdown.

### The delta archive (`<id>.jsonl.gz`)

Gzipped JSONL. **Line 1 is a metadata record**, every line after it is one
SignalK delta. The plugin distinguishes them by the presence of
`journeyDataVersion` on the metadata line.

```
{"journeyDataVersion":1,"id":"my-first-trip","title":"…","start":"…","end":"…","region":"…","bbox":[…],"paths":[…],"self":"vessels.urn:mrn:signalk:uuid:…"}
{"context":"vessels.urn:mrn:signalk:uuid:…","updates":[{"$source":"…","timestamp":"2026-06-06T07:57:05.504Z","values":[{"path":"navigation.position","value":{"longitude":-123.05,"latitude":48.76}}]}]}
{"context":"vessels.urn:mrn:imo:mmsi:…","updates":[{"timestamp":"…","values":[{"path":"navigation.speedOverGround","value":3.1}]}]}
…
```

The metadata line is **separate from the manifest entry** — don't confuse
`journeyDataVersion` (archive) with `manifestVersion` (manifest). Its most
important field for replay:

- **`self`** — the SignalK `context` of the vessel that recorded the trip
  (e.g. `vessels.urn:mrn:signalk:uuid:…`). On replay, deltas whose `context`
  equals `self` have their `context` **dropped**, so they land on the consuming
  server's own `self` — as if your instruments produced them. Every other
  `context` (AIS targets) passes through unchanged. **Omit `self` and nothing
  maps to self** — the recorded vessel shows up as just another remote vessel.
  The metadata line is optional, but without it you lose self-mapping.

Replayed values are re-`$source`d to `journey-replay.<original-source>` so they
never get mistaken for live data downstream.

---

## 2. Produce-your-own

Fork this repo and run the pipeline. It's plain Node (deps: `ws`,
`@signalk/nmea0183-signalk`); `npm install`, then `npm test` to confirm.

### Step 1 — capture

`src/capture.js` subscribes to a SignalK server's full delta stream and writes
multiplexed log lines (`<epochMillis>;I;<delta-json>`) to stdout. Reads are
anonymous on a stock `allow_readonly` server — no token.

```bash
# node src/capture.js [ws://host:3000] [seconds]
node src/capture.js ws://your-pi.local:3000 600 > captures/trip.log
```

Defaults: `ws://naturalaspi.local:3000`, 60 seconds — change both. You can also
feed the converter a **real SignalK raw multiplexed server log** (the `.log`
SignalK writes itself); it handles both `I` (SignalK delta JSON) and `N`
(NMEA 0183) discriminator lines.

### Step 2 — convert + scrub + archive

`src/cli.js` converts raw logs to delta JSONL, runs the privacy scrubber,
gzips the archive, and upserts the trip into `manifest.json`.

```bash
node src/cli.js \
  --id my-first-trip \
  --title "Shakedown across the bay" \
  --region "Your waters" \
  --video https://youtu.be/… \
  captures/trip.log
```

Flags (from `parseArgs` in `src/cli.js`):

| Flag | Required | Default | Purpose |
|------|----------|---------|---------|
| `--id` | **yes** | — | Trip id (also archive filename and release tag). |
| `--title` | **yes** | — | Human title. |
| `<raw.log>…` | **yes** | — | One or more positional input logs, concatenated in order. |
| `--region` | no | — | Sets the trip's `region`. |
| `--self` | no | auto | Override the detected `self` context (see below). |
| `--video` | no | — | Sets the trip's `video` URL. |
| `--post` | no | — | Sets the trip's `post` URL. |
| `--release-base` | no | our releases URL | Base for generated `files.*.url`. `auto` derives it from your `git remote get-url origin`. |
| `--publisher` | no | `sailingnaturali` (on create) | Sets the manifest's top-level `publisher`. |
| `--out` | no | `dist` | Output directory for the archives. |
| `--manifest` | no | `manifest.json` | Manifest file to upsert into. |
| `--scrub-list` | no | `scrub-list.json` | Scrub rules (see below). |

Forkers: set `releaseBase` and `publisher` once in a `journey.config.json` at
the repo root (copy `journey.config.json.example`) instead of repeating flags.
Precedence is flag > config file > built-in default. **Without one of these your
generated `files.*.url` point at Sailing Naturali's releases** — that's the
default base.

`self` is auto-detected as the `context` that most often carries a valid
`navigation.position` (falling back to the most frequent context overall).
`--self` overrides it — use that if detection picks the wrong vessel.

**Scrubbing** (`scrub-list.json`) has two knobs:

- `dropPaths` — glob patterns (`*` matches anything) whose matching values are
  dropped entirely. Ours drops `communication.*`, `notes.*`,
  `design.aisShipType.crew*`.
- `redactPatterns` — regex sources applied to string leaves; matches become
  `[redacted]`. Ours catches API-token and JWT shapes.

Edit this list for your own privacy needs before publishing.

**Outputs:**

- `dist/<id>.jsonl.gz` — scrubbed deltas. **Always written.**
- `dist/<id>.raw.log.gz` — byte-faithful raw log. **Privacy gate:** written
  only if scrubbing altered nothing. If any delta was dropped or redacted, the
  raw file is withheld and `files.raw` is left out of the manifest entry.
- `manifest.json` — the trip entry is inserted/updated and `trips[]` re-sorted.

The CLI prints a ready-to-run `gh release create …` line and a reminder to
commit `manifest.json`.

### Step 3 — host it

The plugin only needs the manifest and the `.jsonl.gz` files reachable at
**absolute** URLs. Any static host works.

- **GitHub releases** (what we do): the CLI's printed `gh release create <id>
  <files>` uploads the archives as release assets.
- **GitHub Pages** for the manifest: commit `manifest.json` to a Pages-served
  branch/dir. Note the repo's existing `.nojekyll` — it stops GitHub Pages from
  running Jekyll over the files, which would otherwise mangle paths. Keep it.
- **Anything else** — S3, your own web server, etc. Just serve the bytes.

> **Forking:** point generated URLs at your host with `--release-base <url>`,
> or `--release-base auto` to derive it from your `git origin`, or set
> `releaseBase` in `journey.config.json`. Set `publisher` the same way. No
> hand-editing of generated URLs needed.

Then set the plugin's `manifestUrl` to wherever your `manifest.json` lives.

---

## Gotchas, in one place

- **File URLs: absolute or relative.** Relative `files.*.url` resolve against
  `manifestUrl`; absolute URLs are used as-is. Co-locate archives with the
  manifest and go relative, or point absolute URLs at any host.
- **`self` controls vessel mapping.** Present and matching a delta's `context`
  → that vessel becomes the consuming server's `self`. Absent → it stays a
  remote vessel. It lives in the archive's metadata line, not the manifest.
- **`timestampMode`: `rebase` vs `original`.** `rebase` (plugin default) shifts
  every timestamp so the trip starts *now* — keeps time-relative consumers
  (tide, weather, currents plugins) coherent. `original` keeps recorded
  timestamps, for historical analysis. The archive always stores original
  timestamps; rebasing happens at replay time.
- **`RELEASE_BASE` is hardcoded** — see the forking gotcha above.
- **Coexistence.** Replay emits the same paths as live sources. Disable
  overlapping simulators/sensors while replaying, and never treat replay output
  as live navigation.

---

## Licensing

- **Code** in this repo (the pipeline) and the plugin: **MIT**.
- **Our published trip data** (the archives under
  `sailingnaturali/journey-data` releases): **CC-BY-4.0** — reuse it freely,
  just attribute "Sailing Naturali" with a link back. See `DATA_LICENSE`.
- **Your own captured data is yours.** Forking the pipeline puts you under MIT
  for the code; license the voyage data you produce however you want.
