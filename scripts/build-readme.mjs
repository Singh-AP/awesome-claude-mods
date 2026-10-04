#!/usr/bin/env node
// Builds README.md and .claude-plugin/marketplace.json from registry.json,
// each mod's plugin.json, and scripts/README.template.md.
//
//   node scripts/build-readme.mjs          write both files
//   node scripts/build-readme.mjs --check  exit 1 if either is stale (CI)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(fileURLToPath(import.meta.url), '..', '..')
const REPO = 'Singh-AP/awesome-claude-mods'
const MARKETPLACE = 'awesome-claude-mods'
const isCheck = process.argv.includes('--check')

const read = path => readFileSync(join(root, path), 'utf8')
const registry = JSON.parse(read('registry.json'))
const categories = new Map(registry.categories.map(c => [c.id, c]))
// Curated community mods; `marketplace` marks the ones vetted and pinned for install from here.
const community = existsSync(join(root, 'data', 'community.json')) ? JSON.parse(read('data/community.json')) : []

const problems = []
const mods = registry.mods.map(entry => {
  const path = `mods/${entry.category}/${entry.name}`
  const manifestPath = join(root, path, '.claude-plugin', 'plugin.json')
  if (!categories.has(entry.category)) problems.push(`${entry.name}: unknown category ${entry.category}`)
  if (!existsSync(manifestPath)) {
    problems.push(`${entry.name}: no ${path}/.claude-plugin/plugin.json`)
    return { ...entry, path, manifest: {} }
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (manifest.name !== entry.name) problems.push(`${entry.name}: plugin.json name is ${manifest.name}`)
  if (!existsSync(join(root, path, 'README.md'))) problems.push(`${entry.name}: no README.md`)
  return { ...entry, path, manifest }
})

if (problems.length > 0) {
  console.error(problems.map(p => `✘ ${p}`).join('\n'))
  process.exit(1)
}

// ── marketplace.json ────────────────────────────────────────────────────────
const marketplace = {
  $schema: 'https://anthropic.com/claude-code/marketplace.schema.json',
  name: MARKETPLACE,
  owner: { name: 'Singh-AP', url: 'https://github.com/Singh-AP' },
  metadata: {
    description: 'Tested, ready-to-install Claude Code mods: guardrails, status lines, panes, notifications and fun.',
    version: registry.version,
  },
  plugins: [
    ...mods.map(m => ({
      name: m.name,
      source: `./${m.path}`,
      description: m.manifest.description,
      version: m.manifest.version,
      category: m.category,
      tags: m.manifest.keywords ?? [],
      author: m.manifest.author,
      homepage: `https://github.com/${REPO}/tree/main/${m.path}`,
    })),
    ...community
      .filter(c => c.marketplace !== undefined)
      .map(c => ({
        name: c.marketplace.name ?? c.name,
        source: c.marketplace.source,
        description: c.tagline,
        category: c.category,
        author: { name: c.author, url: c.authorUrl },
        homepage: c.url,
      })),
  ],
}

// ── README.md ───────────────────────────────────────────────────────────────
const externalCount = community.length
const modCount = mods.length
const installable = community.filter(c => c.marketplace !== undefined)
const stats = existsSync(join(root, 'data', 'stats.json')) ? JSON.parse(read('data/stats.json')) : undefined

function compact(n) {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, '')}k`
  return String(n)
}

function catalog() {
  const lines = []
  for (const category of registry.categories) {
    const own = mods.filter(m => m.category === category.id)
    const theirs = community.filter(c => c.category === category.id)
    if (own.length + theirs.length === 0) continue
    lines.push(`### ${category.emoji} ${category.title}`, '', `*${category.blurb}*`, '')
    for (const m of own) lines.push(`*   [${m.emoji} ${m.name}](${m.path}/) - ${m.tagline}`)
    for (const c of theirs) {
      const notes = [`by [${c.author}](${c.authorUrl})`]
      if (c.stars >= 50) notes.push(`★ ${compact(c.stars)}`)
      if (c.marketplace !== undefined) notes.push('📦 installable here')
      lines.push(`*   [${c.emoji} ${c.name}](${c.url}) - ${c.tagline} <sub>${notes.join(' · ')}</sub>`)
    }
    lines.push('')
  }
  return lines.join('\n').trim()
}

function installTable() {
  const rows = [
    ...mods.map(m => `| ${m.emoji} [${m.name}](${m.path}/) | this repo | \`/plugin install ${m.name}@${MARKETPLACE}\` |`),
    ...installable.map(c => `| ${c.emoji} [${c.marketplace.name}](${c.url}) | [${c.author}](${c.authorUrl}), pinned | \`/plugin install ${c.marketplace.name}@${MARKETPLACE}\` |`),
  ]
  return ['| Mod | From | Install |', '| --- | --- | --- |', ...rows].join('\n')
}

function gallery() {
  const order = ['bash-guard', 'command-explainer', 'secret-shield', 'tool-radar', 'test-pulse', 'wrapped']
  const shots = mods
    .filter(m => m.screenshot !== undefined && existsSync(join(root, m.screenshot)))
    .sort((a, b) => (order.indexOf(a.name) + 1 || 99) - (order.indexOf(b.name) + 1 || 99))
  if (shots.length === 0) return ''
  const cells = shots.map(m =>
    `<td width="33%" align="center"><a href="${m.path}/"><img src="${m.screenshot}" alt="${m.name}"></a><br><sub><b>${m.emoji} ${m.name}</b></sub></td>`,
  )
  const rows = []
  for (let i = 0; i < cells.length; i += 3) rows.push(`<tr>\n${cells.slice(i, i + 3).join('\n')}\n</tr>`)
  return `<table>\n${rows.join('\n')}\n</table>`
}

function indexSection() {
  if (!existsSync(join(root, 'catalog', 'README.md'))) return ''
  const updated = stats ? ` Last refreshed ${stats.updated.slice(0, 10)}.` : ''
  return [
    '## 🌍 The full index',
    '',
    `Want everything? A GitHub Action scans GitHub every day for public mods, checks each one's \`hooks.json\`, and drops copies and test fixtures. It currently lists **${stats ? stats.mods.toLocaleString('en-US') : 'every'} mods across ${stats ? stats.repos.toLocaleString('en-US') : 'all'} repos**, sorted by stars and grouped by category.${updated}`,
    '',
    '**[Browse the full index →](catalog/README.md)**',
  ].join('\n')
}

const fill = (template, values) =>
  template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    if (!(key in values)) throw new Error(`README template: unknown {{${key}}}`)
    return values[key]
  })

const readme = fill(read('scripts/README.template.md'), {
  MOD_COUNT: String(modCount),
  EXTERNAL_COUNT: String(externalCount),
  TOTAL_COUNT: String(modCount + externalCount),
  INSTALLABLE_COUNT: String(modCount + installable.length),
  PINNED_COUNT: String(installable.length),
  INDEX_COUNT: stats ? stats.mods.toLocaleString('en-US') : '2,000+',
  INDEX_REPOS: stats ? stats.repos.toLocaleString('en-US') : '1,000+',
  INDEX_UPDATED: stats ? stats.updated.slice(0, 10) : '',
  TEST_COUNT: String(registry.testCount ?? 0),
  CATALOG: catalog(),
  INSTALL_TABLE: installTable(),
  GALLERY: gallery(),
  INDEX_SECTION: indexSection(),
  REPO,
  MARKETPLACE,
})

const outputs = [
  ['README.md', readme],
  ['.claude-plugin/marketplace.json', JSON.stringify(marketplace, null, 2) + '\n'],
]

let isStale = false
for (const [path, text] of outputs) {
  const current = existsSync(join(root, path)) ? read(path) : ''
  if (current === text) continue
  if (isCheck) {
    console.error(`✘ ${path} is out of date: run npm run readme`)
    isStale = true
  } else {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
    console.log(`wrote ${path}`)
  }
}
if (isCheck && !isStale) console.log('✔ README.md and marketplace.json are up to date')
process.exit(isStale ? 1 : 0)
