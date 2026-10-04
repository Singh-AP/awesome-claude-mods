import { describe, expect, mock, test } from 'claude-code/testing'

import { clip, focusPrompt, formatDuration, parseFocus } from '../hooks/format'

const TYPED = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } } as const
const MINUTE = 60_000
const START = Date.UTC(2026, 9, 4, 9, 0)

const BAND = {
  plugin: 'aim',
  component: 'AbovePrompt',
  viewport: { columns: 100, rows: 30 },
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

const COMPOSE = {
  model: 'claude-test',
  promptModel: 'claude-test',
  surfaces: ['terminal'],
  tools: ['Bash'],
  outputStyle: null,
  traits: [],
} as const

describe('helpers', () => {
  test('formatDuration', () => {
    expect(formatDuration(10_000)).toBe('<1m')
    expect(formatDuration(12 * MINUTE)).toBe('12m')
    expect(formatDuration(65 * MINUTE)).toBe('1h 05m')
    expect(formatDuration(51 * 60 * MINUTE)).toBe('2d 3h')
    expect(formatDuration(-5)).toBe('<1m')
  })

  test('clip', () => {
    expect(clip('short', 20)).toBe('short')
    expect(clip('a   very\nlong goal text', 10)).toBe('a very lo…')
  })

  test('parseFocus', () => {
    expect(parseFocus('')).toEqual({ kind: 'show' })
    expect(parseFocus(' Done ')).toEqual({ kind: 'done' })
    expect(parseFocus('clear')).toEqual({ kind: 'clear' })
    expect(parseFocus('history')).toEqual({ kind: 'history' })
    expect(parseFocus('fix  the\nlogin bug')).toEqual({ kind: 'set', goal: 'fix the login bug' })
  })

  test('focusPrompt names the goal and asks to flag unrelated work', () => {
    const text = focusPrompt('ship the parser')
    expect(text).toContain('"ship the parser"')
    expect(text).toMatch(/mention it in one line/)
  })
})

test('/aim sets a goal that rides in the system prompt', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: START })
  on('session.root', () => ({ value: '/work/app' }))
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'You are Claude Code.', scope: 'shared' }] }))

  const before = await $.prompt.compose(COMPOSE)
  expect(before.sections.map(s => s.id)).toEqual(['intro'])

  const set = await $.command.run({ command: 'aim', args: 'fix the login redirect', ...TYPED })
  expect(set.text).toMatch(/Aim set: "fix the login redirect"/)

  const after = await $.prompt.compose(COMPOSE)
  const section = after.sections.at(-1)
  expect(section?.id).toBe('aim:goal')
  expect(section?.scope).toBe('session')
  expect(section?.text).toContain('fix the login redirect')
})

test('/aim done records the goal, toasts the time and leaves the prompt', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: START })
  on('session.root', () => ({ value: '/work/app' }))
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'x', scope: 'shared' }] }))
  const toasts: string[] = []
  on('ui.toast', ($, e) => (toasts.push(e.text), { value: undefined }))

  await $.command.run({ command: 'aim', args: 'write the parser', ...TYPED })
  await clock.advance(34 * MINUTE)
  const shown = await $.command.run({ command: 'aim', args: '', ...TYPED })
  expect(shown.text).toMatch(/"write the parser" \(34m so far\)/)

  const done = await $.command.run({ command: 'aim', args: 'done', ...TYPED })
  expect(done.text).toBe('Done: "write the parser" in 34m.')
  expect(toasts).toEqual(['Aim done in 34m 🎉'])

  const after = await $.prompt.compose(COMPOSE)
  expect(after.sections.map(s => s.id)).toEqual(['intro'])

  const listed = await $.command.run({ command: 'aim', args: 'history', ...TYPED })
  expect(listed.text).toMatch(/2026-10-04 +34m +write the parser/)
})

test('/aim with nothing set explains the commands', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: START })
  on('session.root', () => ({ value: '/work/app' }))

  const shown = await $.command.run({ command: 'aim', args: '', ...TYPED })
  expect(shown.text).toMatch(/No aim is set\. Usage/)
  const done = await $.command.run({ command: 'aim', args: 'done', ...TYPED })
  expect(done.text).toMatch(/No aim is set/)
})

test('the band shows the goal and elapsed time, and Done clears it', async ($, on) => {
  const saved = new Map<string, unknown>()
  on('store.get', ($, e) => ({ value: saved.get(e.key) }))
  on('store.set', ($, e) => (saved.set(e.key, e.value), { value: undefined }))
  on('store.delete', ($, e) => (saved.delete(e.key), { value: undefined }))
  const clock = mock.clock(on, { now: START })
  on('session.root', () => ({ value: '/work/app' }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['below'] }))

  await $.command.run({ command: 'aim', args: 'ship v2', ...TYPED })
  await clock.advance(12 * MINUTE)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Text', text: /🎯 ship v2 · 12m/ })).toBeDefined()
    // The mods drawn after this one keep their place in the band.
    expect(await ui.find({ type: 'Text', text: 'below' })).toBeDefined()
    expect(await ui.find({ key: 'done' })).toBeDefined()
    await ui.unmount()
  }

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'done' })
  expect(saved.get('goal:/work/app')).toBeUndefined()
  expect((saved.get('history') as unknown[]).length).toBe(1)
  expect(await ui.find({ type: 'Text', text: /🎯/ })).toBeUndefined()
})

test('the band stays out of the way with no goal or during a survey', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: START })
  on('session.root', () => ({ value: '/work/app' }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['engine'] }))

  const empty = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await empty.find({ type: 'Text', text: /🎯/ })).toBeUndefined()
  await empty.unmount()

  await $.command.run({ command: 'aim', args: 'x', ...TYPED })
  const survey = await $.ui.mount({ ...BAND, surface: 'terminal', props: { ...BAND.props, hasSurvey: true } })
  expect(await survey.find({ type: 'Text', text: /🎯/ })).toBeUndefined()
})

test('a saved goal comes back at session start and after /clear', async ($, on) => {
  mock.store(on, { 'goal:/work/app': { text: 'migrate the db', startedAt: START } })
  mock.clock(on, { now: START + 5 * MINUTE })
  on('session.root', () => ({ value: '/work/app' }))
  on('command.register', () => ({ value: { command: 'aim' } }))
  on('session.start', () => ({ cwd: '/work/app' }))
  on('classic.SessionStart', () => ({}))
  on('ui.render', () => ({ type: 'Text', props: {}, children: [''] }))

  await $.session.start({ cwd: '/work/app', surface: null, isInteractive: false })
  const shown = await $.command.run({ command: 'aim', args: '', ...TYPED })
  expect(shown.text).toMatch(/"migrate the db" \(5m so far\)/)

  await $.classic.SessionStart({ source: 'clear' })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /🎯 migrate the db/ })).toBeDefined()
})

test('goals are kept per project', async ($, on) => {
  mock.store(on, { 'goal:/work/other': { text: 'someone else', startedAt: START } })
  mock.clock(on, { now: START })
  on('session.root', () => ({ value: '/work/app' }))
  on('classic.SessionStart', () => ({}))

  await $.classic.SessionStart({ source: 'clear' })
  const shown = await $.command.run({ command: 'aim', args: '', ...TYPED })
  expect(shown.text).toMatch(/No aim is set/)
})
