#!/usr/bin/env node
// Builds the GitHub Pages site's data from the repo: our mods (registry.json and
// each plugin.json), the curated community list (data/community.json) and the
// full index (data/mods.json, data/stats.json). Writes site/data.json and copies
// the images the page shows. Deterministic: the same inputs give the same bytes.
//
//   node scripts/build-site.mjs

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = 'Singh-AP/awesome-claude-mods'
export const SIZE_BUDGET = 700 * 1024
const TEXT_LIMIT = 160

// Categories the index has beyond the registry's own.
const EXTRA_CATEGORIES = [
  { id: 'ui', emoji: '🎨', title: 'UI & Themes', blurb: 'Restyled transcripts, spinners, prompts and themes.' },
  { id: 'integrations', emoji: '🔌', title: 'Integrations', blurb: 'Browsers, phones, trackers, memory and other tools, inside Claude Code.' },
  { id: 'other', emoji: '🧩', title: 'Other', blurb: 'Everything that fits nowhere else.' },
]

// Render sites that restyle what Claude Code itself draws.
const RESTYLE = new Set(['Spinner', 'ToolUse', 'ToolResult', 'ToolGroup', 'AssistantMessage', 'UserMessage', 'TurnDuration', 'PromptHint', 'SessionMode', 'CommandOutput', 'InfoNotice', 'ToolProgress', 'AskUserQuestion'])

/** Collapses whitespace and cuts at a word near `limit`, with an ellipsis. */
export function trimText(value, limit = TEXT_LIMIT) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  if (text.length <= limit) return text
  const cut = text.slice(0, limit - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > limit * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.…-]+$/, '')}…`
}

/** `./a/b/` → `a/b`; the repo root is `.`. */
export function normalizePath(path) {
  const clean = String(path ?? '').replace(/^\.\/+/, '').replace(/\/+$/, '')
  return clean === '' || clean === '.' ? '.' : clean
}

/** A GitHub tree URL → `{ repo, path }`; a repo URL is its root. */
export function repoPathFromUrl(url) {
  const match = String(url ?? '').match(/^https:\/\/github\.com\/([^/]+\/[^/#?]+?)(?:\.git)?(?:\/tree\/[^/]+\/(.+?))?\/?(?:[#?].*)?$/)
  if (!match) return undefined
  return { repo: match[1].toLowerCase(), path: normalizePath(match[2] ?? '.') }
}

const keyOf = (repo, path) => `${String(repo).toLowerCase()}::${normalizePath(path)}`

/** Pane, band, status line and restyle bits from what a mod draws and calls. */
export function uiBits(components = [], calls = []) {
  let bits = ''
  if (components.includes('Pane')) bits += 'P'
  if (components.includes('AbovePrompt')) bits += 'B'
  if (calls.some(call => call === 'ui.status' || call === '$.ui.status')) bits += 'S'
  if (components.some(c => RESTYLE.has(c))) bits += 'R'
  return bits
}

/** Events, components and calls read off a hooks module's source, as the scanner does. */
export function readSource(source) {
  const events = [...new Set([...source.matchAll(/\bon\(\s*['"]([a-zA-Z.*]+)['"]/g)].map(m => m[1]))].sort()
  const components = [...new Set([...source.matchAll(/component:\s*['"]([A-Za-z]+)['"]/g)].map(m => m[1]))].sort()
  const calls = [...new Set([...source.matchAll(/\$\.([a-z]+\.[a-zA-Z]+)\b/g)].map(m => m[1]))].sort()
  return { events, components, calls }
}

const hookTerms = (events = [], components = []) => [...new Set([...events, ...components])]

const ownerOf = repo => String(repo ?? '').split('/')[0] ?? ''

/**
 * Merges the three sources into the page's items, built first, curated next,
 * the index last; an entry already shown as built or curated isn't repeated.
 * @param {object} input registry, manifests (name → plugin.json), sources
 *   (name → hooks source text), community, index, stats
 */
export function buildData({ registry, manifests = {}, sources = {}, community = [], index = [], stats = {}, textLimit = TEXT_LIMIT }) {
  const updated = String(stats.updated ?? '').slice(0, 10)
  const indexByKey = new Map()
  const indexByUrl = new Map()
  for (const entry of index) {
    indexByKey.set(keyOf(entry.repo, entry.path), entry)
    if (entry.url) indexByUrl.set(String(entry.url).replace(/\/+$/, ''), entry)
  }
  const shown = new Set()
  const claim = (repo, path, url) => {
    if (repo !== undefined) shown.add(keyOf(repo, path))
    if (url) shown.add(String(url).replace(/\/+$/, ''))
  }
  const isShown = entry => shown.has(keyOf(entry.repo, entry.path)) || shown.has(String(entry.url ?? '').replace(/\/+$/, ''))

  const items = []

  for (const [order, mod] of (registry.mods ?? []).entries()) {
    const path = `mods/${mod.category}/${mod.name}`
    const manifest = manifests[mod.name] ?? {}
    const read = readSource(sources[mod.name] ?? '')
    const url = `https://github.com/${REPO}/tree/main/${path}`
    claim(REPO, path, url)
    items.push({
      k: 'b',
      n: mod.name,
      e: mod.emoji,
      d: trimText(mod.tagline, 200),
      c: mod.category,
      u: url,
      a: 'awesome-claude-mods',
      r: REPO,
      l: manifest.license ?? 'MIT',
      t: updated,
      v: manifest.version,
      ui: uiBits(read.components, read.calls),
      h: hookTerms(read.events, read.components),
      i: mod.name,
      x: mod.screenshot ? `screens/${mod.screenshot.split('/').pop()}` : undefined,
      o: order,
    })
  }

  for (const pick of community) {
    const where = repoPathFromUrl(pick.url)
    const match = (where && indexByKey.get(keyOf(where.repo, where.path))) ?? indexByUrl.get(String(pick.url ?? '').replace(/\/+$/, ''))
    claim(where?.repo ?? match?.repo, where?.path ?? match?.path, pick.url)
    if (match) claim(match.repo, match.path, match.url)
    items.push({
      k: 'c',
      n: pick.name,
      e: pick.emoji,
      d: trimText(pick.tagline, 200),
      c: pick.category,
      s: Number(pick.stars ?? match?.stars ?? 0),
      u: pick.url,
      a: pick.author ?? ownerOf(match?.repo),
      r: match?.repo ?? where?.repo,
      l: pick.license ?? match?.license ?? undefined,
      t: match?.createdAt ?? match?.firstSeen ?? undefined,
      ui: match ? uiBits(match.components, match.calls) : '',
      h: match ? hookTerms(match.events, match.components) : [],
      i: pick.marketplace?.name,
    })
  }

  for (const entry of index) {
    if (isShown(entry)) continue
    // The kind (`k: 'i'`), URL and author of an index entry are left for the page to derive.
    const path = normalizePath(entry.path)
    items.push({
      n: entry.name,
      d: trimText(entry.description || entry.repo_description || '', textLimit),
      c: entry.category ?? 'other',
      s: Number(entry.stars ?? 0),
      r: entry.repo,
      p: path === '.' ? undefined : path,
      l: entry.license ?? undefined,
      t: entry.createdAt ?? entry.firstSeen ?? undefined,
      ui: uiBits(entry.components, entry.calls),
      h: hookTerms(entry.events, entry.components),
    })
  }

  // Hook names come from a small vocabulary: store each as its index into it.
  const vocab = [...new Set(items.flatMap(item => item.h ?? []))].sort()
  const at = new Map(vocab.map((term, i) => [term, i]))

  // Drop empty keys so the file stays small, and fix the order.
  const rank = { b: 0, c: 1, i: 2 }
  const kind = item => item.k ?? 'i'
  const slim = items
    .map(item => ({ ...item, h: (item.h ?? []).map(term => at.get(term)).sort((a, b) => a - b) }))
    .map(item => Object.fromEntries(Object.entries(item).filter(([, v]) => v !== undefined && v !== '' && v !== null && !(Array.isArray(v) && v.length === 0))))
    .sort((a, b) => rank[kind(a)] - rank[kind(b)] || (a.o ?? 0) - (b.o ?? 0) || (b.s ?? 0) - (a.s ?? 0) || a.n.localeCompare(b.n, 'en') || `${a.r}/${a.p ?? ''}`.localeCompare(`${b.r}/${b.p ?? ''}`, 'en'))

  const categories = [...(registry.categories ?? []), ...EXTRA_CATEGORIES.filter(c => !(registry.categories ?? []).some(r => r.id === c.id))]
  const built = slim.filter(i => i.k === 'b').length
  const curated = built + slim.filter(i => i.k === 'c').length
  return {
    updated,
    stats: {
      built,
      curated,
      installable: slim.filter(i => i.i).length,
      indexed: Number(stats.mods ?? index.length),
      repos: Number(stats.repos ?? new Set(index.map(e => e.repo)).size),
      tests: Number(registry.testCount ?? 0),
    },
    categories: categories.map(({ id, emoji, title, blurb }) => ({ id, emoji, title, blurb })),
    vocab,
    items: slim,
  }
}

// ── command line ──────────────────────────────────────────────────────────────

function readJson(path, fallback) {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback
}

function hooksSource(dir) {
  const hooks = join(dir, 'hooks')
  if (!existsSync(hooks)) return ''
  return readdirSync(hooks)
    .filter(name => /\.(m?[jt]sx?|c[jt]s)$/.test(name))
    .sort()
    .map(name => readFileSync(join(hooks, name), 'utf8'))
    .join('\n')
}

export function main(root = join(dirname(fileURLToPath(import.meta.url)), '..')) {
  const registry = readJson(join(root, 'registry.json'), { mods: [], categories: [] })
  const manifests = {}
  const sources = {}
  for (const mod of registry.mods) {
    const dir = join(root, 'mods', mod.category, mod.name)
    manifests[mod.name] = readJson(join(dir, '.claude-plugin', 'plugin.json'), {})
    sources[mod.name] = hooksSource(dir)
  }
  const input = {
    registry,
    manifests,
    sources,
    community: readJson(join(root, 'data', 'community.json'), []),
    index: readJson(join(root, 'data', 'mods.json'), []),
    stats: readJson(join(root, 'data', 'stats.json'), {}),
  }
  // As the index grows, index descriptions get shorter before the file outgrows its budget.
  let data
  let text = ''
  for (const textLimit of [TEXT_LIMIT, 120, 90, 60]) {
    data = buildData({ ...input, textLimit })
    text = JSON.stringify(data)
    if (Buffer.byteLength(text) <= SIZE_BUDGET) break
  }

  const site = join(root, 'site')
  writeFileSync(join(site, 'data.json'), text)

  // The images the page shows, copied fresh so stale ones never linger.
  rmSync(join(site, 'screens'), { recursive: true, force: true })
  mkdirSync(join(site, 'screens'), { recursive: true })
  const shots = new Set(registry.mods.flatMap(m => [m.screenshot, m.readmeShot]).filter(Boolean))
  shots.add('assets/screens/hero.svg')
  for (const shot of [...shots].sort()) {
    if (existsSync(join(root, shot))) copyFileSync(join(root, shot), join(site, 'screens', shot.split('/').pop()))
  }
  for (const [from, to] of [['assets/banner.svg', 'banner.svg'], ['assets/social-preview.png', 'og.png']]) {
    if (existsSync(join(root, from))) copyFileSync(join(root, from), join(site, to))
  }

  const kb = (Buffer.byteLength(text) / 1024).toFixed(0)
  console.log(`site/data.json: ${data.items.length} items (${data.stats.built} built, ${data.stats.curated - data.stats.built} curated, ${data.items.filter(i => i.k === undefined).length} indexed), ${kb} KB`)
  if (Buffer.byteLength(text) > SIZE_BUDGET) {
    console.error(`✘ site/data.json is over its ${SIZE_BUDGET / 1024} KB budget`)
    process.exitCode = 1
  }
  return data
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
