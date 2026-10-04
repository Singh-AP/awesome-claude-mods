// What the notifications say. Pure: no `$`.

/** `45s`, `2m 14s`, `1h 3m`. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

/** The answer's opening words as one plain line: markdown dropped, cut at `max`. */
export function firstLine(answer: string, max = 90): string {
  const plain = answer
    .replace(/```[\s\S]*?(```|$)/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/[*_`~|]/g, '')
    .split('\n')
    .map(line => line.trim())
    .find(line => line !== '') ?? ''
  const line = plain.replace(/\s+/g, ' ')
  return line.length <= max ? line : `${line.slice(0, max - 1).trimEnd()}…`
}

export type Ping = { title: string; subtitle: string; body: string; phrase: string }

export type TurnEnd = { durationMs: number; answer: string; reason: string }

/** The notification for a finished turn. */
export function donePing(turn: TurnEnd, project: string): Ping {
  const took = formatDuration(turn.durationMs)
  const subtitle = project
  if (turn.reason === 'error') {
    return { title: 'Claude Code stopped', subtitle, body: `An error ended the turn after ${took}`, phrase: 'Claude stopped on an error' }
  }
  if (turn.reason === 'refusal') {
    return { title: 'Claude Code stopped', subtitle, body: `The model declined after ${took}`, phrase: 'Claude stopped' }
  }
  const gist = firstLine(turn.answer)
  return { title: 'Claude Code', subtitle, body: gist === '' ? `Done in ${took}` : `Done in ${took} · ${gist}`, phrase: 'Claude is done' }
}

// The settings Notification event's types that mean "a person is needed".
export const WAITING_TYPES: ReadonlySet<string> = new Set(['permission_prompt', 'idle_prompt', 'elicitation_dialog'])

/** The notification for Claude waiting on the person, or undefined when it isn't. */
export function waitingPing(event: { message: string; notification_type: string }, project: string): Ping | undefined {
  if (!WAITING_TYPES.has(event.notification_type)) return undefined
  const body = event.message.trim() === '' ? 'Claude needs your input' : event.message.trim()
  return { title: 'Claude Code needs you', subtitle: project, body, phrase: 'Claude needs your input' }
}

/** The last path segment, for a folder name used as the project's name. */
export function baseName(path: string): string {
  return path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? ''
}
