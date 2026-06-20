# journey-data

Real voyage data from S/V Naturali (Salish Sea, BC → beyond), published as
SignalK delta archives anyone can download, replay, and build on.

Why: community replay data (plaka.log) made our own SignalK start vastly
easier. This is us paying that forward — full-fidelity nav, wind, depth,
battery, tanks, and AIS data from every trip we log.

## Get the data

- Browse [`manifest.json`](https://sailingnaturali.github.io/journey-data/manifest.json)
  — every trip with region, bounding box, file URLs, sha256, and (when there
  is one) the trip's YouTube episode.
- Each trip ships on GitHub releases:
  - `<id>.jsonl.gz` — scrubbed SignalK deltas, one per line; line 1 is a
    `{"journeyDataVersion":1,...}` metadata record. Original timestamps.
    Always present.
  - `<id>.raw.log.gz` — the byte-faithful raw multiplexed server log, for
    SignalK's native file playback. **Present only when our privacy scrubber
    verified it changed nothing** — if scrubbing dropped or redacted anything
    in a trip, the raw file is withheld for that trip and `files.raw` is
    absent from its manifest entry.

## Replay it

Easiest: install `@sailingnaturali/signalk-journey-replay` from the SignalK
App Store, pick a trip, press play (it rebases timestamps
to "now"). Or go native where a raw file exists: gunzip it and configure a
SignalK file connection.

## Overlay data (for video)

Turn a trip into video-overlay values — wind, depth, boat speed, battery, sea
state — in human units (knots, degrees, %, Beaufort), keyed by time:

- `node src/overlay-cli.js at <trip.jsonl[.gz]> --time <UTC>` — the readings at
  one moment (add `--json` for scripting; `--video-start <UTC> --at <mm:ss>`
  maps a clip offset to UTC for GoPro↔SignalK alignment).
- `node src/overlay-cli.js export <trip> [--hz 1] -o out.csv` — the whole trip
  as an overlay-ready CSV (feeds Telemetry Overlay, DaVinci Resolve, etc.).
- `node src/overlay-cli.js moments <trip> --moments moments.csv` — a CSV of
  marked timestamps → resolved overlay rows.

Reads SI deltas, emits display units via sample-and-hold at the queried time.
Absent paths (e.g. solar/regen until the energy bus is bridged) and stale
samples come back `null`, never faked. Installable as `journey-overlay`.

## Pipeline (this repo)

`node src/cli.js --id <trip> --title "..." <raw.log>` converts raw
multiplexed logs (or `src/capture.js` websocket captures) to delta JSONL,
scrubs them (`scrub-list.json`), archives, and updates the manifest.
`npm test` runs the suite.

**Bring your own data:** the replay plugin works with any conforming manifest,
and this pipeline is reusable on your own SignalK server. The manifest +
archive schema and an end-to-end recipe are in
[`docs/BRING-YOUR-OWN-DATA.md`](docs/BRING-YOUR-OWN-DATA.md).

Forking to publish your own? Copy `journey.config.json.example` →
`journey.config.json` and set `releaseBase`/`publisher` once (or pass
`--release-base <url|auto> --publisher <name>`); the CLI prefers a flag, then
the config file, then our defaults.

## Licensing

Code MIT (`LICENSE`); data CC-BY-4.0 (`DATA_LICENSE`) — attribute
"Sailing Naturali" with a link back.
