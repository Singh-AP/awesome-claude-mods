import { describe, expect, mock, test } from 'claude-code/testing'

import { expand, isValidName, listing, merged, parseSnip, placeholders, STARTERS } from '../hooks/snippets'

const TYPED = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } } as const
const snip = (args: string) => ({ command: 'snip', args, ...TYPED })

describe('expand', () => {
  test('fills placeholders and defaults', () => {
    expect(expand('On {{branch}} at {{date}}: {{args|nothing}}', { branch: 'main', date: '2026-10-04' })).toBe(
      'On main at 2026-10-04: nothing',
    )
  })

  test('drops a line whose placeholders all came out empty', () => {
    const template = 'Explain:\n{{selection}}\nThen summarize.'
    expect(expand(template, {})).toBe('Explain:\nThen summarize.')
    expect(expand(template, { selection: 'const a = 1' })).toBe('Explain:\nconst a = 1\nThen summarize.')
  })

  test('appends extra text when the template has no {{args}}', () => {
    expect(expand('Do the thing.', { args: 'carefully' })).toBe('Do the thing.\n\ncarefully')
    expect(expand('Do {{args}}.', { args: 'it' })).toBe('Do it.')
  })

  test('placeholder names are case-insensitive and spaced freely', () => {
    expect(expand('{{ Branch }}', { branch: 'dev' })).toBe('dev')
    expect([...placeholders('{{a}} {{ B | x }}')]).toEqual(['a', 'b'])
  })

  test('every starter expands cleanly with nothing filled in', () => {
    for (const [name, template] of Object.entries(STARTERS)) {
      const text = expand(template, {})
      expect(text.includes('{{')).toBe(false)
      expect(text.length > 40).toBe(true)
      expect(name.length > 0).toBe(true)
    }
  })
})

describe('parseSnip', () => {
  test('verbs', () => {
    expect(parseSnip('')).toEqual({ kind: 'list' })
    expect(parseSnip('save fix Fix the {{args}} bug')).toEqual({ kind: 'save', name: 'fix', text: 'Fix the {{args}} bug' })
    expect(parseSnip('rm fix')).toEqual({ kind: 'rm', name: 'fix' })
    expect(parseSnip('show fix')).toEqual({ kind: 'show', name: 'fix' })
    expect(parseSnip('review the auth module')).toEqual({ kind: 'use', name: 'review', extra: 'the auth module' })
  })

  test('keeps the line breaks of a saved snippet', () => {
    expect(parseSnip('save two first line\nsecond line')).toEqual({ kind: 'save', name: 'two', text: 'first line\nsecond line' })
  })

  test('refuses bad names and empty snippets', () => {
    expect(parseSnip('save list hello').kind).toBe('error')
    expect(parseSnip('save bad/name hello').kind).toBe('error')
    expect(parseSnip('save ok').kind).toBe('error')
    expect(isValidName('my-snip_2')).toBe(true)
    expect(isValidName('-dash')).toBe(false)
  })

  test('merged hides removed starters and lets own snippets win', () => {
    const all = merged({ review: 'mine' }, ['plan'])
    expect(all.review).toBe('mine')
    expect(all.plan).toBeUndefined()
    expect(all.tests).toBe(STARTERS.tests)
    expect(listing({ a: 'one' }, new Set(['a']))).toMatch(/ {2}a {2}one\n/)
  })
})

test('/snip puts the expanded snippet in an empty prompt box', async ($, on) => {
  mock.store(on, { snippets: { greet: 'Hello {{args}} on {{branch}} ({{date}})' } })
  mock.clock(on, { now: Date.UTC(2026, 9, 4, 12) })
  on('process.run', ($, e) => ({ value: { exitCode: 0, stdout: 'feature/login\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  const fills: { text: string; mode: string }[] = []
  on('prompt.fill', ($, e) => (fills.push({ text: e.text, mode: e.mode }), { isFilled: true }))
  const toasts: string[] = []
  on('ui.toast', ($, e) => (toasts.push(e.text), { value: undefined }))

  const out = await $.command.run(snip('greet world'))

  expect(out.text).toBeUndefined()
  expect(fills).toEqual([{ text: 'Hello world on feature/login (2026-10-04)', mode: 'replace' }])
  expect(toasts[0]).toMatch(/\/snip greet is in the prompt/)
})

test('/snip inserts at the cursor when the person has a draft', async ($, on) => {
  mock.store(on)
  on('ui.selection', () => ({ value: { text: 'function add(a, b) { return a - b }' } }))
  on('prompt.read', () => ({ value: { text: 'also: ', cursor: 6 } }))
  const fills: { text: string; mode: string }[] = []
  on('prompt.fill', ($, e) => (fills.push({ text: e.text, mode: e.mode }), { isFilled: true }))
  on('ui.toast', () => ({ value: undefined }))

  await $.command.run(snip('explain'))

  expect(fills[0]?.mode).toBe('insert')
  expect(fills[0]?.text).toContain('function add(a, b) { return a - b }')
  expect(fills[0]?.text).toMatch(/^Explain this code:/)
})

test('/snip shows the text where there is no prompt box', async ($, on) => {
  mock.store(on)
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('prompt.fill', () => ({ isFilled: false, refusal: 'no_composer' }))

  const out = await $.command.run(snip('plan add OAuth login'))

  expect(out.text).toMatch(/^Snippet "plan":\n\nBefore writing any code, make a plan for: add OAuth login/)
})

test('branch is left out when git has none', async ($, on) => {
  mock.store(on)
  on('process.run', () => ({ deny: 'not a repo' }))
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  const fills: string[] = []
  on('prompt.fill', ($, e) => (fills.push(e.text), { isFilled: true }))
  on('ui.toast', () => ({ value: undefined }))

  await $.command.run(snip('review'))

  expect(fills[0]).toMatch(/^Review the changes on branch the current branch:/)
})

test('save, show, list and rm round-trip through the store', async ($, on) => {
  const saved = new Map<string, unknown>()
  on('store.get', ($, e) => ({ value: saved.get(e.key) }))
  on('store.set', ($, e) => (saved.set(e.key, e.value), { value: undefined }))

  expect((await $.command.run(snip('save bugfix Fix {{args}} and add a test'))).text).toBe('Saved /snip bugfix.')
  expect((await $.command.run(snip('save bugfix Fix {{args}} with a regression test'))).text).toBe('Updated /snip bugfix.')
  expect((await $.command.run(snip('show bugfix'))).text).toBe('/snip bugfix:\n\nFix {{args}} with a regression test')

  const list = (await $.command.run(snip(''))).text ?? ''
  expect(list).toMatch(/bugfix +Fix \{\{args\}\} with a regression test\n/)
  expect(list).toMatch(/review +Review the changes .*\(starter\)/)

  expect((await $.command.run(snip('rm bugfix'))).text).toBe('Removed /snip bugfix.')
  expect((await $.command.run(snip('rm review'))).text).toBe('Removed /snip review.')
  expect(saved.get('hidden')).toEqual(['review'])
  const after = (await $.command.run(snip(''))).text ?? ''
  expect(after.includes('bugfix')).toBe(false)
  expect(after.includes('  review')).toBe(false)
  expect((await $.command.run(snip('rm nothing'))).text).toBe('No snippet named "nothing".')
})

test('an unknown name lists what exists', async ($, on) => {
  mock.store(on)
  const out = await $.command.run(snip('nope'))
  expect(out.text).toMatch(/No snippet named "nope"\. Try: commit-msg, explain, plan, review, tests\./)
})
