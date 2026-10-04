import { expect, mock, test } from 'claude-code/testing'

const TYPED = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } } as const
const SURFACES = ['terminal', 'desktop'] as const
// Stands for what the mods beneath, or Claude Code, draw in the band.
const ENGINE_BAND = () => ({ type: 'Text' as const, props: {}, children: ['drawn by another mod'] })

const BAND = {
  plugin: 'files-touched',
  component: 'AbovePrompt',
  viewport: { columns: 120, rows: 40 },
  props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 80, scroll: { offset: 0, bodyRows: 6 }, view: {} },
} as const

const PANE = {
  plugin: 'files-touched',
  component: 'Pane',
  requestId: 'files-touched',
  viewport: { columns: 160, rows: 40 },
  props: { title: 'Files touched', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const

const EDIT_OK = { result: { structuredPatch: [{ lines: ['-a', '+b', '+c'] }] } }

test('successful edits are counted, failures and other tools are not', async ($, on) => {
  mock.clock(on, { now: 1000 })
  on('session.root', () => ({ value: '/repo' }))
  on('tool.call', ($, e) => {
    if (e.tool === 'Edit' && e.file_path.endsWith('bad.ts')) return { isError: true, result: undefined, text: 'String not found' }
    if (e.tool === 'Write' && e.file_path.endsWith('nope.ts')) return { deny: 'blocked' }
    if (e.tool === 'Write') return { result: { type: 'create' } }
    return EDIT_OK
  })

  await $.tool.call({ tool: 'Edit', file_path: '/repo/src/a.ts', old_string: 'a', new_string: 'b\nc' })
  await $.tool.call({ tool: 'Edit', file_path: '/repo/src/a.ts', old_string: 'a', new_string: 'b\nc' })
  await $.tool.call({ tool: 'Write', file_path: '/repo/NOTES.md', content: 'one\ntwo\nthree\n' })
  await $.tool.call({ tool: 'Edit', file_path: '/repo/bad.ts', old_string: 'x', new_string: 'y' })
  await $.tool.call({ tool: 'Write', file_path: '/repo/nope.ts', content: 'x' })
  await $.tool.call({ tool: 'Read', file_path: '/repo/README.md' })

  const out = await $.command.run({ command: 'touched', args: '', ...TYPED })
  expect(out.text).toMatch(/^\*\*2 files changed\*\* · \+7 −2 · 3 edits/)
  expect(out.text).toMatch(/\| `src\/a\.ts` \| modified \| 2 \| \+4 \| −2 \|/)
  expect(out.text).toMatch(/\| `NOTES\.md` \| created \| 1 \| \+3 \| −0 \|/)
  expect(out.text).not.toMatch(/bad\.ts|nope\.ts|README/)
})

test('the band shows a one-liner, and keeps what other mods draw', async ($, on) => {
  mock.clock(on)
  on('session.root', () => ({ value: '/repo' }))
  on('tool.call', () => EDIT_OK)
  on('ui.render', ENGINE_BAND)

  await $.tool.call({ tool: 'Edit', file_path: '/repo/hooks/register.ts', old_string: 'a', new_string: 'b\nc' })

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Text', text: '✎ 1 file · register.ts +2 −1' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'drawn by another mod' })).toBeDefined()
    await ui.unmount()
  }
})

test('the band stays out of the way with nothing touched, or under a survey', async ($, on) => {
  mock.clock(on)
  on('session.root', () => ({ value: '/repo' }))
  on('tool.call', () => EDIT_OK)
  on('ui.render', ENGINE_BAND)

  const empty = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await empty.find({ type: 'Text', text: /✎/ })).toBeUndefined()
  await empty.unmount()

  await $.tool.call({ tool: 'Edit', file_path: '/repo/a.ts', old_string: 'a', new_string: 'b' })
  const survey = await $.ui.mount({ ...BAND, surface: 'terminal', props: { ...BAND.props, hasSurvey: true } })
  expect(await survey.find({ type: 'Text', text: /✎/ })).toBeUndefined()
})

test('band: false turns the band off', { options: { band: false } }, async ($, on) => {
  mock.clock(on)
  on('session.root', () => ({ value: '/repo' }))
  on('tool.call', () => EDIT_OK)
  on('ui.render', ENGINE_BAND)

  await $.tool.call({ tool: 'Edit', file_path: '/repo/a.ts', old_string: 'a', new_string: 'b' })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /✎/ })).toBeUndefined()
})

test('pressing a file in the pane puts an @mention in the prompt', async ($, on) => {
  mock.clock(on)
  on('session.root', () => ({ value: '/repo' }))
  on('tool.call', () => EDIT_OK)
  const filled: string[] = []
  on('prompt.fill', ($, e) => (filled.push(`${e.mode}:${e.text}`), { isFilled: true }))
  const copied: string[] = []
  on('ui.copy', ($, e) => (copied.push(e.text), { value: { isCopied: true } }))
  const toasts: string[] = []
  on('ui.toast', ($, e) => (toasts.push(e.text), { value: undefined }))

  await $.tool.call({ tool: 'Edit', file_path: '/repo/src/a.ts', old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Edit', file_path: '/repo/docs/my notes.md', old_string: 'a', new_string: 'b' })

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /^2 files · \+4 −2/ })).toBeDefined()
    await ui.press({ key: 'file:src/a.ts' })
    await ui.press({ key: 'file:docs/my notes.md' })
    await ui.press({ key: 'copy' })
    await ui.unmount()
  }
  expect(filled.slice(0, 2)).toEqual(['insert:@src/a.ts ', 'insert:@"docs/my notes.md" '])
  expect(copied[0]).toBe('docs/my notes.md\nsrc/a.ts')
  expect(toasts[0]).toBe('Copied 2 paths to the clipboard.')
})

test('/touched copy, clear and pane', async ($, on) => {
  mock.clock(on)
  on('session.root', () => ({ value: '/repo' }))
  on('tool.call', () => EDIT_OK)
  const copied: string[] = []
  on('ui.copy', ($, e) => (copied.push(e.text), { value: { isCopied: true } }))
  const opened: string[] = []
  on('ui.open', ($, e) => (opened.push(e.id), { value: { isPlaced: true } }))

  expect((await $.command.run({ command: 'touched', args: 'copy', ...TYPED })).text).toBe('No files changed yet this session.')
  await $.tool.call({ tool: 'Edit', file_path: '/repo/a.ts', old_string: 'a', new_string: 'b' })
  expect((await $.command.run({ command: 'touched', args: 'copy', ...TYPED })).text).toBe('Copied 1 path to the clipboard.')
  expect(copied).toEqual(['a.ts'])

  await $.command.run({ command: 'touched', args: 'pane', ...TYPED })
  expect(opened).toEqual(['files-touched'])

  expect((await $.command.run({ command: 'touched', args: 'clear', ...TYPED })).text).toBe('Cleared the list of touched files.')
  expect((await $.command.run({ command: 'touched', args: '', ...TYPED })).text).toBe('No files changed yet this session.')
})
