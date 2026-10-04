import type { EngineInterface, Register } from 'claude-code'

import {
  contextToast,
  crossMarks,
  formatUsd,
  parseBudget,
  report,
  statusLine,
  type Reading,
  type Turn,
} from './format'

const KEEP = 'Keep going'
const STOP = 'Stop here'

// The session's figures. A reload starts them over; the next measurement fills them in.
let reading: Reading = { limits: [] }
let announced = new Set<number>()
const turns: Turn[] = []
let current: { turnId: string; prompt: string; startUsd: number | undefined } | null = null
// Finished turns waiting for their `TurnDuration` line, and the lines already matched.
const unclaimed: { durationMs: number; usd: number }[] = []
const claimed = new Map<string, number>()
// The budget: `bar` is where the next check fires; `stoppedTurn` refuses the rest of a stopped turn.
const budget = { usd: 0, bar: 0, isOver: false }
let stoppedTurn: string | null = null
let pendingAsk: Promise<boolean> | null = null
let warnContext = true

function take(usage: { context: { percent?: number }; rateLimits: readonly { kind: string; percentUsed: number; resetsAt?: string }[]; cost?: { usd: number } }): void {
  reading = {
    usd: usage.cost?.usd,
    percent: usage.context.percent,
    limits: usage.rateLimits.map(l => ({ kind: l.kind, percentUsed: l.percentUsed, resetsAt: l.resetsAt })),
  }
}

function react($: EngineInterface): void {
  const line = statusLine(reading)
  $.ui.status(line === '' ? undefined : line)

  if (warnContext) {
    const marks = crossMarks(reading.percent, announced)
    announced = marks.announced
    for (const mark of marks.crossed) $.ui.toast(contextToast(mark), { timeoutMs: 8000 })
  }

  const usd = reading.usd
  if (budget.usd > 0 && usd !== undefined && usd >= budget.bar && !budget.isOver) {
    budget.isOver = true
    $.ui.toast(`Session cost ${formatUsd(usd)} passed your ${formatUsd(budget.bar)} budget`, { timeoutMs: 8000 })
  }
}

function raiseBar(): void {
  if (budget.usd <= 0) {
    budget.isOver = false
    return
  }
  const usd = reading.usd ?? 0
  while (budget.bar <= usd) budget.bar += budget.usd
  budget.isOver = false
}

async function askToContinue($: EngineInterface): Promise<boolean> {
  let answer = STOP
  try {
    answer = await $.ui.ask(
      `Session cost ${formatUsd(reading.usd ?? 0)} passed your ${formatUsd(budget.bar)} budget. Keep going?`,
      { header: 'cost-meter', options: [KEEP, STOP] },
    )
  } catch {
    // Nobody to ask (a -p run) or the dialog was dismissed: stop.
  }
  if (answer !== KEEP) return false
  raiseBar()
  return true
}

async function measure($: EngineInterface): Promise<void> {
  try {
    take(await $.session.usage())
  } catch {
    // A host without figures: keep what the last push said.
  }
}

export const register: Register = (on, options) => {
  budget.usd = Math.max(0, Number(options.budgetUsd ?? 0) || 0)
  budget.bar = budget.usd
  const showTurnCost = options.showTurnCost !== false
  warnContext = options.contextWarnings !== false

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'spend',
      description: 'cost-meter: what this session has cost, turn by turn; /spend budget <usd> sets a budget',
      argumentHint: '[budget <usd>|off]',
    })
    await measure($)
    react($)
    return next(e)
  })

  on('session.measure', ($, e, next) => {
    take(e)
    react($)
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    await measure($)
    current = { turnId: e.turnId, prompt: e.text, startUsd: reading.usd }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    await measure($)
    react($)
    const started = current
    current = null
    if (started !== null && started.turnId === e.turnId && started.startUsd !== undefined && reading.usd !== undefined) {
      const usd = Math.max(0, reading.usd - started.startUsd)
      turns.push({ prompt: started.prompt, usd, durationMs: e.durationMs })
      if (turns.length > 200) turns.shift()
      unclaimed.push({ durationMs: e.durationMs, usd })
      if (unclaimed.length > 20) unclaimed.shift()
      if (showTurnCost) $.ui.invalidate('ui.render')
    }
    return next(e)
  })

  // The line that closes a turn (`Baked for 1m 3s`) gets the turn's cost after it.
  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    if (!showTurnCost) return next(e)
    let usd = claimed.get(e.requestId)
    if (usd === undefined) {
      let best = -1
      for (let i = 0; i < unclaimed.length; i++) {
        const gap = Math.abs(unclaimed[i]!.durationMs - e.props.durationMs)
        if (gap <= 1000 && (best < 0 || gap < Math.abs(unclaimed[best]!.durationMs - e.props.durationMs))) best = i
      }
      if (best < 0) return next(e)
      usd = unclaimed.splice(best, 1)[0]!.usd
      claimed.set(e.requestId, usd)
    }
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="row">
        {await next(e)}
        <Text dimColor>{` · ${formatUsd(usd)}`}</Text>
      </Box>
    )
  })

  on('prompt.submit', async ($, e, next) => {
    if (!budget.isOver) return next(e)
    // Asking here could hold the prompt box; the person's second Enter is the yes.
    raiseBar()
    stoppedTurn = null
    if (e.origin.kind === 'composer') void $.prompt.fill({ text: e.text })
    return {
      drop: `cost-meter: this session has cost ${formatUsd(reading.usd ?? 0)}, past your budget. Press Enter to send it anyway (next check at ${formatUsd(budget.bar)}), or /spend budget <usd> to change the budget.`,
    }
  })

  on('tool.call', async ($, e, next) => {
    if (budget.usd <= 0 || e.tool === 'AskUserQuestion') return next(e)
    // session.measure only fires between turns; a long turn is checked call by call (a free read).
    if (!budget.isOver) {
      await measure($)
      react($)
    }
    if (!budget.isOver) return next(e)
    const turnId = current?.turnId ?? 'idle'
    if (stoppedTurn === turnId) {
      return { deny: 'cost-meter: the user stopped this turn at their budget. End your turn now with a short summary of where things stand.' }
    }
    if (pendingAsk === null) pendingAsk = askToContinue($).finally(() => (pendingAsk = null))
    if (await pendingAsk) return next(e)
    stoppedTurn = turnId
    return {
      deny: `cost-meter: the session passed the user's ${formatUsd(budget.usd)} budget and they chose to stop. Do not call more tools; end your turn with a short summary of where things stand.`,
    }
  })

  on('command.run', { command: 'spend' }, async ($, e) => {
    const args = e.args.trim()
    if (args.startsWith('budget')) {
      const rest = args.slice('budget'.length)
      if (rest.trim() === '') {
        return { text: budget.usd > 0 ? `Budget: ${formatUsd(budget.usd)} per step, next check at ${formatUsd(budget.bar)}.` : 'No budget set. /spend budget 5 sets one.' }
      }
      const usd = parseBudget(rest)
      if (usd === undefined) return { text: `cost-meter: "${rest.trim()}" is not an amount. Try /spend budget 5 or /spend budget off.` }
      budget.usd = usd
      budget.bar = usd
      budget.isOver = false
      if (usd > 0) raiseBar()
      stoppedTurn = null
      return { text: usd > 0 ? `Budget set: ${formatUsd(usd)} per step, next check at ${formatUsd(budget.bar)}.` : 'Budget off.' }
    }
    await measure($)
    return { text: report(reading, turns, budget) }
  })
}
