// node --test scripts/test/site.test.mjs
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { SIZE_BUDGET, buildData, normalizePath, readSource, repoPathFromUrl, trimText, uiBits } from '../build-site.mjs'
import {
  compactNumber,
  escapeHtml,
  formatHash,
  installCommand,
  itemUrl,
  parseHash,
  prepare,
  query,
  safeUrl,
  segments,
  tokenize,
} from '../../site/logic.js'

const root = join(fileURLToPath(import.meta.url), '..', '..', '..')
const readJson = (path, fallback) => (existsSync(join(root, path)) ? JSON.parse(readFileSync(join(root, path), 'utf8')) : fallback)

const REGISTRY = {
  testCount: 9,
  categories: [
    { id: 'safety', emoji: '🛡️', title: 'Safety & Security', blurb: 'b' },
    { id: 'fun', emoji: '🎮', title: 'Fun & Games', blurb: 'b' },
  ],
  mods: [
    { name: 'guard', category: 'safety', emoji: '🛡️', tagline: 'Blocks `rm -rf ~`', screenshot: 'assets/screens/guard.svg' },
    { name: 'pet', category: 'fun', emoji: '🐱', tagline: 'A pet' },
  ],
}
const COMMUNITY = [
  { name: 'weather', url: 'https://github.com/acme/mods/tree/main/weather', author: 'acme', authorUrl: 'https://github.com/acme', category: 'fun', emoji: '🌦️', tagline: 'Forecast', stars: 40, license: 'MIT', marketplace: { name: 'weather' } },
  { name: 'rooty', url: 'https://github.com/solo/rooty', author: 'solo', authorUrl: 'https://github.com/solo', category: 'safety', emoji: '🌱', tagline: 'At the root', stars: 3, license: 'MIT' },
]
const INDEX = [
  { name: 'guard', repo: 'Singh-AP/awesome-claude-mods', path: 'mods/safety/guard', url: 'https://github.com/Singh-AP/awesome-claude-mods/tree/main/mods/safety/guard', stars: 1, events: [], components: [] },
  { name: 'weather', repo: 'acme/mods', path: './weather/', url: 'https://github.com/acme/mods/tree/main/weather', stars: 40, createdAt: '2026-10-02', events: ['ui.render'], components: ['AbovePrompt'], calls: ['ui.status'] },
  { name: 'rooty', repo: 'solo/rooty', path: '.', url: 'https://github.com/solo/rooty', stars: 3, events: [], components: [] },
  { name: 'radar', repo: 'zed/radar', path: 'mods/radar', url: 'https://github.com/zed/radar/tree/dev/mods/radar', description: 'A  pane\nof tool calls', stars: 900, license: 'Apache-2.0', createdAt: '2026-10-03', category: 'awareness', events: ['tool.call', 'ui.render'], components: ['Pane'], calls: [] },
  { name: 'evil', repo: 'x/evil', path: '.', url: 'https://github.com/x/evil', description: '<img src=x onerror=alert(1)>', stars: 0, category: 'other', events: [], components: ['Spinner'] },
]
const SOURCES = { guard: "on('tool.call', { tool: 'Bash' }, f)\non('ui.render', { component: 'Pane' }, g)\n$.ui.status('x')" }

const build = () => buildData({ registry: REGISTRY, manifests: { guard: { version: '1.2.0', license: 'MIT' } }, sources: SOURCES, community: COMMUNITY, index: INDEX, stats: { updated: '2026-10-04T10:00:00Z', mods: 5, repos: 5 } })

test('helpers: paths, URLs, text, UI bits, source reading', () => {
  assert.equal(normalizePath('./a/b/'), 'a/b')
  assert.equal(normalizePath('.'), '.')
  assert.equal(normalizePath(''), '.')
  assert.deepEqual(repoPathFromUrl('https://github.com/Acme/Mods/tree/main/x/y'), { repo: 'acme/mods', path: 'x/y' })
  assert.deepEqual(repoPathFromUrl('https://github.com/solo/rooty'), { repo: 'solo/rooty', path: '.' })
  assert.equal(repoPathFromUrl('https://gitlab.com/a/b'), undefined)
  assert.equal(trimText('a  b\n c'), 'a b c')
  const long = trimText('word '.repeat(80), 40)
  assert.ok(long.length <= 40 && long.endsWith('…'))
  assert.equal(uiBits(['Pane', 'AbovePrompt', 'Spinner'], ['ui.status']), 'PBSR')
  assert.equal(uiBits([], []), '')
  assert.deepEqual(readSource(SOURCES.guard), { events: ['tool.call', 'ui.render'], components: ['Pane'], calls: ['ui.status'] })
})

test('buildData: built first in registry order, curated next, index last, no repeats', () => {
  const data = build()
  assert.equal(data.updated, '2026-10-04')
  assert.deepEqual(data.items.map(i => i.k ?? 'i'), ['b', 'b', 'c', 'c', 'i', 'i'])
  assert.deepEqual(data.items.map(i => i.n), ['guard', 'pet', 'weather', 'rooty', 'radar', 'evil'])
  // The index's copies of our mod and of both curated picks (incl. a repo-root one) are dropped.
  assert.equal(data.items.filter(i => i.n === 'guard').length, 1)
  assert.equal(data.items.filter(i => i.n === 'rooty').length, 1)
  assert.deepEqual(data.stats, { built: 2, curated: 4, installable: 3, indexed: 5, repos: 5, tests: 9 })
  assert.deepEqual(data.categories.map(c => c.id), ['safety', 'fun', 'ui', 'integrations', 'other'])
})

test('buildData: items are slim and enriched where the index knows more', () => {
  const data = build()
  const guard = data.items[0]
  assert.equal(guard.i, 'guard')
  assert.equal(guard.v, '1.2.0')
  assert.equal(guard.x, 'screens/guard.svg')
  assert.equal(guard.ui, 'PS')
  const weather = data.items.find(i => i.n === 'weather')
  assert.equal(weather.i, 'weather')
  assert.equal(weather.ui, 'BS')
  assert.equal(weather.t, '2026-10-02')
  const radar = data.items.find(i => i.n === 'radar')
  assert.equal(radar.k, undefined, 'index entries leave the kind to the page')
  assert.equal(radar.u, undefined, 'and their URL')
  assert.equal(radar.p, 'mods/radar')
  assert.equal(radar.d, 'A pane of tool calls')
  assert.ok(Array.isArray(radar.h) && radar.h.every(n => typeof data.vocab[n] === 'string'))
  for (const item of data.items) for (const value of Object.values(item)) assert.notEqual(value, '')
})

test('buildData is deterministic', () => {
  assert.equal(JSON.stringify(build()), JSON.stringify(build()))
})

test('the real data fits its size budget', { skip: !existsSync(join(root, 'data', 'mods.json')) }, () => {
  const registry = readJson('registry.json', { mods: [], categories: [] })
  const data = buildData({ registry, community: readJson('data/community.json', []), index: readJson('data/mods.json', []), stats: readJson('data/stats.json', {}), textLimit: 160 })
  const size = Buffer.byteLength(JSON.stringify(data))
  // The build shortens index descriptions further when needed; at full length it should already fit for now.
  assert.ok(size <= SIZE_BUDGET * 1.2, `data.json would be ${Math.round(size / 1024)} KB`)
})

test('escaping: HTML, URLs and code segments', () => {
  assert.equal(escapeHtml('<img src=x onerror="a">&\''), '&lt;img src=x onerror=&quot;a&quot;&gt;&amp;&#39;')
  assert.equal(safeUrl('https://github.com/a/b'), 'https://github.com/a/b')
  assert.equal(safeUrl('javascript:alert(1)'), '')
  assert.equal(safeUrl('http://insecure.example'), '')
  assert.equal(safeUrl('https://x.com/"onmouseover=1'), '')
  assert.deepEqual(segments('Blocks `rm -rf ~` now'), [
    { text: 'Blocks ', isCode: false },
    { text: 'rm -rf ~', isCode: true },
    { text: ' now', isCode: false },
  ])
  assert.deepEqual(segments('one ` tick'), [{ text: 'one ` tick', isCode: false }])
})

test('numbers and install lines', () => {
  assert.equal(compactNumber(999), '999')
  assert.equal(compactNumber(1234), '1.2k')
  assert.equal(compactNumber(149360), '149k')
  assert.equal(compactNumber(2_400_000), '2.4M')
  assert.equal(installCommand({ i: 'guard' }), '/plugin install guard@awesome-claude-mods')
  assert.equal(installCommand({}), '')
})

const prepared = () => {
  const data = build()
  return prepare(data.items, data.categories, data.vocab)
}

test('prepare: defaults kind and author, derives URLs, expands hook names', () => {
  const items = prepared()
  const radar = items.find(i => i.n === 'radar')
  assert.equal(radar.k, 'i')
  assert.equal(radar.a, 'zed')
  assert.equal(radar.u, 'https://github.com/zed/radar/tree/HEAD/mods/radar')
  assert.match(radar.h, /tool\.call/)
  assert.equal(itemUrl({ r: 'solo/rooty' }), 'https://github.com/solo/rooty')
})

test('search: tokens AND-match over name, text, repo, author and hooks', () => {
  const items = prepared()
  const names = q => query(items, { q, flags: [], sort: 'name' }).items.map(i => i.n)
  assert.deepEqual(names('radar'), ['radar'])
  assert.deepEqual(names('pane tool'), ['guard', 'radar'])
  assert.deepEqual(names('tool.call'), ['guard', 'radar'])
  assert.deepEqual(names('acme'), ['weather'])
  assert.deepEqual(names('fun'), ['pet', 'weather'], 'the category title is searchable')
  assert.deepEqual(names('nothing-like-this'), [])
  assert.deepEqual(tokenize('  Pane, "tool"  '), ['pane', 'tool'])
})

test('filters, categories and counts', () => {
  const items = prepared()
  const run = state => query(items, { q: '', flags: [], sort: 'name', ...state })
  assert.deepEqual(run({ flags: ['built'] }).items.map(i => i.n), ['guard', 'pet'])
  assert.deepEqual(run({ flags: ['curated'] }).items.map(i => i.n), ['guard', 'pet', 'rooty', 'weather'])
  assert.deepEqual(run({ flags: ['installable'] }).items.map(i => i.n), ['guard', 'pet', 'weather'])
  assert.deepEqual(run({ flags: ['ui'] }).items.map(i => i.n), ['evil', 'guard', 'radar', 'weather'])
  const fun = run({ cat: 'fun' })
  assert.deepEqual(fun.items.map(i => i.n), ['pet', 'weather'])
  assert.equal(fun.counts.safety, 2, 'chip counts ignore the chosen category')
  assert.equal(fun.total, 6)
})

test('sorting', () => {
  const items = prepared()
  const order = (sort, q = '') => query(items, { q, flags: [], sort }).items.map(i => i.n)
  assert.deepEqual(order('stars'), ['radar', 'weather', 'rooty', 'guard', 'pet', 'evil'], 'ties go built, curated, indexed')
  assert.deepEqual(order('newest').slice(0, 2), ['guard', 'pet'])
  assert.deepEqual(order('name'), ['evil', 'guard', 'pet', 'radar', 'rooty', 'weather'])
  // Browsing (no search) puts curated picks first, since the built mods sit above the browser.
  assert.deepEqual(order('featured'), ['weather', 'rooty', 'guard', 'pet', 'radar', 'evil'])
  // A search puts what's built here first.
  assert.deepEqual(order('featured', 'mods'), ['guard', 'pet', 'weather'])
  assert.equal(order('featured', 'guard')[0], 'guard')
})

test('URL hash state round-trips and drops junk', () => {
  const state = { q: 'pane tool', cat: 'awareness', flags: ['ui', 'built'], sort: 'stars' }
  const hash = formatHash(state)
  assert.equal(hash, '#q=pane+tool&cat=awareness&f=built%2Cui&sort=stars')
  assert.deepEqual(parseHash(hash), { q: 'pane tool', cat: 'awareness', flags: ['built', 'ui'], sort: 'stars' })
  assert.equal(formatHash({ q: '', cat: '', flags: [], sort: 'featured' }), '')
  assert.deepEqual(parseHash('#cat=<script>&f=evil,ui&sort=drop'), { q: '', cat: 'script', flags: ['ui'], sort: 'featured' })
})

test('the page never feeds data through innerHTML', () => {
  const app = readFileSync(join(root, 'site', 'app.js'), 'utf8')
  assert.equal(/\.innerHTML\s*=|insertAdjacentHTML|outerHTML\s*=/.test(app), false)
})
