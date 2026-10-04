import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { emptyTally, type Tally } from '../hooks/stats'

const TYPED = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } } as const
const SURFACES = ['terminal', 'desktop'] as const
// A Sunday at 11pm local time, so the persona has an hour to go on.
const NOW = new Date(2026, 9, 4, 23, 0).getTime()

const PANE = {
  plugin: 'wrapped',
  component: 'Pane',
  requestId: 'wrapped',
  viewport: { columns: 120, rows: 40 },
  props: { title: 'Wrapped', isFocused: true, bodyColumns: 64, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

function world(on: On, entries: Record<string, unknown> = {}, cost = { usd: 0 }) {
  const saved = new Map<string, unknown>(Object.entries(entries))
  on('store.get', ($, e) => ({ value: saved.get(e.key) }))
  on('store.set', ($, e) => (saved.set(e.key, e.value), { value: undefined }))
  on('store.delete', ($, e) => (saved.delete(e.key), { value: undefined }))
  on('store.keys', () => ({ value: [...saved.keys()] }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.start', () => ({ cwd: '/work/my-app' }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.root', () => ({ value: '/work/my-app' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [], cost } }))
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('turn.complete', () => ({ text: '' }))
  const toasts: string[] = []
  on('ui.toast', ($, e) => (toasts.push(e.text), { value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  const copied: string[] = []
  on('ui.copy', ($, e) => (copied.push(e.text), { value: { isCopied: true } }))
  const clock = mock.clock(on, { now: NOW })
  return { saved, toasts, copied, clock }
}

const start = { surface: 'terminal', isInteractive: true, cwd: '/work/my-app' } as const
const turn = (durationMs: number, agentId?: string) =>
  ({ turnId: 't', answer: 'ok', durationMs, isAborted: false, reason: 'answer', ...(agentId === undefined ? {} : { agentId }) }) as const

const bash = (text: string) => ({ result: { stdout: text, stderr: '', interrupted: false }, text })

test('a session is counted into its own record', async ($, on) => {
  const { saved } = world(on)
  on('tool.call', ($, e) => {
    if (e.tool === 'Bash' && e.command === 'make') return { isError: true, result: 'boom', text: 'boom' }
    if (e.tool === 'Bash') return bash('[main abc1234] feat: x')
    return { result: 'ok', text: 'ok' }
  })
  await $.session.start(start)
  await $.prompt.submit({ text: 'ship it', wait: false, origin: { kind: 'composer' } })
  await $.tool.call({ tool: 'Edit', file_path: '/work/my-app/a.ts', old_string: 'a', new_string: 'b\nc\nd', replace_all: false })
  await $.tool.call({ tool: 'Write', file_path: '/work/my-app/b.ts', content: 'x\ny\n' })
  await $.tool.call({ tool: 'Bash', command: 'git commit -m "feat: x"' })
  await $.tool.call({ tool: 'Bash', command: 'make' })
  await $.turn.complete(turn(90_000))
  await $.turn.complete(turn(5_000, 'agent-1'))

  const record = saved.get('s:sess-1') as Tally
  expect(record).toMatchObject({ sessions: 1, prompts: 1, turns: 1, turnMs: 90_000, lines: 5, commits: 1, failed: 1 })
  expect(record.tools).toEqual({ Edit: 1, Write: 1, Bash: 2 })
  expect(record.files.length).toBe(2)
  expect(record.days).toEqual({ '2026-10-04': 1 })
  expect(record.projects).toEqual({ 'my-app': 1 })
  expect(record.hours[23]).toBe(1)
  // No paths are kept, only hashes.
  expect(JSON.stringify(record)).not.toMatch(/a\.ts/)
})

test('prompts from plugins and notifications are not counted as yours', async ($, on) => {
  const { saved } = world(on)
  await $.session.start(start)
  await $.prompt.submit({ text: 'from a plugin', wait: false, origin: { kind: 'plugin', name: 'x' } })
  await $.prompt.submit({ text: 'task done', wait: false, origin: { kind: 'task-notification' } })
  await $.turn.complete(turn(1000))
  expect((saved.get('s:sess-1') as Tally).prompts).toBe(0)
})

test('cost counts what the ledger added, even across a reload', async ($, on) => {
  const stored = { ...emptyTally(NOW), sessions: 1, cost: 1, costSeen: 1 }
  const { saved } = world(on, { 's:sess-1': stored }, { usd: 1.75 })
  await $.session.start(start)
  await $.turn.complete(turn(1000))
  const record = saved.get('s:sess-1') as Tally
  expect(record.cost).toBe(1.75)
  expect(record.costSeen).toBe(1.75)
})

test('/wrapped text prints a share card for this year, another year or all time', async ($, on) => {
  const old = { ...emptyTally(new Date(2025, 5, 1).getTime()), sessions: 1, prompts: 100, tools: { Read: 40 } }
  const recent = { ...emptyTally(NOW), sessions: 1, prompts: 7, tools: { Bash: 3 } }
  world(on, { 's:old': old, 's:recent': recent })
  await $.session.start(start)

  const thisYear = (await $.command.run({ command: 'wrapped', args: 'text', ...TYPED })).text ?? ''
  expect(thisYear).toMatch(/Claude Code Wrapped · 2026/)
  // The session asking counts too.
  expect(thisYear).toMatch(/7 prompts · 2 sessions/)
  expect(thisYear).toMatch(/github\.com\/Singh-AP\/awesome-claude-mods/)

  const lastYear = (await $.command.run({ command: 'wrapped', args: 'text 2025', ...TYPED })).text ?? ''
  expect(lastYear).toMatch(/100 prompts/)

  const lifetime = (await $.command.run({ command: 'wrapped', args: 'text all', ...TYPED })).text ?? ''
  expect(lifetime).toMatch(/all time/)
  expect(lifetime).toMatch(/107 prompts · 3 sessions/)

  expect((await $.command.run({ command: 'wrapped', args: 'text soon', ...TYPED })).text).toMatch(/Usage/)
})

test('/wrapped opens the card on every surface and copies the share card', async ($, on) => {
  const hours = Array.from({ length: 24 }, (_, i) => (i === 23 ? 30 : 0))
  const year = { ...emptyTally(NOW), sessions: 12, prompts: 1284, turns: 300, turnMs: 96 * 3_600_000, tools: { Bash: 60, Edit: 40, Read: 30 }, lines: 41_200, commits: 128, hours, days: { '2026-10-03': 3, '2026-10-04': 2 }, projects: { 'api-server': 50 }, cost: 41.2 }
  const { copied, toasts } = world(on, { 's:year': year })
  await $.session.start(start)
  expect(await $.command.run({ command: 'wrapped', args: '', ...TYPED })).toEqual({})

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /CLAUDE CODE WRAPPED · 2026/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '🦉 The Night Owl' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '1,284' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '41,200' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Bash' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /2-day streak/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /top project api-server/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\$41\.20 of tokens/ })).toBeDefined()
    await ui.press({ key: 'copy' })
    await ui.unmount()
  }
  expect(copied.length).toBe(2)
  expect(copied[0]).toMatch(/🦉 The Night Owl/)
  expect(copied[0]).not.toMatch(/\$41/)
  expect(toasts[0]).toMatch(/copied/)
})

test('the card says so when there is nothing yet', async ($, on) => {
  world(on)
  await $.session.start(start)
  await $.command.run({ command: 'wrapped', args: '', ...TYPED })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Nothing counted yet/ })).toBeDefined()
  expect(await ui.find({ key: 'close' })).toBeDefined()
})

test('shareCost puts the cost on the card', { options: { shareCost: true } }, async ($, on) => {
  world(on, { 's:x': { ...emptyTally(NOW), sessions: 1, prompts: 2, cost: 3.5 } })
  await $.session.start(start)
  expect((await $.command.run({ command: 'wrapped', args: 'text', ...TYPED })).text).toMatch(/\$3\.50 of tokens/)
})

test('old session records fold into one record per year', async ($, on) => {
  const entries: Record<string, unknown> = {}
  for (let i = 0; i < 125; i++) entries[`s:${i}`] = { ...emptyTally(NOW - (200 - i) * 60_000), lastAt: NOW - (200 - i) * 60_000, sessions: 1, prompts: 1 }
  const { saved } = world(on, entries)
  await $.session.start(start)
  const sessions = [...saved.keys()].filter(k => k.startsWith('s:'))
  expect(sessions.length).toBe(60)
  expect((saved.get('y:2026') as Tally).sessions).toBe(65)
  // Nothing is lost in the fold; the session asking adds one.
  expect((await $.command.run({ command: 'wrapped', args: 'text', ...TYPED })).text).toMatch(/125 prompts · 126 sessions/)
})

test('/wrapped reset wipes only once you confirm', async ($, on) => {
  const { saved } = world(on, { 's:x': { ...emptyTally(NOW), sessions: 1, prompts: 5 } })
  let answer = 'Keep them'
  on('tool.call', ($, e) => {
    if (e.tool !== 'AskUserQuestion') return { result: 'ok' }
    const question = e.questions[0]!.question
    return { result: { questions: e.questions, answers: { [question]: answer } } }
  })
  await $.session.start(start)
  expect((await $.command.run({ command: 'wrapped', args: 'reset', ...TYPED })).text).toMatch(/kept/)
  expect(saved.has('s:x')).toBe(true)
  answer = 'Wipe my stats'
  expect((await $.command.run({ command: 'wrapped', args: 'reset', ...TYPED })).text).toMatch(/wiped/)
  expect(saved.size).toBe(0)
})
