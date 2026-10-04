// Runs, the status line, transitions, sparklines and flakes. Pure: no `$`.

import type { Parsed } from './parse'

export type Run = {
  /** When it finished, ms since the epoch. */
  at: number
  runner: string
  command: string
  /** False when no summary was found and only the exit status is known. */
  counted: boolean
  passed: number
  failed: number
  skipped: number
  /** Exit status zero and no failures. */
  ok: boolean
  failing: string[]
  /** Which edit state of the session the run saw; equal epochs mean no file edits in between. */
  epoch: string
}

export const KEEP = 20

export function toRun(args: { at: number; runner: string; command: string; parsed: Parsed | undefined; exitOk: boolean; epoch: string }): Run {
  const { parsed } = args
  return {
    at: args.at,
    runner: args.runner,
    command: args.command.replace(/\s+/g, ' ').trim().slice(0, 120),
    counted: parsed !== undefined,
    passed: parsed?.passed ?? 0,
    failed: parsed?.failed ?? 0,
    skipped: parsed?.skipped ?? 0,
    ok: args.exitOk && (parsed?.failed ?? 0) === 0,
    failing: (parsed?.failing ?? []).slice(0, 5),
    epoch: args.epoch,
  }
}

export function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

/** `🧪 ✅ 44/44 passing · 2m ago`, `🧪 ❌ 41/44 passing · just now`. */
export function statusLine(run: Run, now: number): string {
  const mark = run.ok ? '✅' : '❌'
  const when = ago(now - run.at)
  if (!run.counted) return `🧪 ${mark} tests ${run.ok ? 'passed' : 'failed'} · ${when}`
  const total = run.passed + run.failed
  if (!run.ok && run.failed === 0) return `🧪 ${mark} ${run.passed}/${total} passing, exit failed · ${when}`
  return `🧪 ${mark} ${run.passed}/${total} passing · ${when}`
}

/** The toast for a change of colour, or undefined when the colour held. */
export function transition(previous: Run | undefined, run: Run): string | undefined {
  if (previous === undefined || previous.ok === run.ok) return undefined
  if (run.ok) return `tests are green again 🎉${run.counted ? ` (${run.passed} passing)` : ''}`
  const first = run.failing[0]
  const howMany = run.counted && run.failed > 0 ? `${run.failed} failing` : 'failing'
  return `tests went red: ${howMany}${first !== undefined ? ` · ${first}` : ''}`
}

const BARS = '▁▂▃▄▅▆▇█'

/** One bar per run, oldest first: the pass rate, or full/empty when only the exit is known. */
export function sparkline(runs: readonly Run[]): string {
  return runs
    .map(run => {
      const total = run.passed + run.failed
      const rate = run.counted && total > 0 ? run.passed / total : run.ok ? 1 : 0
      return BARS[Math.round(rate * (BARS.length - 1))]
    })
    .join('')
}

/**
 * Tests that failed in one run and passed in the next run of the same
 * command with no file edited in between: likely flaky. Best effort.
 */
export function flaky(runs: readonly Run[]): string[] {
  const found: string[] = []
  for (let i = 1; i < runs.length; i++) {
    const before = runs[i - 1]!
    const after = runs[i]!
    if (before.command !== after.command || before.epoch !== after.epoch || before.ok) continue
    const cleared = after.ok ? before.failing : before.failing.filter(name => after.counted && !after.failing.includes(name))
    const flips = cleared.length > 0 ? cleared : after.ok ? [`the whole run (${before.command})`] : []
    for (const name of flips) if (!found.includes(name)) found.push(name)
  }
  return found
}

export function append(runs: readonly Run[], run: Run): Run[] {
  return [...runs, run].slice(-KEEP)
}

/** The /tests report: newest first, with the sparkline and any flakes. */
export function report(runs: readonly Run[], now: number): string {
  if (runs.length === 0) return 'No test runs seen in this project yet. Ask Claude to run your tests.'
  const rows = [...runs].reverse().map(run => {
    const mark = run.ok ? '✅' : '❌'
    const score = run.counted ? `${run.passed}/${run.passed + run.failed}` : run.ok ? 'pass' : 'fail'
    const fails = run.failing.length > 0 ? `  ✗ ${run.failing.slice(0, 3).join(', ')}` : ''
    return `  ${mark} ${ago(now - run.at).padEnd(9)} ${score.padEnd(9)} ${run.command}${fails}`
  })
  const lines = [`Last ${runs.length} run${runs.length === 1 ? '' : 's'} · pass rate ${sparkline(runs)} (oldest → newest)`, ...rows]
  const flakes = flaky(runs)
  if (flakes.length > 0) lines.push('', `Possibly flaky (failed, then passed with no edits in between): ${flakes.join(', ')}`)
  return lines.join('\n')
}

/** Accepts only well-formed runs from the store. */
export function readRuns(value: unknown): Run[] {
  if (!Array.isArray(value)) return []
  return value.filter((r): r is Run => typeof r === 'object' && r !== null && typeof (r as Run).at === 'number' && typeof (r as Run).ok === 'boolean').slice(-KEEP)
}
