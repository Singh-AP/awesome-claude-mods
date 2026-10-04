// Pure helpers for spotting what a Bash command changed, from `git` output
// taken before and after it. No `$`: register.tsx runs git and hands the text here.

/** How many changed paths a snapshot watches; the rest of a huge dirty tree is ignored. */
export const MAX_PATHS = 200

export type StatusEntry = {
  /** Index and work-tree codes from porcelain v2 (`.` for unchanged). */
  x: string
  y: string
  untracked: boolean
}

export type Status = {
  /** HEAD's commit, or null before the first commit. */
  head: string | null
  entries: Map<string, StatusEntry>
}

export type Entry = {
  /** Content identity: the work-tree blob's hash, or a status stand-in when git couldn't hash it. */
  hash: string
  untracked: boolean
  deleted: boolean
  /** Staged, with the work tree matching the index (`M.`, `A.`). */
  isIndexOnly: boolean
  /** Lines added and removed against HEAD (tracked files). */
  added: number
  removed: number
}

/** The dirty part of a work tree at one moment. */
export type Snapshot = {
  head: string | null
  entries: Map<string, Entry>
}

/** Paths git reports that a ledger of the person's files should never list. */
export function isIgnoredPath(path: string): boolean {
  return /(^|\/)node_modules\//.test(path) || /(^|\/)\.git\//.test(path) || path.includes('\n')
}

/** Reads `git status --porcelain=v2 -z --branch --untracked-files=all`. */
export function parseStatus(stdout: string): Status {
  const tokens = stdout.split('\0')
  const entries = new Map<string, StatusEntry>()
  let head: string | null = null

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] ?? ''
    if (token === '') continue
    if (token.startsWith('# branch.oid ')) {
      const oid = token.slice('# branch.oid '.length).trim()
      head = /^[0-9a-f]{7,64}$/.test(oid) ? oid : null
      continue
    }
    if (token.startsWith('#')) continue
    const kind = token[0]
    if (kind === '?') {
      const path = token.slice(2)
      if (!isIgnoredPath(path)) entries.set(path, { x: '?', y: '?', untracked: true })
      continue
    }
    // `1 XY sub mH mI mW hH hI path`, `2 XY sub mH mI mW hH hI Xscore path\0orig`, `u XY sub m1 m2 m3 mW h1 h2 h3 path`
    const fieldsBeforePath = kind === '1' ? 8 : kind === '2' ? 9 : kind === 'u' ? 10 : -1
    if (fieldsBeforePath < 0) continue
    const parts = token.split(' ')
    const xy = parts[1] ?? '..'
    const path = parts.slice(fieldsBeforePath).join(' ')
    if (kind === '2') i++ // the next token is the rename's original path
    if (path !== '' && !isIgnoredPath(path)) entries.set(path, { x: xy[0] ?? '.', y: xy[1] ?? '.', untracked: false })
  }

  return { head, entries }
}

/** Reads `git diff --numstat -z`: lines added and removed per path; binary files count 0. */
export function parseNumstat(stdout: string): Map<string, { added: number; removed: number }> {
  const out = new Map<string, { added: number; removed: number }>()
  const tokens = stdout.split('\0')
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] ?? ''
    const match = token.match(/^(-|\d+)\t(-|\d+)\t(.*)$/s)
    if (match === null) continue
    const added = match[1] === '-' ? 0 : Number(match[1])
    const removed = match[2] === '-' ? 0 : Number(match[2])
    let path = match[3] ?? ''
    // A rename is `added\tremoved\t\0from\0to`.
    if (path === '') {
      path = tokens[i + 2] ?? ''
      i += 2
    }
    if (path !== '') out.set(path, { added, removed })
  }
  return out
}

/** Pairs `git hash-object --stdin-paths` output with the paths it was given; undefined when they don't line up. */
export function parseHashes(paths: readonly string[], stdout: string): Map<string, string> | undefined {
  const hashes = stdout.split('\n').map(line => line.trim()).filter(line => line !== '')
  if (hashes.length !== paths.length || hashes.some(h => !/^[0-9a-f]{40,64}$/.test(h))) return undefined
  return new Map(paths.map((path, i) => [path, hashes[i]!]))
}

/** The paths of a status that exist on disk and can be hashed, in a stable order, capped. */
export function hashablePaths(status: Status): string[] {
  return [...status.entries.entries()]
    .filter(([, entry]) => entry.y !== 'D' && !(entry.x === 'D' && entry.y === '.'))
    .map(([path]) => path)
    .sort()
    .slice(0, MAX_PATHS)
}

/** One snapshot from a status, the work-tree hashes and the numstat against HEAD. */
export function buildSnapshot(
  status: Status,
  hashes: ReadonlyMap<string, string> | undefined,
  numstat: ReadonlyMap<string, { added: number; removed: number }>,
): Snapshot {
  const entries = new Map<string, Entry>()
  const watched = [...status.entries.keys()].sort().slice(0, MAX_PATHS)
  for (const path of watched) {
    const entry = status.entries.get(path)!
    const deleted = entry.y === 'D' || (entry.x === 'D' && entry.y === '.')
    const lines = numstat.get(path) ?? { added: 0, removed: 0 }
    entries.set(path, {
      hash: deleted ? 'deleted' : (hashes?.get(path) ?? `status:${entry.x}${entry.y}`),
      untracked: entry.untracked,
      deleted,
      isIndexOnly: !entry.untracked && !deleted && entry.y === '.',
      added: lines.added,
      removed: lines.removed,
    })
  }
  return { head: status.head, entries }
}

export type Difference = {
  path: string
  /** `new`: dirty now, clean before. `changed`: dirty both times, different content. `cleaned`: dirty before, clean or gone now. */
  kind: 'new' | 'changed' | 'cleaned'
}

/**
 * Which watched paths a command may have changed. A path that only got
 * staged while HEAD moved (a `git reset --soft`) is left out, and a path that
 * went clean needs one more look, which `cleaned` asks for.
 */
export function compareSnapshots(before: Snapshot, after: Snapshot): Difference[] {
  const isHeadMoved = before.head !== after.head
  const out: Difference[] = []
  for (const [path, now] of after.entries) {
    const then = before.entries.get(path)
    if (then === undefined) {
      if (!(isHeadMoved && now.isIndexOnly)) out.push({ path, kind: 'new' })
    } else if (then.hash !== now.hash || then.deleted !== now.deleted) {
      out.push({ path, kind: 'changed' })
    }
  }
  for (const path of before.entries.keys()) {
    if (!after.entries.has(path)) out.push({ path, kind: 'cleaned' })
  }
  return out.slice(0, MAX_PATHS)
}

/** What a command added and removed, from the lines against a base before and after it. */
export function lineDelta(
  before: { added: number; removed: number } | undefined,
  after: { added: number; removed: number },
): { added: number; removed: number } {
  const then = before ?? { added: 0, removed: 0 }
  return { added: Math.max(0, after.added - then.added), removed: Math.max(0, after.removed - then.removed) }
}

export function countLines(text: string): number {
  if (text === '') return 0
  const lines = text.split('\n')
  return lines.at(-1) === '' ? lines.length - 1 : lines.length
}

/** A repo path as the ledger shows it: relative to the session root when the root is a subfolder of the repo. */
export function shownPath(path: string, top: string, prefix: string): string {
  if (prefix === '') return path
  return path.startsWith(prefix) ? path.slice(prefix.length) : `${top.replace(/\/+$/, '')}/${path}`
}

/** Reads `git rev-parse --show-toplevel --show-prefix`. */
export function parseRepo(stdout: string): { top: string; prefix: string } | null {
  const [top = '', prefix = ''] = stdout.replace(/\r/g, '').split('\n')
  return top.trim() === '' ? null : { top: top.trim(), prefix: prefix.trim() }
}
