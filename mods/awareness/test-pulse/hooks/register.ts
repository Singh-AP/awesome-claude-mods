import type { EngineInterface, Register } from 'claude-code'

import { testRunner } from './detect'
import { append, readRuns, report, statusLine, toRun, transition, type Run } from './history'
import { parseOutput } from './parse'

// This project's runs, newest last; persisted in $.store under its root.
let runs: Run[] = []
let storeKey = 'runs:'
// Bumped on every successful file edit; a session token keeps epochs from
// different sessions apart.
const session = Math.random().toString(36).slice(2, 8)
let edits = 0
let ticker: { cancel: () => void } | undefined

async function showPulse($: EngineInterface) {
  const last = runs.at(-1)
  $.ui.status(last === undefined ? undefined : statusLine(last, await $.clock.now()))
}

// Keeps "2m ago" honest; one cheap status write a minute, only once a run exists.
function keepTicking($: EngineInterface) {
  if (ticker !== undefined) return
  ticker = $.clock.every(60_000, () => {
    void showPulse($)
  })
}

async function record($: EngineInterface, run: Run) {
  const previous = [...runs].reverse().find(r => r.runner === run.runner)
  runs = append(runs, run)
  await $.store.set(storeKey, runs)
  const news = transition(previous, run)
  if (news !== undefined) $.ui.toast(news)
  await showPulse($)
  keepTicking($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    storeKey = `runs:${await $.session.root()}`
    runs = readRuns(await $.store.get(storeKey))
    if (runs.length > 0) {
      await showPulse($)
      keepTicking($)
    }
    const description = 'Test runs this project has seen: pass-rate sparkline, failures, flakes'
    try {
      await $.command.register({ name: 'tests', description, argumentHint: '[clear]' })
    } catch {
      // A build that already has /tests: fall back to the mod's own name.
      await $.command.register({ name: 'test-pulse', description, argumentHint: '[clear]' }).catch(() => undefined)
    }
    return next(e)
  })

  on('tool.call', { tool: ['Edit', 'Write', 'NotebookEdit'] }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true) edits += 1
    return ran
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const runner = testRunner(e.command)
    if (runner === undefined || e.run_in_background === true) return next(e)

    const ran = await next(e)
    if (ran.deny !== undefined) return ran
    const result = ran.result as { stdout?: string; stderr?: string; interrupted?: boolean; backgroundTaskId?: string } | undefined
    if (result?.interrupted === true || result?.backgroundTaskId !== undefined) return ran

    const output = ran.text ?? `${result?.stdout ?? ''}\n${result?.stderr ?? ''}`
    const run = toRun({
      at: await $.clock.now(),
      runner,
      command: e.command,
      parsed: parseOutput(output),
      exitOk: ran.isError !== true,
      epoch: `${session}:${edits}`,
    })
    await record($, run)
    return ran
  })

  on('command.run', { command: ['tests', 'test-pulse'] }, async ($, e) => {
    if (e.args.trim() === 'clear') {
      runs = []
      await $.store.delete(storeKey)
      $.ui.status(undefined)
      return { text: 'Test history cleared for this project.' }
    }
    return { text: report(runs, await $.clock.now()) }
  })
}
