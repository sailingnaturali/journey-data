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
