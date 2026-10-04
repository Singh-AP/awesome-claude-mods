// What command-explainer asks the model, how it reads the reply, and which
// commands are too plain to spend a call on. Pure: no `$`.

export type Risk = 'safe' | 'caution' | 'danger'

export type Explanation = { risk: Risk | undefined; summary: string }

export const SYSTEM =
  'You explain shell commands to a developer who must decide, right now, whether to let an AI agent run them. ' +
  'Reply with exactly one line: "<risk> — <what it does>". <risk> is safe, caution or danger: ' +
  'safe = read-only or trivially undoable; caution = changes files, installs, network or git state; ' +
  'danger = deletes data, rewrites history, touches credentials, system files or production. ' +
  '<what it does> is one plain-English sentence of at most 22 words naming the concrete effect (which files, which remote, what gets deleted). ' +
  'No markdown, no quotes, no advice.'

export function promptFor(command: string): string {
  const clipped = command.length > 4000 ? `${command.slice(0, 4000)}\n…(truncated)` : command
  return `Command:\n${clipped}`
}

const LEADING = /^\s*[-*•"'`[(]*\s*(?:risk\s*[:=]\s*)?(safe|caution|danger)\b[\])"'`*]*\s*(?:[—–:-]+|\.|,)?\s*/i

/** Reads "<risk> — <sentence>" leniently; undefined when the reply holds no sentence. */
export function parseExplanation(reply: string): Explanation | undefined {
  const line = reply
    .split('\n')
    .map(l => l.trim())
    .find(l => l !== '')
  if (line === undefined) return undefined
  const match = line.match(LEADING)
  const risk = match === null ? undefined : (match[1]!.toLowerCase() as Risk)
  let summary = (match === null ? line : line.slice(match[0].length)).replace(/^["'`*]+|["'`*]+$/g, '').trim()
  if (summary === '') return undefined
  if (summary.length > 180) summary = `${summary.slice(0, 179)}…`
  summary = summary[0]!.toUpperCase() + summary.slice(1)
  return { risk, summary }
}

const GLYPH: Record<Risk, string> = { safe: '💡 Safe', caution: '⚠️ Caution', danger: '🛑 Danger' }

export function formatNotice(explanation: Explanation): string {
  return explanation.risk === undefined ? `💡 ${explanation.summary}` : `${GLYPH[explanation.risk]}: ${explanation.summary}`
}

const PLAIN = new Set([
  'ls', 'pwd', 'echo', 'printf', 'cat', 'head', 'tail', 'wc', 'which', 'whoami', 'date', 'true', 'file', 'stat',
  'du', 'df', 'tree', 'type', 'uname', 'env', 'printenv', 'hostname', 'id', 'basename', 'dirname', 'realpath',
])
const PLAIN_GIT = new Set(['status', 'diff', 'log', 'show', 'blame', 'rev-parse', 'shortlog', 'describe', 'ls-files'])

/**
 * Commands whose effect is obvious from reading them: one read-only program, no
 * chaining, pipes, redirects or substitutions. Explaining these spends tokens
 * and says nothing.
 */
export function isPlain(command: string): boolean {
  const trimmed = command.trim()
  if (trimmed === '') return true
  if (/[;&|<>`\n]|\$\(/.test(trimmed)) return false
  const words = trimmed.split(/\s+/)
  const head = words[0]!.split('/').pop()!
  if (PLAIN.has(head)) return !(head === 'env' && words.length > 1)
  if (head === 'git') {
    const sub = words.find((w, i) => i > 0 && !w.startsWith('-'))
    if (sub === undefined) return true
    if (PLAIN_GIT.has(sub)) return true
    if (sub === 'branch') return !words.some(w => /^-[a-zA-Z]*[dDmMcC]/.test(w) || w === '--delete' || w === '--move')
    if (sub === 'remote') return words.length <= 3 && (words[2] === undefined || words[2] === '-v')
  }
  return false
}

/** A Map that forgets its oldest entry past `limit`, and refreshes an entry on read. */
export class Lru<K, V> {
  private readonly entries = new Map<K, V>()
  constructor(private readonly limit: number) {}

  get(key: K): V | undefined {
    const value = this.entries.get(key)
    if (value === undefined) return undefined
    this.entries.delete(key)
    this.entries.set(key, value)
    return value
  }

  set(key: K, value: V): void {
    this.entries.delete(key)
    this.entries.set(key, value)
    while (this.entries.size > this.limit) this.entries.delete(this.entries.keys().next().value as K)
  }

  get size(): number {
    return this.entries.size
  }
}

/** The `limit` most recently added entries of a record (insertion order). */
export function keepLatest<V>(record: Readonly<Record<string, V>>, limit: number): Record<string, V> {
  const entries = Object.entries(record)
  return Object.fromEntries(entries.slice(Math.max(0, entries.length - limit)))
}

type CallState = { isRunning: boolean; isErrored: boolean; isInterrupted: boolean; output?: unknown }
type GroupCall = CallState & { tool_use_id?: string; tool: string }

/**
 * Not resolved yet: waiting at its permission dialog (where `isRunning` is
 * still false) or running. A resolved call has an output, an error or an abort.
 */
export function isPending(call: CallState): boolean {
  return call.isRunning || (call.output === undefined && !call.isErrored && !call.isInterrupted)
}

/** The explanations to draw under a collapsed group: its pending Bash calls that have one. */
export function linesForGroup(calls: readonly GroupCall[], known: Readonly<Record<string, string>>): string[] {
  return calls.flatMap(call => {
    if (call.tool !== 'Bash' || !isPending(call) || call.tool_use_id === undefined) return []
    const line = known[call.tool_use_id]
    return line === undefined ? [] : [line]
  })
}
