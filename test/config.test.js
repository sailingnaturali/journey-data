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
