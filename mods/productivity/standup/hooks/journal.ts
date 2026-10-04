// The journal's shape and the text made from it. Pure: no `$`.

export type Entry = {
  /** When the turn ended, ms since the epoch. */
  at: number
  project: string
  prompt: string
  files: string[]
  commits: string[]
  durationMs: number
}

export const DAY_PREFIX = 'day:'
export const KEEP_DAYS = 14
export const MAX_ENTRIES_PER_DAY = 80
const MAX_FILES = 15
const MAX_COMMITS = 5

const pad = (n: number) => String(n).padStart(2, '0')

/** The local calendar day of `ms`, `YYYY-MM-DD`. */
export function dayOf(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Local `HH:MM` of `ms`. */
export function timeOf(ms: number): string {
  const d = new Date(ms)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** One line, whitespace collapsed, cut at `max` with an ellipsis. */
export function clip(text: string, max: number): string {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length <= max ? line : `${line.slice(0, max - 1).trimEnd()}…`
}

/** `path` relative to `root` when it lies inside it. */
export function relativeTo(path: string, root: string): string {
  const base = root.replace(/[\\/]+$/, '')
  if (base !== '' && (path.startsWith(`${base}/`) || path.startsWith(`${base}\\`))) return path.slice(base.length + 1)
  return path
}

/** The last path segment. */
export function baseName(path: string): string {
  return path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? ''
}

/** Whether a Bash command line makes a git commit. */
export function isGitCommit(command: string): boolean {
  return /(^|[;&|(]\s*|\s)git\s+(?:-[Cc]\s+\S+\s+)*commit\b/.test(command)
}

/**
 * The subject of the commit a Bash call made: from git's own output
 * (`[main 1a2b3c4] Subject`) when it has it, else from `-m` in the command,
 * heredoc messages included.
 */
export function commitSubject(command: string, output: string): string | undefined {
  const fromGit = /^\[[^\]\n]*\b[0-9a-f]{7,40}\]\s+(.+)$/m.exec(output)
  if (fromGit?.[1] !== undefined) return clip(fromGit[1], 100)

  const heredoc = /<<-?\s*['"]?(\w+)['"]?\s*\n([\s\S]*?)\n\s*\1\b/.exec(command)
  if (heredoc?.[2] !== undefined) {
    const first = heredoc[2].split('\n').map(l => l.trim()).find(l => l !== '')
    if (first !== undefined) return clip(first, 100)
  }
  const flag = /(?:^|\s)(?:-m|--message)(?:=|\s+)(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+))/.exec(command)
  const message = flag?.[1] ?? flag?.[2] ?? flag?.[3]
  if (message !== undefined && !message.startsWith('$(')) {
    const first = message.replace(/\\n/g, '\n').split('\n')[0] ?? ''
    if (first.trim() !== '') return clip(first, 100)
  }
  return undefined
}

/** An entry with every field held to its size. */
export function trimEntry(entry: Entry): Entry {
  return {
    at: entry.at,
    project: clip(entry.project, 60),
    prompt: clip(entry.prompt, 160),
    files: [...new Set(entry.files)].slice(0, MAX_FILES).map(f => clip(f, 120)),
    commits: entry.commits.slice(0, MAX_COMMITS).map(c => clip(c, 100)),
    durationMs: Math.max(0, Math.round(entry.durationMs)),
  }
}

/** The day's entries with `entry` added, the oldest dropped past the cap. */
export function withEntry(entries: readonly Entry[], entry: Entry): Entry[] {
  return [...entries, trimEntry(entry)].slice(-MAX_ENTRIES_PER_DAY)
}

/** The day keys older than the newest `KEEP_DAYS` days ending on `today`. */
export function expiredKeys(keys: readonly string[], today: string): string[] {
  const days = keys.filter(k => k.startsWith(DAY_PREFIX)).map(k => k.slice(DAY_PREFIX.length))
  const cutoff = new Date(`${today}T12:00:00`)
  cutoff.setDate(cutoff.getDate() - (KEEP_DAYS - 1))
  const oldest = dayOf(cutoff.getTime())
  return days.filter(d => d < oldest).map(d => DAY_PREFIX + d)
}

/** The days with entries, newest first, as `YYYY-MM-DD`. */
export function journalDays(keys: readonly string[]): string[] {
  return keys
    .filter(k => k.startsWith(DAY_PREFIX))
    .map(k => k.slice(DAY_PREFIX.length))
    .sort()
    .reverse()
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** `Today`, `Yesterday`, or the weekday name for an older day. */
export function dayLabel(day: string, today: string): string {
  if (day === today) return 'Today'
  const before = new Date(`${today}T12:00:00`)
  before.setDate(before.getDate() - 1)
  if (day === dayOf(before.getTime())) return 'Yesterday'
  return WEEKDAYS[new Date(`${day}T12:00:00`).getDay()] ?? day
}

function minutes(ms: number): string {
  const m = Math.round(ms / 60000)
  return m < 1 ? '<1m' : `${m}m`
}

/** The journal as plain text, one block per day and project. */
export function journalText(days: readonly { day: string; entries: readonly Entry[] }[], today: string): string {
  const out: string[] = []
  for (const { day, entries } of days) {
    out.push(`${dayLabel(day, today)} (${day})`)
    const projects = [...new Set(entries.map(e => e.project))]
    for (const project of projects) {
      if (projects.length > 1 || project !== '') out.push(`  ${project === '' ? '(no project)' : project}`)
      for (const e of entries.filter(x => x.project === project)) {
        const parts = [`    ${timeOf(e.at)} (${minutes(e.durationMs)})`]
        parts.push(e.prompt === '' ? '(no prompt)' : `"${e.prompt}"`)
        if (e.files.length > 0) parts.push(`files: ${e.files.join(', ')}`)
        if (e.commits.length > 0) parts.push(`commits: ${e.commits.map(c => `"${c}"`).join(', ')}`)
        out.push(parts.join(' · '))
      }
    }
    out.push('')
  }
  return out.join('\n').trimEnd()
}

export const SYSTEM = [
  "You write a developer's daily standup from their Claude Code journal: one line per turn they ran, with",
  'the prompt they typed, the files changed and the commits made.',
  'Write one section per heading you are given, in that order: the heading alone on a line, then "- " bullets.',
  'A day heading covers that day of the journal; "Blockers" covers the whole journal.',
  'Rules: merge related turns into one bullet; say what was achieved, in past tense, not what was asked;',
  'name commits when there are some; prefix a bullet with the project in brackets when there are several',
  'projects; at most 6 bullets per section; never invent work that is not in the journal. Under Blockers,',
  'list only something left unresolved in the journal (repeated attempts at one problem, failing tests, an',
  'interrupted turn), else "- None noted.". No preamble, no closing line, no bold, no other headings.',
].join('\n')

/** The prompt for the standup model call: the journal, then the headings to write. */
export function standupPrompt(journal: string, headings: readonly string[]): string {
  return `Journal:\n\n${journal}\n\nHeadings: ${headings.join(', ')}\n\nWrite the standup.`
}
