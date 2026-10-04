// Pure helpers for the mods index: no network, no file system, so
// scripts/test/mods-index.test.mjs can cover them. scan-mods.mjs does the I/O,
// build-catalog.mjs the rendering.

import { createHash } from 'node:crypto'

/** Mods were visible in early access from September 2026; no entry predates it. */
export const INDEX_EPOCH = '2026-09-01'

export const CATEGORIES = [
  { id: 'safety', emoji: '🛡️', title: 'Safety & Security', blurb: 'Guards, redaction, policy and permission helpers.' },
  { id: 'cost', emoji: '💸', title: 'Cost & Context', blurb: 'Tokens, spend, context window, compaction and caching.' },
  { id: 'awareness', emoji: '📡', title: 'Status & Awareness', blurb: 'Dashboards, monitors, git and activity views.' },
  { id: 'productivity', emoji: '⚡', title: 'Productivity & Workflow', blurb: 'Prompts, tasks, reviews, memory of your own work.' },
  { id: 'notifications', emoji: '🔔', title: 'Notifications', blurb: 'Sounds, desktop pings, voice and alerts.' },
  { id: 'fun', emoji: '🎮', title: 'Fun & Games', blurb: 'Pets, games, music and delight.' },
  { id: 'ui', emoji: '🎨', title: 'Look & Feel', blurb: 'Themes, spinners, transcript and tool-row restyles.' },
  { id: 'integrations', emoji: '🔌', title: 'Integrations', blurb: 'Browsers, phones, trackers, notes, memory services and other tools.' },
  { id: 'other', emoji: '🧩', title: 'Everything else', blurb: 'Mods that fit no single shelf.' },
]

const CATEGORY_IDS = new Set(CATEGORIES.map(c => c.id))

// Components that restyle something Claude Code already draws.
const RESTYLE_COMPONENTS = new Set([
  'Spinner', 'AssistantMessage', 'UserMessage', 'ToolUse', 'ToolResult', 'ToolGroup',
  'TurnDuration', 'CommandOutput', 'AskUserQuestion', 'InfoNotice', 'ToolProgress', 'SessionMode',
])

// Keyword rules: [category, weight, pattern]. Matched against the name (x3) and
// the description (x1), lower-cased.
const RULES = [
  ['safety', 3, /\b(guard(s|rail|rails|ian)?|firewall|sandbox(ed|ing)?|redact(s|ed|ion|ing)?|pii|secrets?|credentials?|leaks?|danger(ous)?|destructive|rm -rf|blast[- ]radius|veto(es)?|denies|deny (list|rules?)|blocked|block(s|ing)? (\w+ )?(commands?|calls?|edits?|writes?|access|pushes?|deletes?|merges?)|protect(s|ed|ion)?|secur(e|ity)|safe(ty|ly)?|polic(y|ies)|prompt[- ]injection|injection|malicious|exfiltrat\w*|allow-?list|deny-?list|risky|audit(s|ing)?|trust gate|tamper\w*|confirm(s|ation)? before|osv|vulnerab\w*|cves?|typosquat\w*|slopsquat\w*|supply[- ]chain|malware)\b/],
  ['cost', 3, /\b(cost(s)?|spend(ing)?|budget(s)?|billing|price(s|d)?|pricing|dollars?|tokens?|token[- ]?(usage|budget|meter|burn)|quota|rate[- ]limit(s)?|(5|five)[- ]hour|weekly (usage|limit)|plan usage|usage (limit|meter|bar)s?|context[- ](window|usage|budget|meter|fill|level|limit|sieve|filter\w*|prun\w*|bloat|diet|management|manager|saver|savings?|hygiene)|compact(ion|ing|s)?|prun(e|es|ing)|prompt cache|cache[- ](warm|hit|miss|tax)|ghost tokens?|burn[- ]?(rate|meter)|cheaper|savings?|frugal|context guard|rate limit guard|budget guard|token guard|shrink(s|ing)? (each |every )?(bash |tool )?(results?|output)|token[- ]saving|saves? (\d+(-\d+)?% )?(of )?tokens)\b/],
  ['notifications', 3, /\b(notif(y|ies|ication|ications)|desktop (ping|alert)s?|alerts?|sounds?|chimes?|ding|bell|beep|ping(s|ed)?|speak(s|ing)? (aloud|out)|voice (alerts?|notifications?)|tts|text[- ]to[- ]speech|say(s)? aloud|audio cues?|ntfy|pushover|speech|reads? (\w+ )?(out|aloud)|wake(s)? (you|the session)|when (claude|it|a turn) (is )?(done|finish(es)?))\b/],
  ['fun', 3, /\b(games?|gaming|play(s|ing)? (doom|snake|tetris|games?|music|chess|pong)|pet(s)?|buddy|tamagotchi|creature|doom|snake|tetris|arcade|pong|chess|minesweeper|wordle|2048|trivia|jokes?|fun|funny|silly|meme|confetti|celebrat\w*|party|xp|level[- ]?up|achievements?|quests?|boss[- ]?fight|rpg|pokemon|abra|pikachu|pixel(-art)?|cat|dog|duck|crab|fish|aquarium|garden|music|spotify|lo-?fi|radio|breath(e|ing)|mindful\w*|meditat\w*|fortune|horoscope|ascii art|easter egg|wrapped|streaks?|leaderboard|gacha|youtube|shorts|reels|tiktok|twitch|videos?|persona|role-?play|anime|genshin|character's voice|cartoons?|comics?|short stor(y|ies)|tinystories|storytell\w*|scenes?|animat(ed|ion|ions)|subway surfers|endless runner)\b/],
  ['ui', 3, /\b(themes?|theming|skins?|re-?skin\w*|restyl\w*|styling|stylesheet|colou?r(s|ful|ize)? (scheme|theme)s?|palette|spinner(s)?|spinner (words?|verbs?)|transcript (view|style)|tool rows?|appearance|look(s)? (and|&) feel|cosmetic|minimal(ist)? (ui|look|view)|calm|zen mode|declutter|compact view|typography|fonts?|banner|ascii logo|branding|syntax highlight\w*|retro|crt|matrix rain|(conversation|transcript)[- ]only|working animation|spinner animation)\b/],
  ['integrations', 3, /\b(browser(s)?|chrome|playwright|puppeteer|phone|mobile|android|ios|simulator|emulator|jira|linear|github issues?|gitlab|slack|discord|telegram|whatsapp|email|gmail|outlook|calendar|reminders?|notion|obsidian|logseq|confluence|figma|power ?bi|fabric|databricks|snowflake|bigquery|postgres|mysql|database|kubernetes|k8s|docker|aws|gcp|azure|vercel|supabase|firebase|stripe|sentry|datadog|grafana|home ?assistant|iot|wifi|mqtt|memory (service|layer|system)|supermemory|mem0|zotero|anki|todoist|trello|asana|clickup|twitter|reddit|hacker news|rss|webhook(s)?|remote (control|machine)|ssh|tmux|vs ?code|neovim|emacs|zed|jetbrains|xcode|unity|blender|godot|n8n|zapier|stocks?|watchlists?|tickers?|finance|crypto|yahoo|web ?search|search engine|codex|gemini|openai|openrouter|ollama|cursor)\b/],
  ['awareness', 3, /\b(mission control|control room|command center|cockpit|dashboard(s)?|at a glance|radar|hud)\b/],
  ['awareness', 2, /\b(status ?(line|bar)|hud|dashboard(s)?|monitor(s|ing)?|radar|observ(e|ability|er)|watch(es|er|ing)? (claude|subagents?|agents?|files?|what)|track(s|er|ing)?|timeline|activity|progress|live (view|map|line)|cockpit|mission control|overview|glance|insights?|analytics|metrics|stats|telemetry|logs?|trace(s|ing)?|diff(s)?|git|branch|commits?|changed files|files? (changed|touched|created)|receipt|replay|heatmap|tree ?map|file ?tree|subagents?|agents? (view|pane|list|tree)|what('s| is) claude doing|heartbeat|ci (status|lights)|pipeline|recorder|x-?ray|inspector)\b/],
  ['productivity', 2, /\b(prompt (library|snippets?|templates?|coach\w*|enhanc\w*|rewrit\w*|improv\w*|history)|saved prompts|snippets?|templates?|todo(s)?|tasks?|tickets?|plan(s|ning|ner)?|review(s|er|ing)?|code review|commit messages?|standup|journal|notes?|notebook|summar(y|ies|ize|izes)|tl;?dr|recap|next (steps?|prompts?)|suggest(s|ion|ions)?|autocomplete|shortcut(s)?|workflow(s)?|automat\w*|focus|goal(s)?|checklist|lint(er|ing)?|format(ter|ting)?|tests?|testing|tdd|docs?|documentation|refactor\w*|search|grep|bookmark(s)?|clipboard|quote|handoff|hand(s)? (it )?off|checkpoint(s)?|undo|rewind|session (notes|memory|names?)|memory|memories|remember|learn(s|ing)?|lessons?|corrections?|claude\.md|agents\.md|instructions?|rules|skills?|scratchpad|kanban|pomodoro|timer|delegate|orchestrat\w*|multi-?agent|swarm|pair|translat\w*|grammar|spell\w*|dictat\w*|inbox|spec|specs|governance|architecture)\b/],
]

// Signals from the code itself.
const EVENT_SIGNALS = [
  ['safety', 3, /^(tool\.check|plugin\.register)$/],
  ['safety', 1, /^(classic\.PermissionRequest|classic\.PreToolUse|session\.append)$/],
  ['notifications', 1, /^classic\.PermissionRequest$/],
  ['cost', 3, /^(session\.measure|session\.compact)$/],
  ['notifications', 2, /^classic\.Notification$/],
  ['productivity', 1, /^(prompt\.compose|prompt\.context|prompt\.submit|prompt\.edit|prompt\.fill|skill\.prompt)$/],
]
const CALL_SIGNALS = [
  ['notifications', 4, /^audio\./],
  ['cost', 2, /^session\.usage$/],
  ['awareness', 1, /^ui\.status$/],
]

const lower = s => (s ?? '').toLowerCase()

function count(pattern, text) {
  const global = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g')
  return Math.min((text.match(global) ?? []).length, 3)
}

// Phrases that mention a category word without being about it.
const NOISE = [
  /\b(zero|no|0|without( using)?( any)?) (extra |model |api )?tokens?\b/g,
  /\b(in|on) (the )?["“「]?safety["”」]? (page|tab)\b/g,
  /「安全」页/g,
]

/**
 * Picks one shelf for a mod from its name, description, events, components
 * and `$` calls. Name hits count triple. Code signals add to the score, but
 * on a tie the words win, then the order of CATEGORIES. Deterministic.
 */
export function categorize({ name = '', description = '', events = [], components = [], calls = [] }) {
  const words = Object.fromEntries(CATEGORIES.map(c => [c.id, 0]))
  const code = Object.fromEntries(CATEGORIES.map(c => [c.id, 0]))
  const nameText = lower(name).replace(/[-_]+/g, ' ')
  let descText = lower(description)
  for (const noise of NOISE) descText = descText.replace(noise, ' ')

  for (const [category, weight, pattern] of RULES) {
    words[category] += weight * (3 * count(pattern, nameText) + count(pattern, descText))
  }
  for (const event of events) {
    for (const [category, weight, pattern] of EVENT_SIGNALS) if (pattern.test(event)) code[category] += weight
  }
  for (const raw of calls) {
    const call = raw.replace(/^\$\./, '')
    for (const [category, weight, pattern] of CALL_SIGNALS) if (pattern.test(call)) code[category] += weight
  }
  const restyles = components.filter(c => RESTYLE_COMPONENTS.has(c)).length
  if (restyles > 0 && !components.includes('Pane')) code.ui += restyles >= 3 ? 3 : 2

  // Code alone is a hint, not a verdict: without a word for the category it counts for 2 at most.
  const score = id => words[id] + (words[id] > 0 ? code[id] : Math.min(code[id], 2))
  let best = 'other'
  for (const { id } of CATEGORIES) {
    if (id === 'other') continue
    const total = score(id)
    const bestTotal = best === 'other' ? 0 : score(best)
    if (total > bestTotal || (total === bestTotal && total > 0 && words[id] > words[best])) best = id
  }
  const bestTotal = best === 'other' ? 0 : score(best)
  if (bestTotal >= 3) return best
  // Weak evidence: a word beats what the mod draws, which beats a lone code signal.
  const byWords = CATEGORIES.filter(c => c.id !== 'other').reduce((a, c) => (words[c.id] > words[a] ? c.id : a), 'safety')
  if (words[byWords] > 0) return byWords
  if (restyles > 0) return 'ui'
  if (components.includes('Pane') || components.includes('AbovePrompt')) return 'awareness'
  return bestTotal > 0 ? best : 'other'
}

export function isCategory(id) {
  return CATEGORY_IDS.has(id)
}

// ── Source extraction ──────────────────────────────────────────────────────

const EVENT_RE = /\bon\(\s*['"`]([a-zA-Z]+\.[a-zA-Z.*]+)['"`]/g
const COMPONENT_RE = /component\s*:\s*(?:\[\s*)?['"`]([A-Z][A-Za-z]+)['"`]/g
const CALL_RE = /\$\.([a-z]+)\.([a-zA-Z]+)/g
const IMPORTS_RE = /from\s+['"]claude-code(?:\/[a-z]+)?['"]/
const REGISTER_RE = /export\s+(async\s+)?function\s+register\b|export\s+(const|let|var)\s+register\b|export\s*\{[^}]*\bregister\b|exports\.register\b|export\s+default\b/

export function extractEvents(source) {
  return [...new Set([...source.matchAll(EVENT_RE)].map(m => m[1]))].sort()
}

export function extractComponents(source) {
  return [...new Set([...source.matchAll(COMPONENT_RE)].map(m => m[1]))].sort()
}

/** `$` calls as `noun.method` (without the `$.`), sorted and unique. */
export function extractCalls(source) {
  return [...new Set([...source.matchAll(CALL_RE)].map(m => `${m[1]}.${m[2]}`))].sort()
}

export function inspectModule(source) {
  return {
    events: extractEvents(source),
    components: extractComponents(source),
    calls: extractCalls(source),
    importsClaudeCode: IMPORTS_RE.test(source),
    hasRegister: REGISTER_RE.test(source),
  }
}

/** The JS/TS module paths a hooks.json lists, or null when it lists none. */
export function modulesOf(hooksText) {
  let parsed
  try {
    parsed = JSON.parse(hooksText)
  } catch {
    const loose = hooksText.match(/"modules"\s*:\s*\[([^\]]*)\]/)
    parsed = loose ? { modules: [...loose[1].matchAll(/"([^"]+)"/g)].map(m => m[1]) } : null
  }
  const list = parsed && typeof parsed === 'object' && Array.isArray(parsed.modules) ? parsed.modules : null
  if (list === null) return null
  const paths = list
    .map(m => (typeof m === 'string' ? m : (m && (m.path ?? m.module ?? m.src)) || ''))
    .filter(m => /\.(m?[jt]sx?|c[jt]s|mts|cts)$/.test(m))
  return paths.length > 0 ? paths : null
}

/** POSIX join + normalise, never escaping the repo root. */
export function joinPath(base, relative) {
  const parts = []
  for (const part of `${base}/${relative}`.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return parts.join('/')
}

export function dirname(path) {
  const at = path.lastIndexOf('/')
  return at < 0 ? '' : path.slice(0, at)
}

/** The mod's folder for a hooks.json path: `x/hooks/hooks.json` → `x`, root → `.`. */
export function modDir(hooksPath) {
  if (hooksPath === 'hooks/hooks.json' || hooksPath === 'hooks.json') return '.'
  if (hooksPath.endsWith('/hooks/hooks.json')) return hooksPath.slice(0, -'/hooks/hooks.json'.length)
  return dirname(hooksPath) || '.'
}

// ── Copies, fixtures, templates ────────────────────────────────────────────

/**
 * A short fingerprint of a module's opening 1,500 characters with comments and
 * whitespace dropped, so a copy with re-indentation or new comments still matches.
 */
export function sourceHash(source) {
  const head = source.slice(0, 1500)
  const normal = head
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
    .replace(/\s+/g, '')
  return createHash('sha1').update(normal).digest('hex').slice(0, 12)
}

const FIXTURE_DIR = /(^|\/)(tests?|__tests__|__fixtures__|fixtures?|spec|e2e|probes?|spikes?|evidence|investigation|evals?|examples?-tests?)(\/|$)/i
const TEMPLATE_DIR = /(^|\/)(templates?|scaffold|starter|skeleton|boilerplate)(\/|$)/i
const MIRROR_DIR = /(^|\/)(upstream|upstream-reference|vendor|third_party|mirrors?|node_modules|\.cache)(\/|$)/i
const MIRROR_REPO = /claude-code-docs|system_prompts_leaks|docs-mirror|mirror|upstream|leak/i

// Repos that repackage other people's mods by the dozen.
const CATALOG_REPOS = new Set(['davila7/claude-code-templates'])

/** Verdicts that never change, so a hit with one is never judged again. */
export const STICKY_VERDICTS = new Set(['copy', 'catalog', 'mirror', 'template', 'fixture'])

/** What a found mod is, from where it lives: mod, official, builtin, catalog, fixture, template or mirror. */
export function kindOf(repo, dir, name = '') {
  if (repo === 'anthropics/claude-code') return 'builtin'
  if (repo.startsWith('anthropics/')) return 'official'
  if (CATALOG_REPOS.has(repo)) return 'catalog'
  if (FIXTURE_DIR.test(dir) || /\b(test|probe|fixture|spike)\b/i.test(name)) return 'fixture'
  if (TEMPLATE_DIR.test(dir)) return 'template'
  if (MIRROR_DIR.test(dir) || MIRROR_REPO.test(repo.split('/')[1] ?? '')) return 'mirror'
  return 'mod'
}

const normalDescription = text => (text ?? '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 200)

/**
 * Copies of another repo's mod. Two mods are one when they share a source
 * fingerprint and either the name or the description, or when they share both
 * the name and the description (a copy that was then edited). The original is
 * Anthropic's, else one already indexed (`incumbents`), else the one in the
 * oldest repo (more stars breaks a tie).
 * Returns the keys of the copies. A shared fingerprint alone isn't enough: two
 * different mods can open with the same few lines of boilerplate.
 */
export function findCopies(entries, incumbents = new Set()) {
  const parent = new Map(entries.map(e => [keyOf(e), keyOf(e)]))
  const find = k => (parent.get(k) === k ? k : find(parent.get(k)))
  const union = (a, b) => parent.set(find(a), find(b))

  const byHash = new Map()
  const byNameAndText = new Map()
  for (const e of entries) {
    if (e.hash) byHash.set(e.hash, [...(byHash.get(e.hash) ?? []), e])
    const text = normalDescription(e.description)
    if (text !== '') {
      const group = `${(e.name ?? '').toLowerCase()}\n${text}`
      byNameAndText.set(group, [...(byNameAndText.get(group) ?? []), e])
    }
  }
  for (const list of byHash.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const [a, b] = [list[i], list[j]]
        const sameName = (a.name ?? '').toLowerCase() === (b.name ?? '').toLowerCase()
        const sameText = normalDescription(a.description) !== '' && normalDescription(a.description) === normalDescription(b.description)
        if (sameName || sameText) union(keyOf(a), keyOf(b))
      }
    }
  }
  for (const list of byNameAndText.values()) for (const e of list.slice(1)) union(keyOf(list[0]), keyOf(e))

  const groups = new Map()
  for (const e of entries) groups.set(find(keyOf(e)), [...(groups.get(find(keyOf(e))) ?? []), e])
  const copies = new Set()
  for (const list of groups.values()) {
    if (new Set(list.map(e => e.repo)).size < 2) continue
    const sorted = [...list].sort(
      (a, b) =>
        Number(b.repo.startsWith('anthropics/')) - Number(a.repo.startsWith('anthropics/')) ||
        Number(incumbents.has(keyOf(b))) - Number(incumbents.has(keyOf(a))) ||
        (a.createdAt ?? '9999').localeCompare(b.createdAt ?? '9999') ||
        (b.stars ?? 0) - (a.stars ?? 0) ||
        keyOf(a).localeCompare(keyOf(b)),
    )
    const original = sorted[0]
    for (const e of list) if (e.repo !== original.repo) copies.add(keyOf(e))
  }
  return copies
}

export const keyOf = entry => `${entry.repo}:${entry.path}`

// ── Records ────────────────────────────────────────────────────────────────

/** Collapses whitespace and cuts at a word boundary, adding an ellipsis. */
export function tidyDescription(text, max = 240) {
  const flat = (text ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  const cut = flat.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.\-–—]+$/, '')}…`
}

export const dateOf = iso => (iso ? String(iso).slice(0, 10) : null)

/** The first-seen date for an entry carried over from the 2026-10-04 seed. */
export function seedFirstSeen(createdAt) {
  const created = dateOf(createdAt)
  return created !== null && created > INDEX_EPOCH ? created : INDEX_EPOCH
}

/** Which of Claude Code's surfaces a mod draws on. */
export function uiOf({ components = [], calls = [] }) {
  const ui = []
  if (components.includes('Pane') || calls.includes('ui.open')) ui.push('pane')
  if (components.includes('AbovePrompt')) ui.push('band')
  if (calls.includes('ui.status')) ui.push('status')
  if (components.some(c => RESTYLE_COMPONENTS.has(c) || c === 'PromptHint')) ui.push('restyle')
  return ui
}

/** A record in the order data/mods.json keeps its fields. */
export function record(fields) {
  const r = {
    name: fields.name,
    repo: fields.repo,
    path: fields.path,
    url: fields.url,
    description: tidyDescription(fields.description),
    stars: fields.stars ?? 0,
    license: fields.license ?? null,
    pushedAt: dateOf(fields.pushedAt),
    createdAt: dateOf(fields.createdAt),
    events: [...(fields.events ?? [])].sort(),
    components: [...(fields.components ?? [])].sort(),
    calls: [...(fields.calls ?? [])].map(c => c.replace(/^\$\./, '')).sort(),
    marketplace: Boolean(fields.marketplace),
    category: fields.category,
    firstSeen: fields.firstSeen,
    module: fields.module ?? null,
    hash: fields.hash ?? null,
  }
  if (!isCategory(r.category)) r.category = categorize(r)
  return r
}

export function sortRecords(records) {
  return [...records].sort(
    (a, b) => (b.stars ?? 0) - (a.stars ?? 0) || a.repo.localeCompare(b.repo) || a.path.localeCompare(b.path),
  )
}

/** One record per line: small diffs, still valid JSON. */
export function serializeRecords(records) {
  return `[\n${records.map(r => JSON.stringify(r)).join(',\n')}\n]\n`
}

const isLicensed = license => license !== null && license !== undefined && license !== 'NOASSERTION' && license !== 'NONE'

export function daysBetween(fromDate, toDate) {
  return Math.round((Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / 86_400_000)
}

export function isNew(entry, today, days = 7) {
  return entry.firstSeen !== null && daysBetween(entry.firstSeen, today) < days
}

export function buildStats(records, today) {
  const byCategory = Object.fromEntries(CATEGORIES.map(c => [c.id, 0]))
  for (const r of records) byCategory[r.category] = (byCategory[r.category] ?? 0) + 1
  return {
    updated: today,
    mods: records.length,
    repos: new Set(records.map(r => r.repo)).size,
    withUi: records.filter(r => uiOf(r).length > 0).length,
    licensed: records.filter(r => isLicensed(r.license)).length,
    byCategory,
    newThisWeek: records.filter(r => isNew(r, today)).length,
  }
}

// ── Markdown ───────────────────────────────────────────────────────────────

/** Text safe inside a GitHub markdown table cell: no pipes, tags or newlines. */
export function escapeCell(text) {
  return String(text ?? '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/`/g, '\\`')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/^([#>*+-]|\d+\.)\s/, '\\$1 ')
    .trim()
}

/** A link label: escaped like a cell. */
export const escapeLabel = escapeCell

/** URLs from GitHub are safe, but a `)` or space would end the link early. */
export function escapeUrl(url) {
  return String(url).replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29')
}

export function formatStars(n) {
  if (n >= 10_000) return `${Math.round(n / 1000)}k`
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
  return String(n)
}

const UI_ICONS = { pane: '🪟', band: '🎚️', status: '📟', restyle: '🎨' }

export function uiIcons(entry) {
  return uiOf(entry).map(u => UI_ICONS[u]).join(' ')
}

export const UI_LEGEND = '🪟 pane · 🎚️ band above the prompt · 📟 status line · 🎨 restyles part of Claude Code'
