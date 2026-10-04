// Counting and summing a Claude Code life: no `$`, so tests import it directly.

import type { Persona, Summary } from '../types'

/**
 * One session's counters, kept under `s:<session id>` in the store. Only that
 * session writes its key, so parallel sessions never race; old sessions are
 * folded into one record per year (`y:<year>`).
 */
export type Tally = {
  v: 1
  firstAt: number
  lastAt: number
  sessions: number
  prompts: number
  turns: number
  turnMs: number
  longestTurnMs: number
  tools: Record<string, number>
  failed: number
  /** Short hashes of the files edited, never the paths themselves. */
  files: string[]
  lines: number
  commits: number
  /** Prompts per local hour of day, 0 to 23. */
  hours: number[]
  /** Turns per local day, `YYYY-MM-DD`. */
  days: Record<string, number>
  /** Turns per project folder name. */
  projects: Record<string, number>
  /** US dollars, as the session's cost ledger counts them. */
  cost: number
  /** The ledger's last reading, so a reload never counts the same dollars twice. */
  costSeen: number
}

// Unique-file hashes kept: per session, and per folded year.
const MAX_FILES = 500
const MAX_YEAR_FILES = 20_000

export function emptyTally(now: number): Tally {
  return {
    v: 1,
    firstAt: now,
    lastAt: now,
    sessions: 0,
    prompts: 0,
    turns: 0,
    turnMs: 0,
    longestTurnMs: 0,
    tools: {},
    failed: 0,
    files: [],
    lines: 0,
    commits: 0,
    hours: Array.from({ length: 24 }, () => 0),
    days: {},
    projects: {},
    cost: 0,
    costSeen: 0,
  }
}

function addCounts(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  const out = { ...a }
  for (const [key, n] of Object.entries(b)) out[key] = (out[key] ?? 0) + n
  return out
}

/** Reads a stored value as a Tally, filling what an older or damaged record lacks. */
export function asTally(value: unknown, now: number): Tally {
  const base = emptyTally(now)
  if (typeof value !== 'object' || value === null) return base
  const t = { ...base, ...(value as Partial<Tally>) }
  t.hours = Array.from({ length: 24 }, (_, i) => Number(t.hours?.[i] ?? 0))
  t.files = Array.isArray(t.files) ? t.files : []
  return t
}

/** Adds two tallies: counts summed, records kept, unique files unioned. */
export function merge(a: Tally, b: Tally): Tally {
  const files = new Set(a.files)
  for (const f of b.files) {
    if (files.size >= MAX_YEAR_FILES) break
    files.add(f)
  }
  return {
    v: 1,
    firstAt: Math.min(a.firstAt, b.firstAt),
    lastAt: Math.max(a.lastAt, b.lastAt),
    sessions: a.sessions + b.sessions,
    prompts: a.prompts + b.prompts,
    turns: a.turns + b.turns,
    turnMs: a.turnMs + b.turnMs,
    longestTurnMs: Math.max(a.longestTurnMs, b.longestTurnMs),
    tools: addCounts(a.tools, b.tools),
    failed: a.failed + b.failed,
    files: [...files],
    lines: a.lines + b.lines,
    commits: a.commits + b.commits,
    hours: a.hours.map((n, i) => n + (b.hours[i] ?? 0)),
    days: addCounts(a.days, b.days),
    projects: addCounts(a.projects, b.projects),
    cost: a.cost + b.cost,
    costSeen: 0,
  }
}

/** Adds a session's fresh counts to its stored record. */
export function absorb(stored: Tally, fresh: Tally): Tally {
  const merged = merge(stored, fresh)
  merged.files = merged.files.slice(0, MAX_FILES)
  merged.sessions = 1
  merged.costSeen = stored.costSeen
  return merged
}

/** The dollars a ledger reading adds: the rise since the last one, or all of it after a reset. */
export function costDelta(seen: number, reading: number): number {
  return reading >= seen ? reading - seen : reading
}

const pad = (n: number) => String(n).padStart(2, '0')

export function dayKey(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function hourOf(ms: number): number {
  return new Date(ms).getHours()
}

export function yearOf(ms: number): string {
  return String(new Date(ms).getFullYear())
}

/** FNV-1a, 32 bits: enough to count unique files without keeping their paths. */
export function hashPath(path: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < path.length; i++) {
    h ^= path.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(36)
}

export function lineCount(text: string): number {
  if (text === '') return 0
  return text.split('\n').length - (text.endsWith('\n') ? 1 : 0)
}

export function isCommit(command: string, output: string, isError: boolean): boolean {
  if (isError) return false
  if (!/\bgit\b(\s+-[Cc]\s+\S+)*\s+commit\b/.test(command) || /--dry-run/.test(command)) return false
  return !/nothing to commit|no changes added to commit/i.test(output)
}

/** Current and longest runs of consecutive active days; today may still be ahead. */
export function streaks(days: readonly string[], today: string): { current: number; longest: number } {
  const toNum = (key: string) => Math.round(Date.UTC(+key.slice(0, 4), +key.slice(5, 7) - 1, +key.slice(8, 10)) / 86_400_000)
  const set = new Set(days.map(toNum))
  const sorted = [...set].sort((a, b) => a - b)
  let longest = 0
  let run = 0
  let prev = Number.NaN
  for (const n of sorted) {
    run = n === prev + 1 ? run + 1 : 1
    longest = Math.max(longest, run)
    prev = n
  }
  let cursor = toNum(today)
  if (!set.has(cursor)) cursor -= 1
  let current = 0
  while (set.has(cursor)) {
    current++
    cursor--
  }
  return { current, longest }
}

export function personaOf(t: Tally): Persona {
  const calls = Object.values(t.tools).reduce((a, b) => a + b, 0)
  const share = (...names: string[]) => (calls === 0 ? 0 : names.reduce((a, n) => a + (t.tools[n] ?? 0), 0) / calls)
  const busiest = busiestHour(t)
  const hasHours = t.hours.some(n => n > 0)

  if (hasHours && t.prompts >= 5 && (busiest >= 22 || busiest < 4)) {
    return { emoji: '🦉', title: 'The Night Owl', blurb: `Your best ideas show up after dark. Peak hour: ${hourLabel(busiest)}.` }
  }
  if (hasHours && t.prompts >= 5 && busiest >= 5 && busiest <= 7) {
    return { emoji: '🐦', title: 'The Early Bird', blurb: `Shipping before the coffee kicks in. Peak hour: ${hourLabel(busiest)}.` }
  }
  if (t.longestTurnMs > 15 * 60_000) {
    return { emoji: '🏃', title: 'The Marathoner', blurb: `You hand Claude the big jobs. Longest turn: ${duration(t.longestTurnMs)}.` }
  }
  if (calls >= 20 && share('Bash') >= 0.4) {
    return { emoji: '🧙', title: 'The Shell Wizard', blurb: 'The terminal is your wand. Most of your calls are Bash.' }
  }
  if (calls >= 20 && share('Edit', 'MultiEdit', 'Write', 'NotebookEdit') >= 0.35) {
    return { emoji: '🔧', title: 'The Refactorer', blurb: 'No file is ever finished. You edit relentlessly.' }
  }
  if (calls >= 20 && share('Read', 'Grep', 'Glob') >= 0.5) {
    return { emoji: '📚', title: 'The Reader', blurb: 'You understand before you change. Reading leads every session.' }
  }
  if (calls >= 20 && share('Agent', 'Task') >= 0.1) {
    return { emoji: '🎼', title: 'The Conductor', blurb: 'Why do it yourself? You run an orchestra of subagents.' }
  }
  if (calls >= 20 && share('WebFetch', 'WebSearch') >= 0.15) {
    return { emoji: '🌊', title: 'The Researcher', blurb: 'Half the internet has passed through your sessions.' }
  }
  if (t.commits >= 25) {
    return { emoji: '🚢', title: 'The Shipper', blurb: `Talk is cheap: ${t.commits} commits and counting.` }
  }
  return { emoji: '✨', title: 'The Collaborator', blurb: 'A little of everything, with Claude at your side.' }
}

export function busiestHour(t: Tally): number {
  let best = 0
  t.hours.forEach((n, i) => {
    if (n > (t.hours[best] ?? 0)) best = i
  })
  return best
}

export function hourLabel(hour: number): string {
  const h = hour % 12 === 0 ? 12 : hour % 12
  return `${h}${hour < 12 ? 'am' : 'pm'}`
}

export function duration(ms: number): string {
  if (ms < 59_500) return `${Math.round(ms / 1000)}s`
  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return `${minutes}m`
  const hours = minutes / 60
  return hours < 10 ? `${hours.toFixed(1).replace(/\.0$/, '')}h` : `${Math.round(hours)}h`
}

export function num(n: number): string {
  return Math.round(n).toLocaleString('en-US')
}

/** `1 commit`, `2 commits`, `1 line written`: the count, then the noun it takes. */
export function count(n: number, one: string, many: string): string {
  return `${num(n)} ${Math.round(n) === 1 ? one : many}`
}

function top(counts: Record<string, number>, n: number): { name: string; count: number }[] {
  return Object.entries(counts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, n)
}

/** Everything the card shows, worked out once. */
export function summarize(t: Tally, label: string, today: string): Summary {
  const calls = Object.values(t.tools).reduce((a, b) => a + b, 0)
  const days = Object.keys(t.days)
  return {
    label,
    isEmpty: t.turns === 0 && t.prompts === 0 && calls === 0,
    prompts: t.prompts,
    sessions: t.sessions,
    turns: t.turns,
    turnMs: t.turnMs,
    toolCalls: calls,
    failed: t.failed,
    files: t.files.length,
    lines: t.lines,
    commits: t.commits,
    cost: t.cost,
    activeDays: days.length,
    streak: streaks(days, today),
    topTools: top(t.tools, 5),
    topProject: top(t.projects, 1)[0]?.name ?? '',
    busiestHour: t.hours.some(n => n > 0) ? busiestHour(t) : -1,
    longestTurnMs: t.longestTurnMs,
    firstSeen: t.firstAt,
    persona: personaOf(t),
  }
}

const PARTIALS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉']

/** A bar of `width` cells for `value` out of `max`, smooth to an eighth of a cell. */
export function bar(value: number, max: number, width: number): string {
  if (max <= 0 || width <= 0) return ''
  const eighths = Math.round((value / max) * width * 8)
  return '█'.repeat(Math.floor(eighths / 8)) + PARTIALS[eighths % 8]
}

export const SHARE_FOOTER = 'made with wrapped · github.com/Singh-AP/awesome-claude-mods'

export function shareCard(s: Summary, withCost: boolean): string {
  const lines = [
    `✦ My ${s.label} ✦`,
    `${s.persona.emoji} ${s.persona.title}`,
    `${count(s.prompts, 'prompt', 'prompts')} · ${count(s.sessions, 'session', 'sessions')} · ${duration(s.turnMs)} with Claude`,
    `${count(s.toolCalls, 'tool call', 'tool calls')} · ${count(s.lines, 'line written', 'lines written')} · ${count(s.commits, 'commit', 'commits')}`,
  ]
  if (s.topTools.length > 0) lines.push(`Top tools: ${s.topTools.slice(0, 3).map(t => t.name).join(' · ')}`)
  if (s.streak.longest > 1) lines.push(`🔥 Longest streak: ${s.streak.longest} days`)
  if (withCost && s.cost > 0) lines.push(`💸 $${s.cost.toFixed(2)} of tokens`)
  lines.push(SHARE_FOOTER)
  return lines.join('\n')
}
