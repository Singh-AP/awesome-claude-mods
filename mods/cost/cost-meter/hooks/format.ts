// Pure formatting and bookkeeping: no `$`, so the tests can drive it directly.

export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

export type Reading = {
  usd?: number
  percent?: number
  limits: readonly Limit[]
}

export type Turn = {
  prompt: string
  usd: number
  durationMs: number
}

const LIMIT_LABELS: Record<string, string> = {
  five_hour: '5h',
  seven_day: '7d',
  spend_limit: 'spend',
}

const isNumber = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

/** `$0.42`, `$12.3`, `$123`; never NaN. */
export function formatUsd(usd: number): string {
  if (!isNumber(usd) || usd <= 0) return '$0.00'
  if (usd < 0.01) return '<$0.01'
  if (usd >= 100) return `$${Math.round(usd)}`
  if (usd >= 10) return `$${usd.toFixed(1)}`
  return `$${usd.toFixed(2)}`
}

/** `3s`, `1m 4s`, `2h 5m`, as the engine's own turn line spells it. */
export function formatDuration(ms: number): string {
  if (!isNumber(ms) || ms < 0) return '0s'
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

export function limitLabel(kind: string): string {
  return LIMIT_LABELS[kind] ?? kind.replace(/_/g, ' ')
}

function round(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(0)
}

/** The status line: only the parts that have a reading, `''` when none does. */
export function statusLine(reading: Reading): string {
  const parts: string[] = []
  if (isNumber(reading.usd)) parts.push(formatUsd(reading.usd))
  if (isNumber(reading.percent)) parts.push(`ctx ${round(reading.percent)}%`)
  for (const limit of reading.limits) {
    if (isNumber(limit.percentUsed)) parts.push(`${limitLabel(limit.kind)} ${round(limit.percentUsed)}%`)
  }
  return parts.length === 0 ? '' : `💸 ${parts.join(' · ')}`
}

export const CONTEXT_MARKS = [70, 85, 95] as const

/**
 * Which marks `percent` newly crossed, given the ones already announced; marks
 * the context has fallen well below again (a /compact) are re-armed.
 */
export function crossMarks(percent: number | undefined, announced: ReadonlySet<number>): { crossed: number[]; announced: Set<number> } {
  const next = new Set(announced)
  if (!isNumber(percent)) return { crossed: [], announced: next }
  for (const mark of CONTEXT_MARKS) {
    if (next.has(mark) && percent < mark - 10) next.delete(mark)
  }
  const crossed = CONTEXT_MARKS.filter(mark => percent >= mark && !next.has(mark))
  for (const mark of crossed) next.add(mark)
  return { crossed: crossed.length > 0 ? [crossed[crossed.length - 1]!] : [], announced: next }
}

export function contextToast(mark: number): string {
  if (mark >= 95) return `context ${mark}% full: /compact now or the next turn may be cut off`
  if (mark >= 85) return `context ${mark}% full: /compact soon`
  return `context ${mark}% full`
}

export function preview(text: string, width = 48): string {
  const one = text.replace(/\s+/g, ' ').trim()
  if (one === '') return '(no prompt)'
  return one.length > width ? `${one.slice(0, width - 1)}…` : one
}

/** The `/spend` report. */
export function report(reading: Reading, turns: readonly Turn[], budget: { usd: number; bar: number }): string {
  const lines: string[] = []
  lines.push(isNumber(reading.usd) ? `Session cost: ${formatUsd(reading.usd)}` : 'Session cost: not reported by this host')
  if (isNumber(reading.percent)) lines.push(`Context: ${round(reading.percent)}% full`)
  for (const limit of reading.limits) {
    const reset = limit.resetsAt === undefined ? '' : `, resets ${limit.resetsAt.replace('T', ' ').replace(/:\d\d(\.\d+)?Z$/, ' UTC')}`
    lines.push(`Rate limit ${limitLabel(limit.kind)}: ${round(limit.percentUsed)}% used${reset}`)
  }
  if (budget.usd > 0) lines.push(`Budget: ${formatUsd(budget.usd)} (next check at ${formatUsd(budget.bar)})`)

  if (turns.length > 0) {
    const total = turns.reduce((sum, t) => sum + t.usd, 0)
    const top = turns.reduce((a, b) => (b.usd > a.usd ? b : a))
    lines.push('')
    lines.push(`Turns measured: ${turns.length}, ${formatUsd(total)} in all, ${formatUsd(total / turns.length)} on average`)
    lines.push(`Most expensive: ${formatUsd(top.usd)} for "${preview(top.prompt)}"`)
    lines.push('')
    lines.push('Last turns:')
    for (const turn of turns.slice(-10)) {
      lines.push(`  ${formatUsd(turn.usd).padStart(7)}  ${formatDuration(turn.durationMs).padStart(7)}  ${preview(turn.prompt)}`)
    }
  } else {
    lines.push('', 'No turns measured yet.')
  }
  return lines.join('\n')
}

/** Parses `/spend budget 5`, `$5`, `off`; undefined when it is not a budget. */
export function parseBudget(arg: string): number | undefined {
  const text = arg.trim().toLowerCase()
  if (text === 'off' || text === '0' || text === 'none') return 0
  const match = /^\$?(\d+(?:\.\d+)?)$/.exec(text)
  if (match === null) return undefined
  const usd = Number(match[1])
  return Number.isFinite(usd) ? usd : undefined
}
