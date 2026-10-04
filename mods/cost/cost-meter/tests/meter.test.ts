import { expect, test } from 'claude-code/testing'

const TYPED = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } } as const

type Limit = { kind: string; percentUsed: number }
const usage = (usd: number, percent: number, rateLimits: Limit[] = []) => ({
  startedAt: 0,
  context: { window: 200_000, percent, tokens: percent * 2000 },
  rateLimits,
  cost: { usd },
})

test('session start puts cost, context and rate limits on the status line', async ($, on) => {
  const statuses: (string | undefined)[] = []
  on('ui.status', ($, e) => (statuses.push(e.text), { value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.usage', () => ({ value: usage(0.42, 38, [{ kind: 'five_hour', percentUsed: 21 }, { kind: 'seven_day', percentUsed: 9 }]) }))
  on('session.start', () => ({ cwd: '/work' }))

  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

  expect(statuses.at(-1)).toBe('💸 $0.42 · ctx 38% · 5h 21% · 7d 9%')
})

test('a pushed measurement updates the line and warns once per context mark', async ($, on) => {
  const statuses: (string | undefined)[] = []
  const toasts: string[] = []
  on('ui.status', ($, e) => (statuses.push(e.text), { value: undefined }))
  on('ui.toast', ($, e) => (toasts.push(e.text), { value: undefined }))
  on('session.measure', ($, e) => ({ changed: e.changed }))

  await $.session.measure({ context: { window: 200_000, percent: 86 }, rateLimits: [], cost: { usd: 2 }, changed: ['context', 'cost'] })
  await $.session.measure({ context: { window: 200_000, percent: 88 }, rateLimits: [], cost: { usd: 2.1 }, changed: ['context', 'cost'] })

  expect(statuses.at(-1)).toBe('💸 $2.10 · ctx 88%')
  expect(toasts).toEqual(['context 85% full: /compact soon'])
})

test('a host with no figures clears the status line instead of printing junk', async ($, on) => {
  const statuses: (string | undefined)[] = ['before']
  on('ui.status', ($, e) => (statuses.push(e.text), { value: undefined }))
  on('session.measure', ($, e) => ({ changed: e.changed }))

  await $.session.measure({ context: { window: 200_000 }, rateLimits: [], changed: ['context'] })

  expect(statuses.at(-1)).toBeUndefined()
})

test('each turn is measured and /spend reports it', async ($, on) => {
  let now = usage(1.0, 10)
  on('session.usage', () => ({ value: now }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))

  await $.turn.start({ text: 'refactor the parser please', turnId: 't1' })
  now = usage(1.3, 20)
  await $.turn.complete({ turnId: 't1', answer: 'done', durationMs: 95_000, isAborted: false, reason: 'answer' })

  const answer = await $.command.run({ command: 'spend', args: '', ...TYPED })
  expect(answer.text).toContain('Session cost: $1.30')
  expect(answer.text).toContain('Most expensive: $0.30 for "refactor the parser please"')
  expect(answer.text).toContain('1m 35s')
})

test('subagent turns are not counted as turns of their own', async ($, on) => {
  on('session.usage', () => ({ value: usage(1, 10) }))
  on('ui.status', () => ({ value: undefined }))
  on('turn.complete', () => ({ text: '' }))

  await $.turn.complete({ turnId: 't9', answer: '', durationMs: 1000, isAborted: false, reason: 'answer', agentId: 'a1' })

  const answer = await $.command.run({ command: 'spend', args: '', ...TYPED })
  expect(answer.text).toContain('No turns measured yet.')
})

test('the line closing a turn carries the turn cost on every width', async ($, on) => {
  let now = usage(0.5, 10)
  on('session.usage', () => ({ value: now }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['Baked for 30s'] }))

  await $.turn.start({ text: 'x', turnId: 't1' })
  now = usage(0.62, 12)
  await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 30_000, isAborted: false, reason: 'answer' })

  const line = await $.ui.mount({ plugin: 'cost-meter', surface: 'terminal', component: 'TurnDuration', requestId: 'm1', props: { word: 'Baked', durationMs: 30_000 } })
  expect(await line.find({ type: 'Text', text: 'Baked for 30s' })).toBeDefined()
  expect(await line.find({ type: 'Text', text: '  $0.12 this turn' })).toBeDefined()
  await line.unmount()

  // An older line no turn matches is left as the engine draws it.
  const old = await $.ui.mount({ plugin: 'cost-meter', surface: 'terminal', component: 'TurnDuration', requestId: 'm0', props: { word: 'Baked', durationMs: 4000 } })
  expect(await old.find({ type: 'Text', text: /\$/ })).toBeUndefined()
})

test('showTurnCost: false leaves the line alone', { options: { showTurnCost: false } }, async ($, on) => {
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['Baked for 30s'] }))
  const line = await $.ui.mount({ plugin: 'cost-meter', surface: 'terminal', component: 'TurnDuration', requestId: 'm1', props: { word: 'Baked', durationMs: 30_000 } })
  expect(await line.find({ type: 'Text', text: /\$/ })).toBeUndefined()
})

test('past the budget a tool call asks, and "Keep going" moves the bar', { options: { budgetUsd: 1 } }, async ($, on) => {
  const toasts: string[] = []
  let asked = 0
  let ran = 0
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', ($, e) => (toasts.push(e.text), { value: undefined }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('tool.call', ($, e) => {
    if (e.tool === 'AskUserQuestion') {
      asked++
      const q = e.questions[0]!.question
      return { result: { questions: e.questions, answers: { [q]: 'Keep going' } } }
    }
    ran++
    return { result: 'ok' }
  })

  await $.session.measure({ context: { window: 200_000, percent: 10 }, rateLimits: [], cost: { usd: 1.2 }, changed: ['cost'] })
  expect(toasts).toContain('Session cost $1.20 passed your $1.00 budget')

  expect((await $.tool.call({ tool: 'Bash', command: 'ls' })).deny).toBeUndefined()
  expect((await $.tool.call({ tool: 'Bash', command: 'ls' })).deny).toBeUndefined()
  expect(asked).toBe(1)
  expect(ran).toBe(2)

  // Under the new bar of $2.00 nothing asks; past it, it asks again.
  await $.session.measure({ context: { window: 200_000, percent: 10 }, rateLimits: [], cost: { usd: 1.8 }, changed: ['cost'] })
  await $.tool.call({ tool: 'Read', file_path: 'a.md' })
  expect(asked).toBe(1)
  await $.session.measure({ context: { window: 200_000, percent: 10 }, rateLimits: [], cost: { usd: 2.05 }, changed: ['cost'] })
  await $.tool.call({ tool: 'Read', file_path: 'a.md' })
  expect(asked).toBe(2)
})

test('"Stop here" refuses the call and the rest of the turn without asking again', { options: { budgetUsd: 1 } }, async ($, on) => {
  let asked = 0
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('tool.call', ($, e) => {
    if (e.tool === 'AskUserQuestion') {
      asked++
      const q = e.questions[0]!.question
      return { result: { questions: e.questions, answers: { [q]: 'Stop here' } } }
    }
    return { result: 'ok' }
  })

  await $.session.measure({ context: { window: 200_000, percent: 10 }, rateLimits: [], cost: { usd: 1.5 }, changed: ['cost'] })
  expect((await $.tool.call({ tool: 'Bash', command: 'ls' })).deny).toMatch(/chose to stop/)
  expect((await $.tool.call({ tool: 'Bash', command: 'ls' })).deny).toMatch(/stopped this turn/)
  expect(asked).toBe(1)
})

test('past the budget a prompt is held once and put back in the box', { options: { budgetUsd: 1 } }, async ($, on) => {
  const filled: string[] = []
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('prompt.fill', ($, e) => (filled.push(e.text), { isFilled: true }))
  on('prompt.submit', ($, e) => ({ text: e.text }))

  await $.session.measure({ context: { window: 200_000, percent: 10 }, rateLimits: [], cost: { usd: 1.1 }, changed: ['cost'] })

  const first = await $.prompt.submit({ text: 'keep refactoring', wait: false, origin: { kind: 'composer' } })
  expect(first.drop).toMatch(/Press Enter to send it anyway \(next check at \$2\.00\)/)
  expect(filled).toEqual(['keep refactoring'])

  const second = await $.prompt.submit({ text: 'keep refactoring', wait: false, origin: { kind: 'composer' } })
  expect(second.drop).toBeUndefined()
  expect(second.text).toBe('keep refactoring')
})

test('/spend budget sets, reports and turns off the budget', async ($, on) => {
  on('session.usage', () => ({ value: usage(0.3, 5) }))
  on('ui.status', () => ({ value: undefined }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  await $.session.measure({ context: { window: 200_000, percent: 5 }, rateLimits: [], cost: { usd: 0.3 }, changed: ['cost'] })

  expect((await $.command.run({ command: 'spend', args: 'budget', ...TYPED })).text).toBe('No budget set. /spend budget 5 sets one.')
  expect((await $.command.run({ command: 'spend', args: 'budget $5', ...TYPED })).text).toBe('Budget set: $5.00 per step, next check at $5.00.')
  expect((await $.command.run({ command: 'spend', args: 'budget lots', ...TYPED })).text).toMatch(/is not an amount/)
  expect((await $.command.run({ command: 'spend', args: 'budget off', ...TYPED })).text).toBe('Budget off.')
})

test('a long turn is checked call by call, with no measurement pushed', { options: { budgetUsd: 0.5 } }, async ($, on) => {
  let now = usage(0.1, 5)
  let asked = 0
  on('session.usage', () => ({ value: now }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('tool.call', ($, e) => {
    if (e.tool === 'AskUserQuestion') {
      asked++
      const q = e.questions[0]!.question
      return { result: { questions: e.questions, answers: { [q]: 'Stop here' } } }
    }
    return { result: 'ok' }
  })

  expect((await $.tool.call({ tool: 'Bash', command: 'ls' })).deny).toBeUndefined()
  now = usage(0.7, 9)
  expect((await $.tool.call({ tool: 'Bash', command: 'ls' })).deny).toMatch(/budget/)
  expect(asked).toBe(1)
})
