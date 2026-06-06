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
App Store (in development), pick a trip, press play (it rebases timestamps
to "now"). Or go native where a raw file exists: gunzip it and configure a
SignalK file connection.

## Pipeline (this repo)

`node src/cli.js --id <trip> --title "..." <raw.log>` converts raw
multiplexed logs (or `src/capture.js` websocket captures) to delta JSONL,
scrubs them (`scrub-list.json`), archives, and updates the manifest.
`npm test` runs the suite.

## Licensing

Code MIT (`LICENSE`); data CC-BY-4.0 (`DATA_LICENSE`) — attribute
"Sailing Naturali" with a link back.
