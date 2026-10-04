// Pure helpers: no `$`, so tests import them directly.

export const HISTORY_LIMIT = 50

/** `<1m`, `12m`, `1h 05m`, `2d 3h`. */
export function formatDuration(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000)
  if (minutes < 1) return '<1m'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

/** Cuts `text` to `room` cells, ending in an ellipsis when cut. */
export function clip(text: string, room: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= room) return flat
  return `${flat.slice(0, Math.max(1, room - 1)).trimEnd()}…`
}

/** The system prompt section that keeps the model on the goal. */
export function focusPrompt(goal: string): string {
  return [
    '# Current focus',
    `The user has pinned one goal for this session: "${goal}"`,
    'Keep your work on this goal. If you notice something unrelated that needs doing (a bug elsewhere, a refactor, a dependency upgrade), mention it in one line at the end of your reply instead of doing it, unless the user asks for it.',
    'If a request seems to move away from the goal, do what the user asked, and say in one line that it is outside the current focus.',
  ].join('\n')
}

export type FocusCommand =
  | { kind: 'show' }
  | { kind: 'done' }
  | { kind: 'clear' }
  | { kind: 'history' }
  | { kind: 'set'; goal: string }

/** Reads what followed `/focus`. */
export function parseFocus(args: string): FocusCommand {
  const text = args.replace(/\s+/g, ' ').trim()
  const word = text.toLowerCase()
  if (text === '') return { kind: 'show' }
  if (word === 'done' || word === 'finish' || word === 'finished') return { kind: 'done' }
  if (word === 'clear' || word === 'off' || word === 'reset') return { kind: 'clear' }
  if (word === 'history' || word === 'log') return { kind: 'history' }
  return { kind: 'set', goal: text.slice(0, 200) }
}
