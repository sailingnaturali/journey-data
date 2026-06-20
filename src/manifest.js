'use strict'
const fs = require('node:fs')

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
module.exports = { upsertTrip }
