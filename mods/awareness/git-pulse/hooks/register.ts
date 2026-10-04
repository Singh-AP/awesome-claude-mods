import type { EngineInterface, Register, Timer } from 'claude-code'

import { commitsToast, headName, parseStatus, statusLine, summary, type GitState } from './status'

const STATUS = ['git', '--no-optional-locks', 'status', '--porcelain=v2', '--branch']
const SETTLE_MS = 750

// What the last look found; a reload starts over and looks again at session start.
let last: GitState | null = null
let isGitMissing = false
let failures = 0
let timer: Timer | null = null
let turnStart: { turnId: string; oid: string | null } | null = null

async function git($: EngineInterface, args: string[]): Promise<{ exitCode: number; stdout: string } | null> {
  if (isGitMissing) return null
  try {
    const out = await $.process.run(args, { timeoutMs: 5000 })
    failures = 0
    return out
  } catch {
    // git is not installed, or keeps timing out: after three misses, stay quiet rather than nag.
    failures += 1
    if (failures >= 3) isGitMissing = true
    return null
  }
}

async function refresh($: EngineInterface): Promise<GitState | null> {
  const out = await git($, STATUS)
  if (out === null || out.exitCode !== 0) {
    last = null
    $.ui.status(undefined)
    return null
  }
  const state = parseStatus(out.stdout)
  if (last !== null && last.branch !== state.branch && (last.branch !== null || state.branch !== null)) {
    $.ui.toast(`branch changed: ${headName(last)} → ${headName(state)}`)
  }
  last = state
  $.ui.status(statusLine(state))
  return state
}

function schedule($: EngineInterface): void {
  timer?.cancel()
  timer = $.clock.after(SETTLE_MS, () => {
    timer = null
    void refresh($)
  })
}

async function countCommits($: EngineInterface, from: string, to: string): Promise<number> {
  const out = await git($, ['git', 'rev-list', '--count', `${from}..${to}`])
  if (out === null || out.exitCode !== 0) return 0
  const count = Number(out.stdout.trim())
  return Number.isFinite(count) ? count : 0
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'git-pulse',
      description: 'git-pulse: branch, upstream, changes, last commits and stash at a glance',
    })
    await refresh($)
    return next(e)
  })

  on('tool.call', { tool: ['Bash', 'Edit', 'Write', 'NotebookEdit'] }, async ($, e, next) => {
    const ran = await next(e)
    schedule($)
    return ran
  })

  on('turn.start', async ($, e, next) => {
    const state = await refresh($)
    turnStart = { turnId: e.turnId, oid: state?.oid ?? null }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    timer?.cancel()
    timer = null
    const started = turnStart
    turnStart = null
    const state = await refresh($)
    if (state !== null && state.oid !== null && started !== null && started.turnId === e.turnId && started.oid !== null && started.oid !== state.oid) {
      const count = await countCommits($, started.oid, state.oid)
      if (count > 0) $.ui.toast(commitsToast(count, state))
    }
    return next(e)
  })

  on('command.run', { command: 'git-pulse' }, async $ => {
    const state = await refresh($)
    if (state === null) {
      return { text: isGitMissing ? 'git-pulse: git is not available here.' : 'git-pulse: this folder is not inside a git repository.' }
    }
    const log = state.oid === null ? null : await git($, ['git', 'log', '-3', '--no-decorate', '--format=%h %s (%cr)'])
    const stash = await git($, ['git', 'stash', 'list', '--format=%gd'])
    const stashes = stash === null || stash.exitCode !== 0 ? 0 : stash.stdout.split('\n').filter(l => l.trim() !== '').length
    return { text: summary(state, log?.exitCode === 0 ? log.stdout : '', stashes) }
  })
}
