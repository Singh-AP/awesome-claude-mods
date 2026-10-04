import { describe, expect, mock, test } from 'claude-code/testing'

import { clean, promptFor, wordCount } from '../hooks/tldr'

const TYPED = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } } as const
const USAGE = { input_tokens: 900, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const LONG = Array.from({ length: 260 }, (_, i) => `word${i}`).join(' ')
const SHORT = 'Done, the tests pass.'

const turn = (answer: string, extra: Record<string, unknown> = {}) => ({
  turnId: 't1',
  answer,
  durationMs: 4000,
  isAborted: false,
  reason: 'answer' as const,
  ...extra,
})

describe('helpers', () => {
  test('wordCount skips code blocks and bare symbols', () => {
    expect(wordCount('one two three')).toBe(3)
    expect(wordCount('see:\n```ts\nconst a = 1\nconst b = 2\n```\nthen - done')).toBe(3)
  })

  test('clean keeps one plain line', () => {
    expect(clean('TL;DR: **Fixed** the `parser` bug.')).toBe('Fixed the parser bug.')
    expect(clean('\n\nSummary - first line\nsecond line')).toBe('first line')
    expect(clean('"Quoted sentence."')).toBe('Quoted sentence.')
    expect(clean('   ')).toBe('')
    expect(clean('x'.repeat(400)).length).toBe(280)
  })

  test('promptFor keeps the head and the end of a huge answer', () => {
    const huge = `START ${'a'.repeat(20_000)} END`
    const prompt = promptFor(huge)
    expect(prompt).toContain('START')
    expect(prompt).toContain('END')
    expect(prompt).toContain('[…]')
    expect(prompt.length < 17_000).toBe(true)
  })
})

test('a long answer gets a TL;DR line beneath it', async ($, on) => {
  const asked: { model: string; prompt: string }[] = []
  on('model.complete', ($, e) => {
    asked.push({ model: e.model, prompt: e.prompt })
    return { value: { isAnswered: true, text: 'TL;DR: The parser now handles quoted commas.', usage: USAGE } }
  })
  on('turn.complete', ($, e) => ({ text: e.answer }))

  const out = await $.turn.complete(turn(LONG))

  expect(out.text).toBe('TL;DR: The parser now handles quoted commas.')
  expect(asked[0]?.model).toBe('haiku')
  expect(asked[0]?.prompt).toContain('word259')
})

test('short answers, subagents, interruptions and errors are left alone', async ($, on) => {
  let calls = 0
  on('model.complete', () => (calls++, { value: { isAnswered: true, text: 'x', usage: USAGE } }))
  on('turn.complete', ($, e) => ({ text: e.answer }))

  expect((await $.turn.complete(turn(SHORT))).text).toBe(SHORT)
  expect((await $.turn.complete(turn(LONG, { agentId: 'sub-1' }))).text).toBe(LONG)
  expect((await $.turn.complete(turn(LONG, { isAborted: true, reason: 'aborted' }))).text).toBe(LONG)
  expect((await $.turn.complete(turn(LONG, { reason: 'error' }))).text).toBe(LONG)
  expect(calls).toBe(0)
})

test('a failed or empty model call never touches the answer', async ($, on) => {
  let n = 0
  on('model.complete', () => {
    n++
    if (n === 1) return { value: { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded', usage: USAGE } }
    if (n === 2) return { value: { isAnswered: true, text: '  ', usage: USAGE } }
    return { deny: 'blocked model' }
  })
  on('turn.complete', ($, e) => ({ text: e.answer }))

  expect((await $.turn.complete(turn(LONG))).text).toBe(LONG)
  expect((await $.turn.complete(turn(LONG))).text).toBe(LONG)
  expect((await $.turn.complete(turn(LONG))).text).toBe(LONG)
})

test('another mod\'s line beneath the answer is kept', async ($, on) => {
  on('model.complete', () => ({ value: { isAnswered: true, text: 'Shipped it.', usage: USAGE } }))
  on('turn.complete', () => ({ text: 'Took 4s' }))

  expect((await $.turn.complete(turn(LONG))).text).toBe('Took 4s\nTL;DR: Shipped it.')
})

test('minWords and model come from the options', { options: { minWords: 20, model: 'sonnet' } }, async ($, on) => {
  const models: string[] = []
  on('model.complete', ($, e) => (models.push(e.model), { value: { isAnswered: true, text: 'Short one.', usage: USAGE } }))
  on('turn.complete', ($, e) => ({ text: e.answer }))

  expect((await $.turn.complete(turn(Array.from({ length: 25 }, () => 'word').join(' ')))).text).toBe('TL;DR: Short one.')
  expect(models).toEqual(['sonnet'])
})

test('/tldr off stops the automatic line; /tldr still works on demand', async ($, on) => {
  const saved = new Map<string, unknown>()
  on('store.get', ($, e) => ({ value: saved.get(e.key) }))
  on('store.set', ($, e) => (saved.set(e.key, e.value), { value: undefined }))
  on('model.complete', () => ({ value: { isAnswered: true, text: 'It was the cache.', usage: USAGE } }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('session.messages', () => ({
    value: [
      { role: 'user', text: 'why is it slow?', toolUses: [] },
      { role: 'assistant', text: 'Because the cache was cold...', toolUses: [] },
      { role: 'assistant', text: '', toolUses: [] },
    ],
  }))

  expect((await $.command.run({ command: 'tldr', args: 'off', ...TYPED })).text).toMatch(/tldr is off/)
  expect(saved.get('auto')).toBe(false)
  expect((await $.turn.complete(turn(LONG))).text).toBe(LONG)
  expect((await $.command.run({ command: 'tldr', args: 'status', ...TYPED })).text).toMatch(/tldr is off/)

  expect((await $.command.run({ command: 'tldr', args: '', ...TYPED })).text).toBe('TL;DR: It was the cache.')

  await $.command.run({ command: 'tldr', args: 'on', ...TYPED })
  expect((await $.turn.complete(turn(LONG))).text).toBe('TL;DR: It was the cache.')
})

test('/tldr before any answer says so', async ($, on) => {
  mock.store(on)
  on('session.messages', () => ({ value: [] }))
  expect((await $.command.run({ command: 'tldr', args: '', ...TYPED })).text).toBe('Nothing to summarize yet.')
  expect((await $.command.run({ command: 'tldr', args: 'what', ...TYPED })).text).toMatch(/^Usage/)
})

test('the off switch survives a restart', async ($, on) => {
  mock.store(on, { auto: false })
  on('command.register', () => ({ value: { command: 'tldr' } }))
  on('session.start', () => ({ cwd: '/work' }))
  let calls = 0
  on('model.complete', () => (calls++, { value: { isAnswered: true, text: 'x', usage: USAGE } }))
  on('turn.complete', ($, e) => ({ text: e.answer }))

  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  expect((await $.turn.complete(turn(LONG))).text).toBe(LONG)
  expect(calls).toBe(0)
})

test('a headless run spends no call on a line it would not print', async ($, on) => {
  mock.store(on)
  on('command.register', () => ({ value: { command: 'tldr' } }))
  on('session.start', () => ({ cwd: '/work' }))
  let calls = 0
  on('model.complete', () => (calls++, { value: { isAnswered: true, text: 'x', usage: USAGE } }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('session.messages', () => ({ value: [{ role: 'assistant', text: LONG, toolUses: [] }] }))

  await $.session.start({ cwd: '/work', surface: null, isInteractive: false })
  expect((await $.turn.complete(turn(LONG))).text).toBe(LONG)
  expect(calls).toBe(0)
  // Asked for, it still answers.
  expect((await $.command.run({ command: 'tldr', args: '', ...TYPED })).text).toBe('TL;DR: x')
})
