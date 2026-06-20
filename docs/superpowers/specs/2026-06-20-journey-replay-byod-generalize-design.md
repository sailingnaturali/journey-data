# Make journey-replay generally adoptable — design

**Date:** 2026-06-20
**Repos:** `journey-data` (pipeline) and `signalk-journey-replay` (plugin)
**Status:** approved, pre-implementation

## Goal

Lower the cost for a non–Sailing-Naturali SignalK user to (a) replay their own
voyage data and (b) produce and host it with our pipeline. The
`BRING-YOUR-OWN-DATA.md` guide documented the format; this work removes the
mechanical friction that guide had to warn around — hardcoded release URLs,
absolute-URL-only resolution, and a first-run dropdown that teaches nothing.

## Hard invariant

**Zero behavior change for our own pipeline and our published manifest.** Every
new knob defaults to today's behavior; every plugin change is additive and
backward-compatible. Forkers and self-hosters opt in. Any change that would
alter the bytes we currently generate, or break replay of the existing
`sailingnaturali/journey-data` manifest, is out of spec.

## Out of scope / explicit cuts

- **Env-var configuration** (`JOURNEY_RELEASE_BASE`, `JOURNEY_PUBLISHER`) — cut.
  Flags plus a config file cover interactive and CI use; a third precedence
  layer is error surface without payoff. Revisit only if the release workflow
  needs it.
- **Async/fetching plugin `schema()`** — not possible; SignalK calls `schema()`
  synchronously. We work within that constraint (see component 3), not around it.
- **Unrelated refactors.** Touch only what these features require.

---

## Component 1 — `cli.js` generalization (journey-data)

Today `src/cli.js` hardcodes
`RELEASE_BASE = 'https://github.com/sailingnaturali/journey-data/releases/download'`
and `src/manifest.js` `upsertTrip` defaults a fresh manifest's `publisher` to
`'sailingnaturali'`. A forker's generated `files.*.url` therefore points at our
releases until they hand-edit.

### 1a. `--release-base <url>`
- Base URL used to build `files.deltas.url` and `files.raw.url`
  (`<release-base>/<id>/<id>.jsonl.gz`).
- Default: the current `RELEASE_BASE` constant (our runs unchanged).
- Special value `auto`: derive from `git remote get-url origin`, normalizing
  both forms to `https://github.com/<owner>/<repo>/releases/download`:
  - `git@github.com:owner/repo.git` → `https://github.com/owner/repo/releases/download`
  - `https://github.com/owner/repo.git` → strip `.git`, append `/releases/download`
  - No remote / unparseable → exit non-zero with a clear message (don't silently
    fall back to our URL).

### 1b. `--publisher <name>`
- Threaded through `publish()` → `upsertTrip(manifestPath, entry, publisher)`.
- On a fresh manifest, sets top-level `publisher` instead of the hardcoded
  default. If passed when a manifest already exists, overwrites the existing
  top-level `publisher`. If omitted, behavior is exactly today's (default
  `sailingnaturali` on create, untouched on update).

### 1c. `journey.config.json` (optional, repo root)
- Shape: `{ "releaseBase": string, "publisher": string, "out": string,
  "manifest": string, "scrubList": string }`. All keys optional.
- Loaded from the cwd at CLI start if present.
- **Precedence: flag > config file > built-in default**, applied per setting.
- Ship `journey.config.json.example` and gitignore-free (forkers commit their
  own). Our repo adds no `journey.config.json`, so our defaults are unchanged.
- Maps to existing options: `releaseBase`→`--release-base`,
  `publisher`→`--publisher`, `out`→`--out`, `manifest`→`--manifest`,
  `scrubList`→`--scrub-list`.

### Interfaces touched
- `src/cli.js`: add `release-base`, `publisher` to `parseArgs`; add config-file
  load + precedence resolution; pass `releaseBase` into `publish()`; replace the
  `RELEASE_BASE` constant use with the resolved value; pass `publisher` to
  `upsertTrip`.
- `src/manifest.js`: `upsertTrip(manifestPath, entry, publisher)` — third arg
  optional; sets/overwrites top-level `publisher` when provided.
- New `src/config.js` (small): `resolveConfig(flags, cwd)` returning the merged
  settings, and `releaseBaseFromGit(cwd)` for the `auto` path. Keeps `cli.js`
  focused and the precedence logic unit-testable in isolation.

---

## Component 2 — relative file-URL resolution (plugin)

Today `lib/download.js` does `new URL(file.url)` with no base, so relative URLs
throw — self-hosters must write absolute URLs even when the manifest and
archives are co-located.

- New `resolveTripUrls(manifest, manifestUrl)` in `lib/manifest.js`: returns a
  manifest whose every `files.deltas.url` and `files.raw.url` is resolved via
  `new URL(url, manifestUrl).href`. Absolute inputs are returned unchanged
  (`new URL(abs, base)` ignores `base`) → backward-compatible.
- `loadManifest` applies `resolveTripUrls` to the manifest it returns, for both
  the network and cache paths, using the `url` it was called with as the base.
- **The disk cache stores the raw (unresolved) manifest**; resolution happens
  per-load against the current `manifestUrl`. This keeps the cached file
  portable and offline replay correct.
- Result: a Pages adopter commits `my-trip.jsonl.gz` beside `manifest.json` and
  writes `"url": "my-trip.jsonl.gz"`. `fetchArchive` is unchanged (it receives
  an already-absolute URL).

### Interfaces touched
- `lib/manifest.js`: add `resolveTripUrls`; call it inside `loadManifest` before
  returning (network and cache branches). Export `resolveTripUrls` for tests.
- `lib/download.js`: unchanged.
- `index.js`: unchanged (already consumes `trip.files.deltas`).

---

## Component 3 — first-run trip discovery (plugin)

`schema()` is synchronous, so the trip dropdown can only enumerate ids already
cached on disk — empty before the first start. `tripId` is already a free-text
string (enum added only when ids exist), so manual entry works; users just don't
know the valid ids.

- Change the empty/unmatched-`tripId` path in `run()`: instead of erroring with
  "choose a trip", **load (fetch+cache) the manifest first**, then set the
  plugin status/error to list the available trip ids, e.g.
  `no trip selected — available: demo-boundary-pass-sim, … (type one as Trip, or reopen config for the dropdown)`.
- This warms the manifest cache (so the dropdown populates on reopen) and
  surfaces valid ids on the very first start. No change to `schema()`.
- Keep it bounded: if the id list is long, cap the displayed list (e.g. first 10
  + count) so the status line stays readable.

### Interfaces touched
- `index.js` `run()`: reorder so manifest load happens before the trip-not-found
  branch; build the id-list message. Extract the message builder
  (`availableTripsMessage(ids, selected)`) as a pure function for unit testing.

---

## Component 4 — discoverability + docs

- `signalk-journey-replay/package.json`: add searchable `keywords`
  (`replay`, `playback`, `demo`, `nmea`, `voyage`) alongside the existing
  `signalk-node-server-plugin` / `signalk-category-utility`.
- Docs updates:
  - `journey-data/docs/BRING-YOUR-OWN-DATA.md`: relative URLs now supported
    (demote gotcha #3 from hard requirement to "absolute or relative, your
    call"); document `--release-base` (incl. `auto`), `--publisher`, and
    `journey.config.json`; correct the first-run guidance to mention the id list.
  - `journey-data/README.md`: mention the config file in the pipeline blurb.
  - `signalk-journey-replay/README.md`: config table note that file URLs may be
    relative to the manifest URL; refresh the first-use quirk wording.

---

## Testing (TDD, `node --test` in each repo)

**journey-data (`src/config.js`, `src/manifest.js`):**
- Precedence: flag overrides config overrides default, per setting.
- `journey.config.json` absent → built-in defaults (== today).
- `releaseBaseFromGit`: ssh form and https form both normalize correctly;
  missing/garbage remote → throws.
- `upsertTrip` with `publisher`: sets on create, overwrites on update; omitted →
  today's default behavior.
- Generated `files.*.url` honor the resolved release base.

**plugin (`lib/manifest.js`, `index.js`):**
- `resolveTripUrls`: relative resolves against `manifestUrl`; absolute passes
  through unchanged; handles `files.raw`; trips without files untouched.
- `loadManifest`: cache stores raw, returned manifest is resolved; offline
  (cache) path resolves against the configured `manifestUrl`.
- `availableTripsMessage`: lists ids, caps long lists, notes the selected/missing
  id.

## Risks / watch items

- `releaseBaseFromGit` shelling out to `git` adds a process dependency to the
  `auto` path only; default and explicit-flag paths never call git.
- Resolving on the cache path means a cached manifest follows the *current*
  `manifestUrl` base — correct for our use (base stable), and the only sane
  behavior when the original absolute URLs are absent. Documented, tested.
- Config-file precedence must be applied per-setting (not whole-object) so a
  config that sets only `publisher` doesn't blow away the default `out`/`manifest`.
