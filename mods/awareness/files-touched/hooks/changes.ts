// Pure helpers: no `$`, so the tests and other mods can import them.

import type { TouchedFile } from '../types'

export type Change = {
  /** As the tool named it: absolute in this build. */
  path: string
  added: number
  removed: number
  created: boolean
  /** A Bash command made the change, rather than a file tool. */
  bash?: boolean
  deleted?: boolean
}

type Hunk = { lines?: unknown }

export const TRACKED = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit'])

function linesOf(text: string): string[] {
  if (text === '') return []
  const lines = text.split('\n')
  if (lines.at(-1) === '') lines.pop()
  return lines
}

/** Counts `+` and `-` lines over a structured patch's hunks. */
export function countPatch(hunks: readonly Hunk[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const hunk of hunks) {
    if (!Array.isArray(hunk.lines)) continue
    for (const line of hunk.lines) {
      if (typeof line !== 'string') continue
      if (line.startsWith('+') && !line.startsWith('+++')) added++
      else if (line.startsWith('-') && !line.startsWith('---')) removed++
    }
  }
  return { added, removed }
}

/** Lines added and removed going from `before` to `after`, common lines at both ends left out. */
export function countStrings(before: string, after: string): { added: number; removed: number } {
  const a = linesOf(before)
  const b = linesOf(after)
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let end = 0
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++
  return { added: b.length - start - end, removed: a.length - start - end }
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function hunks(result: Record<string, unknown>): Hunk[] | undefined {
  const patch = result.structuredPatch
  return Array.isArray(patch) && patch.length > 0 ? (patch as Hunk[]) : undefined
}

/**
 * What one successful file tool call changed, read from its input and the
 * tool's result; undefined for a call that changed nothing on disk.
 */
export function changeOf(tool: string, input: Readonly<Record<string, unknown>>, rawResult: unknown): Change | undefined {
  const result = record(rawResult)
  if (result.staged === true) return undefined
  const str = (value: unknown) => (typeof value === 'string' ? value : '')

  switch (tool) {
    case 'Edit': {
      const path = str(input.file_path)
      if (path === '') return undefined
      const patch = hunks(result)
      const counts = patch === undefined ? countStrings(str(input.old_string), str(input.new_string)) : countPatch(patch)
      return { path, ...counts, created: false }
    }
    case 'MultiEdit': {
      const path = str(input.file_path)
      if (path === '') return undefined
      const patch = hunks(result)
      if (patch !== undefined) return { path, ...countPatch(patch), created: false }
      const edits: Record<string, unknown>[] = Array.isArray(input.edits) ? input.edits.map(record) : []
      const counts = edits.reduce<{ added: number; removed: number }>(
        (sum, one) => {
          const c = countStrings(str(one.old_string), str(one.new_string))
          return { added: sum.added + c.added, removed: sum.removed + c.removed }
        },
        { added: 0, removed: 0 },
      )
      return { path, ...counts, created: false }
    }
    case 'Write': {
      const path = str(input.file_path)
      if (path === '') return undefined
      const content = str(input.content)
      if (result.type === 'create') return { path, added: linesOf(content).length, removed: 0, created: true }
      const patch = hunks(result)
      if (patch !== undefined) return { path, ...countPatch(patch), created: false }
      if (typeof result.originalFile === 'string') return { path, ...countStrings(result.originalFile, content), created: false }
      return { path, added: linesOf(content).length, removed: 0, created: false }
    }
    case 'NotebookEdit': {
      const path = str(input.notebook_path)
      if (path === '') return undefined
      const lines = linesOf(str(input.new_source)).length
      return input.edit_mode === 'delete'
        ? { path, added: 0, removed: lines, created: false }
        : { path, added: lines, removed: 0, created: false }
    }
  }
  return undefined
}

/** `path` relative to `root` when it lies under it. */
export function relativeTo(path: string, root: string | undefined): string {
  if (root === undefined || root === '') return path
  const base = root.replace(/[\\/]+$/, '')
  if (path.startsWith(`${base}/`) || path.startsWith(`${base}\\`)) return path.slice(base.length + 1)
  return path
}

/** The list with one more change in it, the file moved to the front. */
export function merge(files: readonly TouchedFile[], change: Change & { path: string }, now: number): TouchedFile[] {
  const old = files.find(f => f.path === change.path)
  const base: TouchedFile = old === undefined
    ? { path: change.path, edits: 1, added: change.added, removed: change.removed, created: change.created, firstAt: now, lastAt: now }
    : { ...old, edits: old.edits + 1, added: old.added + change.added, removed: old.removed + change.removed, created: old.created || change.created, lastAt: now }
  const bash = (old?.bash ?? 0) + (change.bash === true ? 1 : 0)
  const next: TouchedFile = { ...base, deleted: change.deleted === true }
  if (bash > 0) next.bash = bash
  if (next.deleted !== true) delete next.deleted
  return [next, ...files.filter(f => f.path !== change.path)]
}

/** `created`, `modified` or `deleted`, with `(bash)` when Bash made every change and `(+bash)` when it made some. */
export function statusOf(file: TouchedFile): string {
  const what = file.deleted === true ? 'deleted' : file.created ? 'created' : 'modified'
  const bash = file.bash ?? 0
  if (bash === 0) return what
  return bash >= file.edits ? `${what} (bash)` : `${what} (+bash)`
}

/** Most recently touched first. */
export function byRecent(files: readonly TouchedFile[]): TouchedFile[] {
  return [...files].sort((a, b) => b.lastAt - a.lastAt)
}

/** Each file's basename, or more of its path where two basenames clash. */
export function displayNames(files: readonly TouchedFile[]): Map<string, string> {
  const names = new Map<string, string>()
  const segments = files.map(f => f.path.split(/[\\/]/).filter(s => s !== ''))
  for (let i = 0; i < files.length; i++) {
    const mine = segments[i] ?? []
    let depth = 1
    while (depth < mine.length) {
      const suffix = mine.slice(-depth).join('/')
      const clash = segments.some((other, j) => j !== i && other.slice(-depth).join('/') === suffix)
      if (!clash) break
      depth++
    }
    names.set(files[i]!.path, mine.slice(-depth).join('/') || files[i]!.path)
  }
  return names
}

export function delta(file: Pick<TouchedFile, 'added' | 'removed'>): string {
  const parts: string[] = []
  if (file.added > 0 || file.removed === 0) parts.push(`+${file.added}`)
  if (file.removed > 0) parts.push(`−${file.removed}`)
  return parts.join(' ')
}

export function totals(files: readonly TouchedFile[]): { added: number; removed: number; edits: number } {
  return files.reduce((t, f) => ({ added: t.added + f.added, removed: t.removed + f.removed, edits: t.edits + f.edits }), { added: 0, removed: 0, edits: 0 })
}

/** `✎ 4 files · register.ts +12 −3 · README.md +40 · +2 more`, at most `width` long. */
export function bandLine(files: readonly TouchedFile[], width: number): string {
  const recent = byRecent(files)
  const names = displayNames(recent)
  const head = `✎ ${recent.length} file${recent.length === 1 ? '' : 's'}`
  let line = head
  for (let i = 0; i < recent.length; i++) {
    const file = recent[i]!
    const piece = ` · ${names.get(file.path)} ${delta(file)}`
    const left = recent.length - i - 1
    const more = left > 0 ? ` · +${left} more` : ''
    if ((line + piece + more).length <= width) {
      line += piece
      continue
    }
    const rest = recent.length - i
    const tail = ` · +${rest} more`
    if ((line + tail).length <= width) line += tail
    break
  }
  return line.length <= width ? line : `${line.slice(0, Math.max(0, width - 1))}…`
}

function clock(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** The markdown `/touched` prints. */
export function tableText(files: readonly TouchedFile[]): string {
  if (files.length === 0) return 'No files changed yet this session.'
  const recent = byRecent(files)
  const sum = totals(recent)
  const rows = recent.map(f => `| \`${f.path}\` | ${statusOf(f)} | ${f.edits} | +${f.added} | −${f.removed} | ${clock(f.lastAt)} |`)
  return [
    `**${recent.length} file${recent.length === 1 ? '' : 's'} changed** · +${sum.added} −${sum.removed} · ${sum.edits} edit${sum.edits === 1 ? '' : 's'}`,
    '',
    '| File | Status | Edits | Added | Removed | Last |',
    '| --- | --- | ---: | ---: | ---: | --- |',
    ...rows,
  ].join('\n')
}

/** One path per line, newest first: what `/touched copy` puts on the clipboard. */
export function listText(files: readonly TouchedFile[]): string {
  return byRecent(files).map(f => f.path).join('\n')
}

/** An @-reference for the prompt box, quoted when the path has spaces. */
export function mention(path: string): string {
  return /\s/.test(path) ? `@"${path}" ` : `@${path} `
}
