// Pure logic shared by the page (app.js) and the node tests: search, filters,
// sorting, URL-hash state and escaping. No DOM in here.

/** Kinds, in the order the "Featured" sort puts them. */
export const KINDS = { b: 'Built here', c: 'Curated', i: 'Indexed' }
const KIND_RANK = { b: 0, c: 1, i: 2 }
// Browsing with no search: the built mods are already shown above the browser.
const BROWSE_RANK = { c: 0, b: 1, i: 2 }

export const FLAGS = ['built', 'curated', 'installable', 'ui']
export const SORTS = ['featured', 'stars', 'newest', 'name']
export const PAGE_SIZE = 60

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

/** Escapes text for HTML; for the rare string that must go through innerHTML. */
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => HTML_ESCAPES[ch])
}

/** Only https links are drawn as links; anything else (javascript:, data:) is dropped. */
export function safeUrl(value) {
  const url = String(value ?? '')
  return /^https:\/\/[^\s"'<>]+$/.test(url) ? url : ''
}

/** Splits `text` on backticks: [{ text, isCode }], so `code` can be drawn as code safely. */
export function segments(text) {
  const parts = String(text ?? '').split('`')
  // An odd number of backticks leaves the last one literal.
  if (parts.length % 2 === 0) parts[parts.length - 2] += '`' + parts.pop()
  return parts.map((part, i) => ({ text: part, isCode: i % 2 === 1 })).filter(p => p.text !== '')
}

/** 1234 → "1.2k", 149360 → "149k". */
export function compactNumber(n) {
  const value = Number(n) || 0
  if (value < 1000) return String(value)
  if (value < 10_000) return `${(value / 1000).toFixed(1).replace(/\.0$/, '')}k`
  if (value < 1_000_000) return `${Math.round(value / 1000)}k`
  return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
}

/** Lower-cased words of a query; quotes and punctuation are just separators. */
export function tokenize(query) {
  return String(query ?? '')
    .toLowerCase()
    .split(/[\s,;"']+/)
    .filter(Boolean)
}

/** What a search reads for one item: name, text, repo, author, hooks, category. */
export function haystack(item, categories = {}) {
  const category = categories[item.c]?.title ?? ''
  return [item.n, item.d, item.r, item.a, item.h, item.c, category, item.i].filter(Boolean).join(' ').toLowerCase()
}

/** Where an item lives: its own URL, or the repo folder an index entry names. */
export function itemUrl(item) {
  if (item.u) return item.u
  if (!item.r) return ''
  return item.p ? `https://github.com/${item.r}/tree/HEAD/${item.p}` : `https://github.com/${item.r}`
}

/**
 * Unpacks data.json's compact items (kind and author defaulted, hook names
 * stored as indexes into `vocab`) and gives each its search text once, so
 * typing stays instant.
 */
export function prepare(items, categories = [], vocab = []) {
  const byId = Object.fromEntries(categories.map(c => [c.id, c]))
  return items.map(raw => {
    const item = {
      ...raw,
      k: raw.k ?? 'i',
      a: raw.a ?? String(raw.r ?? '').split('/')[0],
      h: Array.isArray(raw.h) ? raw.h.map(i => vocab[i]).filter(Boolean).join(' ') : (raw.h ?? ''),
    }
    item.u = itemUrl(item)
    item._h = haystack(item, byId)
    return item
  })
}

export function hasUi(item) {
  return typeof item.ui === 'string' && item.ui !== ''
}

/** Every token must appear somewhere (AND), as a substring. */
export function matches(item, tokens) {
  const text = item._h ?? haystack(item)
  return tokens.every(token => text.includes(token))
}

function passesFlags(item, flags) {
  if (flags.has('built') && item.k !== 'b') return false
  if (flags.has('curated') && item.k === 'i') return false
  if (flags.has('installable') && !item.i) return false
  if (flags.has('ui') && !hasUi(item)) return false
  return true
}

const byName = (a, b) => a.n.localeCompare(b.n, 'en') || (a.r ?? '').localeCompare(b.r ?? '', 'en')

const COMPARE = {
  // Built mods keep the registry's order (`o`); the rest go by stars.
  featured: (a, b) => KIND_RANK[a.k] - KIND_RANK[b.k] || (a.o ?? 0) - (b.o ?? 0) || (b.s ?? 0) - (a.s ?? 0) || byName(a, b),
  stars: (a, b) => (b.s ?? 0) - (a.s ?? 0) || KIND_RANK[a.k] - KIND_RANK[b.k] || byName(a, b),
  newest: (a, b) => (b.t ?? '').localeCompare(a.t ?? '') || (b.s ?? 0) - (a.s ?? 0) || byName(a, b),
  name: byName,
}

const browseOrder = (a, b) => BROWSE_RANK[a.k] - BROWSE_RANK[b.k] || (a.o ?? 0) - (b.o ?? 0) || (b.s ?? 0) - (a.s ?? 0) || byName(a, b)

/**
 * Applies the state: `{ q, cat, flags, sort }`. Returns the matching items in
 * order, and per-category counts for the chips (everything but `cat` applied).
 */
export function query(items, state) {
  const tokens = tokenize(state.q)
  const flags = new Set(state.flags ?? [])
  const counts = {}
  const out = []
  for (const item of items) {
    if (!passesFlags(item, flags) || !matches(item, tokens)) continue
    counts[item.c] = (counts[item.c] ?? 0) + 1
    if (state.cat && item.c !== state.cat) continue
    out.push(item)
  }
  const isBrowsing = tokens.length === 0 && flags.size === 0 && (state.sort ?? 'featured') === 'featured'
  out.sort(isBrowsing ? browseOrder : (COMPARE[state.sort] ?? COMPARE.featured))
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  return { items: out, counts, total }
}

/** `#q=guard&cat=safety&f=built,ui&sort=stars` → state; unknown values are dropped. */
export function parseHash(hash) {
  const params = new URLSearchParams(String(hash ?? '').replace(/^#/, ''))
  const flags = (params.get('f') ?? '').split(',').filter(f => FLAGS.includes(f))
  const sort = params.get('sort')
  return {
    q: (params.get('q') ?? '').slice(0, 200),
    cat: (params.get('cat') ?? '').replace(/[^a-z-]/g, '').slice(0, 40),
    flags: [...new Set(flags)],
    sort: SORTS.includes(sort) ? sort : 'featured',
  }
}

/** State → hash, leaving defaults out so a fresh page has a clean URL. */
export function formatHash(state) {
  const params = new URLSearchParams()
  if (state.q) params.set('q', state.q)
  if (state.cat) params.set('cat', state.cat)
  if (state.flags?.length) params.set('f', FLAGS.filter(f => state.flags.includes(f)).join(','))
  if (state.sort && state.sort !== 'featured') params.set('sort', state.sort)
  const text = params.toString()
  return text === '' ? '' : `#${text}`
}

/** The install line for an installable item. */
export function installCommand(item) {
  return item.i ? `/plugin install ${item.i}@awesome-claude-mods` : ''
}

/** `PBS` → readable UI labels. */
export const UI_LABELS = { P: 'Pane', B: 'Band above the prompt', S: 'Status line', R: 'Restyles Claude Code' }
export function uiLabels(bits) {
  return [...String(bits ?? '')].map(bit => UI_LABELS[bit]).filter(Boolean)
}
