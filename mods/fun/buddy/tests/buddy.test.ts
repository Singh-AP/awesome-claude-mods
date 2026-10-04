import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const TYPED = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } } as const
const SURFACES = ['terminal', 'desktop'] as const

const bandProps = (bodyColumns = 100, more: { hasSurvey?: boolean; isWorking?: boolean } = {}) => ({
  hasSurvey: more.hasSurvey ?? false,
  isWorking: more.isWorking ?? false,
  maxRows: 10,
  bodyColumns,
  scroll: { offset: 0, bodyRows: 10 },
  view: {},
})

const BAND = { plugin: 'buddy', component: 'AbovePrompt', viewport: { columns: 100, rows: 40 } } as const

/** A store the test can read back, the engine stubs every buddy hook leans on, and a clock. */
function world(on: On, entries: Record<string, unknown> = {}) {
  const saved = new Map<string, unknown>(Object.entries(entries))
  on('store.get', ($, e) => ({ value: saved.get(e.key) }))
  on('store.set', ($, e) => (saved.set(e.key, e.value), { value: undefined }))
  on('store.delete', ($, e) => (saved.delete(e.key), { value: undefined }))
  const toasts: string[] = []
  on('ui.toast', ($, e) => (toasts.push(e.text), { value: undefined }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.start', () => ({ cwd: '/work' }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
  const clock = mock.clock(on)
  return { saved, toasts, clock }
}

const start = { surface: 'terminal', isInteractive: true, cwd: '/work' } as const
const turnDone = { turnId: 't1', answer: 'done', durationMs: 1000, isAborted: false, reason: 'answer' } as const

test('the band draws the pet with its name and level on every surface', async ($, on) => {
  world(on, { xp: 160 })
  await $.session.start(start)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface, props: bandProps() })
    expect(await ui.find({ type: 'Text', text: 'Byte' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Lv 3 cat/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '( o.o )   ' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /waiting for you/ })).toBeDefined()
    await ui.unmount()
  }
})

test('a commit makes the pet party and earns XP that reaches the store', async ($, on) => {
  const { saved } = world(on)
  on('tool.call', () => ({ result: { stdout: '[main abc1234] feat: x', stderr: '', interrupted: false }, text: '[main abc1234] feat: x' }))
  await $.session.start(start)
  await $.turn.start({ text: 'commit it', turnId: 't1' })
  await $.tool.call({ tool: 'Bash', command: 'git commit -m "feat: x"' })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal', props: bandProps(100, { isWorking: true }) })
  expect(await ui.find({ type: 'Text', text: '🎉 committed!' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '( ^o^ )   ' })).toBeDefined()

  await $.turn.complete(turnDone)
  // 1 for the call, 20 for the commit, 5 for the turn.
  expect(saved.get('xp')).toBe(26)
  expect(saved.get('stats')).toEqual({ toolCalls: 1, turns: 1, commits: 1, greenTests: 0, errors: 0 })
})

test('a failing tool startles the pet, then it settles back down', async ($, on) => {
  const { clock } = world(on)
  on('tool.call', () => ({ isError: true, result: 'boom', text: 'boom' }))
  await $.session.start(start)
  await $.turn.start({ text: 'build', turnId: 't1' })
  await $.tool.call({ tool: 'Bash', command: 'make' })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal', props: bandProps(100, { isWorking: true }) })
  expect(await ui.find({ type: 'Text', text: '😵 Bash failed' })).toBeDefined()
  await clock.advance(4000)
  expect(await ui.find({ type: 'Text', text: /thinking/ })).toBeDefined()
})

test('levelling up toasts the news', async ($, on) => {
  const { toasts } = world(on, { xp: 45 })
  on('tool.call', () => ({ result: 'ok', text: 'ok' }))
  await $.session.start(start)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.call({ tool: 'Read', file_path: 'a.ts' })
  await $.turn.complete(turnDone)
  expect(toasts).toContain('🎉 Byte reached level 2!')
})

test('a quiet pet falls asleep, and nothing ticks while it sleeps', async ($, on) => {
  const { clock } = world(on)
  await $.session.start(start)
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await $.turn.complete(turnDone)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal', props: bandProps() })
  expect(await ui.find({ type: 'Text', text: /waiting for you/ })).toBeDefined()
  await clock.advance(121_000)
  expect(await ui.find({ type: 'Text', text: /napping/ })).toBeDefined()
  const asleep = JSON.stringify(await ui.drawn())
  await clock.advance(10_000)
  expect(JSON.stringify(await ui.drawn())).toBe(asleep)
})

test('the name, species and nap time follow the options', { options: { name: 'Pixel', species: 'ghost', sleepAfterSeconds: 30 } }, async ($, on) => {
  const { clock } = world(on)
  await $.session.start(start)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop', props: bandProps() })
  expect(await ui.find({ type: 'Text', text: 'Pixel' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /ghost/ })).toBeDefined()
  await clock.advance(31_000)
  expect(await ui.find({ type: 'Text', text: /napping/ })).toBeDefined()
})

test('/buddy renames, re-species, hides and shows the pet', async ($, on) => {
  const { saved } = world(on)
  await $.session.start(start)

  expect((await $.command.run({ command: 'buddy', args: 'name Mochi', ...TYPED })).text).toBe('Your cat is now called Mochi.')
  expect((await $.command.run({ command: 'buddy', args: 'species robot', ...TYPED })).text).toBe('Mochi is a robot now.')
  expect((await $.command.run({ command: 'buddy', args: 'species dragon', ...TYPED })).text).toMatch(/Pick one of/)
  expect(saved.get('name')).toBe('Mochi')
  expect(saved.get('species')).toBe('robot')

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal', props: bandProps() })
  expect(await ui.find({ type: 'Text', text: 'Mochi' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\[ \^w\^ \]/ })).toBeDefined()

  await $.command.run({ command: 'buddy', args: 'hide', ...TYPED })
  expect(await ui.find({ type: 'Text', text: 'drawn by Claude Code' })).toBeDefined()
  expect(saved.get('hidden')).toBe(true)
  await $.command.run({ command: 'buddy', args: 'show', ...TYPED })
  expect(await ui.find({ type: 'Text', text: 'Mochi' })).toBeDefined()
})

test('/buddy shows a stats card with lifetime counts', async ($, on) => {
  world(on, { xp: 320, stats: { toolCalls: 300, turns: 4, commits: 0, greenTests: 0, errors: 2 } })
  await $.session.start(start)
  const card = (await $.command.run({ command: 'buddy', args: '', ...TYPED })).text ?? ''
  expect(card).toMatch(/Byte the cat · level 4/)
  expect(card).toMatch(/320\/500 XP to level 5/)
  expect(card).toMatch(/300 tool calls · 4 turns · 0 commits/)
  expect(card).toMatch(/0 green test runs · 2 oopsies/)
  expect(card.split('\n')[0]).toBe('Byte the cat · level 4')
})

test('the pet steps aside for a survey and for narrow bands draws one line', async ($, on) => {
  world(on)
  await $.session.start(start)
  const survey = await $.ui.mount({ ...BAND, surface: 'terminal', props: bandProps(100, { hasSurvey: true }) })
  expect(await survey.find({ type: 'Text', text: 'drawn by Claude Code' })).toBeDefined()
  await survey.unmount()

  const narrow = await $.ui.mount({ ...BAND, surface: 'terminal', props: bandProps(36) })
  expect(await narrow.find({ type: 'Text', text: '( o.o )' })).toBeDefined()
  expect(await narrow.find({ type: 'Text', text: /XP/ })).toBeUndefined()
})

test('after /clear the pet remembers who it is', async ($, on) => {
  world(on, { name: 'Nori', species: 'duck', xp: 60 })
  on('classic.SessionStart', () => ({}))
  await $.classic.SessionStart({ source: 'clear' })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal', props: bandProps() })
  expect(await ui.find({ type: 'Text', text: 'Nori' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Lv 2 duck/ })).toBeDefined()
})

test('the pet animates while a tool runs, and stops once it is done', async ($, on) => {
  const { clock } = world(on)
  on('tool.call', async () => {
    await clock.sleep(5000)
    return { result: 'ok', text: 'ok' }
  })
  await $.session.start(start)
  await $.turn.start({ text: 'read', turnId: 't1' })
  const running = $.tool.call({ tool: 'Read', file_path: '/repo/src/index.ts' })
  await clock.settle()

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal', props: bandProps(100, { isWorking: true }) })
  expect(await ui.find({ type: 'Text', text: '📖 reading index.ts' })).toBeDefined()
  const first = JSON.stringify(await ui.drawn())
  await clock.advance(500)
  const second = JSON.stringify(await ui.drawn())
  expect(second).not.toBe(first)

  await clock.advance(5000)
  await running
  await $.turn.complete(turnDone)
  const idle = JSON.stringify(await ui.drawn())
  await clock.advance(1500)
  expect(JSON.stringify(await ui.drawn())).toBe(idle)
})
