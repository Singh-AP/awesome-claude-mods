import type { On, RenderElement } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { indexFor, packById, pastAt, pastFor, presentFor } from '../hooks/packs'

const TYPED = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } } as const

const SPINNER = (word: string, message: string | null = null) => ({
  plugin: 'spinner-packs',
  component: 'Spinner' as const,
  requestId: 'main',
  viewport: { columns: 100, rows: 30 },
  props: { word, message, suffix: '…', mode: 'responding' as const },
})

const CLOSING = (requestId: string) => ({
  plugin: 'spinner-packs',
  component: 'TurnDuration' as const,
  requestId,
  viewport: { columns: 100, rows: 30 },
  props: { word: 'Baked', durationMs: 63_000 },
})

// Stands for what Claude Code draws: the word the chain hands down.
function engineDraws(on: On) {
  on('ui.render', ($, e) => ({
    type: 'Text' as const,
    props: {},
    children: ['word' in e.props ? String(e.props.word) : ''],
  }))
}

function startSession(on: On) {
  on('session.start', () => ({ cwd: '/work' }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
}

// The word in the drawing the engine stand-in made.
async function wordOf(ui: { drawn: () => Promise<RenderElement> }): Promise<string> {
  const tree = await ui.drawn()
  return 'children' in tree && Array.isArray(tree.children) ? String(tree.children[0]) : ''
}

const START = { cwd: '/work', surface: 'terminal', isInteractive: true } as const

test('the spinner word comes from the chosen pack on terminal and desktop', { options: { pack: 'pirate' } }, async ($, on) => {
  engineDraws(on)
  const pirate = packById('pirate')!
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...SPINNER(surface === 'desktop' ? 'Working' : 'Sauteing'), surface })
    const text = await wordOf(ui)
    expect(text).toBe(presentFor(pirate, '0:main'))
    await ui.unmount()
  }
})

test('the word holds within a turn and moves on with the next', { options: { pack: 'noir' } }, async ($, on) => {
  engineDraws(on)
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  const noir = packById('noir')!

  await $.turn.start({ turnId: 't1', text: 'hi' })
  const first = await $.ui.mount({ ...SPINNER('Sauteing'), surface: 'terminal' })
  expect(await wordOf(first)).toBe(presentFor(noir, '1:main'))
  await first.unmount()
  // Drawn again in the same turn (a resize, a redraw): the same word.
  const again = await $.ui.mount({ ...SPINNER('Sauteing'), surface: 'terminal' })
  expect(await wordOf(again)).toBe(presentFor(noir, '1:main'))
  await again.unmount()

  await $.turn.start({ turnId: 't2', text: 'more' })
  const next = await $.ui.mount({ ...SPINNER('Sauteing'), surface: 'terminal' })
  expect(await wordOf(next)).toBe(presentFor(noir, '2:main'))
})

test('a state message and the desktop step text are left alone', { options: { pack: 'chef' } }, async ($, on) => {
  engineDraws(on)
  const overridden = await $.ui.mount({ ...SPINNER('Sauteing', 'Compacting conversation'), surface: 'terminal' })
  expect(await wordOf(overridden)).toBe('Sauteing')
  const step = await $.ui.mount({ ...SPINNER('Creating notes.md'), surface: 'desktop' })
  expect(await wordOf(step)).toBe('Creating notes.md')
})

test('the closing line gets the past form', { options: { pack: 'pirate' } }, async ($, on) => {
  engineDraws(on)
  const ui = await $.ui.mount({ ...CLOSING('msg-1'), surface: 'terminal' })
  expect(await wordOf(ui)).toBe(pastFor(packById('pirate')!, 'msg-1')!)
})

test('the closing line echoes the word the spinner showed, and keeps it', { options: { pack: 'pirate' } }, async ($, on) => {
  engineDraws(on)
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  const pirate = packById('pirate')!
  await $.turn.start({ turnId: 't1', text: 'hi' })
  const spin = await $.ui.mount({ ...SPINNER('Sauteing'), surface: 'terminal' })
  const shown = await wordOf(spin)
  await spin.unmount()
  const index = indexFor(pirate, '1:main')
  expect(shown).toBe(pirate.words[index]![0])

  const line = await $.ui.mount({ ...CLOSING('msg-7'), surface: 'terminal' })
  expect(await wordOf(line)).toBe(pastAt(pirate, index)!)
  await line.unmount()

  // A later turn's spinner doesn't rewrite an earlier closing line.
  await $.turn.start({ turnId: 't2', text: 'again' })
  const later = await $.ui.mount({ ...SPINNER('Sauteing'), surface: 'terminal' })
  await later.unmount()
  const again = await $.ui.mount({ ...CLOSING('msg-7'), surface: 'terminal' })
  expect(await wordOf(again)).toBe(pastAt(pirate, index)!)
})

test('themeClosingLine: false leaves the closing line alone', { options: { pack: 'pirate', themeClosingLine: false } }, async ($, on) => {
  engineDraws(on)
  const ui = await $.ui.mount({ ...CLOSING('msg-1'), surface: 'terminal' })
  expect(await wordOf(ui)).toBe('Baked')
})

test('pack: off keeps Claude Code\'s own words', { options: { pack: 'off' } }, async ($, on) => {
  engineDraws(on)
  const ui = await $.ui.mount({ ...SPINNER('Sauteing'), surface: 'terminal' })
  expect(await wordOf(ui)).toBe('Sauteing')
})

test('custom words win, and Present|Past themes the closing line', { options: { pack: 'pirate', custom: 'Frobbing|Frobbed' } }, async ($, on) => {
  engineDraws(on)
  const spin = await $.ui.mount({ ...SPINNER('Sauteing'), surface: 'terminal' })
  expect(await wordOf(spin)).toBe('Frobbing')
  const done = await $.ui.mount({ ...CLOSING('m'), surface: 'terminal' })
  expect(await wordOf(done)).toBe('Frobbed')
})

test('random lands on one real pack for the session', async ($, on) => {
  engineDraws(on)
  const ui = await $.ui.mount({ ...SPINNER('Sauteing'), surface: 'terminal' })
  const word = await wordOf(ui)
  expect(word).not.toBe('Sauteing')
  const ids = ['pirate', 'shakespeare', 'corporate', 'wizard', 'chef', 'space', 'noir', 'genz', 'zen', 'retro']
  expect(ids.some(id => packById(id)!.words.some(([present]) => present === word))).toBe(true)
})

test('/spinner lists the packs and switches live, persisting the choice', { options: { pack: 'pirate' } }, async ($, on) => {
  engineDraws(on)
  startSession(on)
  const saved = new Map<string, unknown>()
  on('store.get', ($, e) => ({ value: saved.get(e.key) }))
  on('store.set', ($, e) => (saved.set(e.key, e.value), { value: undefined }))
  on('store.delete', ($, e) => (saved.delete(e.key), { value: undefined }))
  await $.session.start(START)

  const list = await $.command.run({ command: 'spinner', args: '', ...TYPED })
  expect(list.text).toMatch(/Spinner pack: 🏴‍☠️ pirate/)
  expect(list.text).toMatch(/noir/)
  expect(list.text).toMatch(/retro/)

  const set = await $.command.run({ command: 'spinner', args: 'Noir', ...TYPED })
  expect(set.text).toMatch(/Spinner pack: 🕵️ Noir/)
  expect(saved.get('pack')).toBe('noir')
  const ui = await $.ui.mount({ ...SPINNER('Sauteing'), surface: 'terminal' })
  expect(await wordOf(ui)).toBe(presentFor(packById('noir')!, '0:main'))
  await ui.unmount()

  const reset = await $.command.run({ command: 'spinner', args: 'reset', ...TYPED })
  expect(reset.text).toMatch(/back to your setting \(pirate\)/)
  expect(saved.has('pack')).toBe(false)

  const bad = await $.command.run({ command: 'spinner', args: 'klingon', ...TYPED })
  expect(bad.text).toMatch(/No pack named "klingon"/)
})

test('a stored choice comes back at session start', { options: { pack: 'pirate' } }, async ($, on) => {
  engineDraws(on)
  startSession(on)
  mock.store(on, { pack: 'zen' })
  await $.session.start(START)
  const ui = await $.ui.mount({ ...SPINNER('Sauteing'), surface: 'terminal' })
  expect(await wordOf(ui)).toBe(presentFor(packById('zen')!, '0:main'))
})

test('/spinner off then the spinner is Claude Code\'s again', { options: { pack: 'pirate' } }, async ($, on) => {
  engineDraws(on)
  mock.store(on)
  const off = await $.command.run({ command: 'spinner', args: 'off', ...TYPED })
  expect(off.text).toMatch(/off/)
  const ui = await $.ui.mount({ ...SPINNER('Sauteing'), surface: 'terminal' })
  expect(await wordOf(ui)).toBe('Sauteing')
})
