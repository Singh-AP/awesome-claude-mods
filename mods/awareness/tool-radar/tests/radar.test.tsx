import { expect, mock, test } from 'claude-code/testing'

const BASH_OK = { result: { stdout: 'ok', stderr: '', interrupted: false } }
const TYPED = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } } as const
const SURFACES = ['terminal', 'desktop'] as const

const PANE = {
  plugin: 'tool-radar',
  component: 'Pane',
  requestId: 'tool-radar',
  viewport: { columns: 160, rows: 40 },
  props: {
    title: 'Tool radar',
    isFocused: true,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

test('each call is timed and its outcome kept', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  on('tool.call', async ($, e) => {
    if (e.tool === 'Bash' && e.command === 'npm test') {
      await clock.sleep(1500)
      return BASH_OK
    }
    if (e.tool === 'Bash') return { deny: 'not allowed' }
    return { isError: true, result: undefined, text: 'File does not exist.' }
  })

  const slow = $.tool.call({ tool: 'Bash', command: 'npm test' })
  await clock.advance(1500)
  await slow
  await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  await $.tool.call({ tool: 'Read', file_path: '/repo/missing.ts' })

  const out = await $.command.run({ command: 'radar', args: 'summary', ...TYPED })
  expect(out.text).toMatch(/^3 calls · 1 failed · 1 denied · avg 500ms/)
  expect(out.text).toMatch(/By tool: Bash 2 · Read 1/)
  expect(out.text).toMatch(/⊘ Bash rm -rf build — not allowed/)
  expect(out.text).toMatch(/✗ Read repo\/missing.ts — File does not exist\./)
  expect(out.text).toMatch(/1\.5s {2}Bash npm test/)
})

test('a call that throws is kept as failed and still throws', async ($, on) => {
  mock.clock(on)
  on('tool.call', () => {
    throw new Error('boom')
  })

  let threw = false
  try {
    await $.tool.call({ tool: 'Bash', command: 'make' })
  } catch {
    threw = true
  }
  expect(threw).toBe(true)
  const out = await $.command.run({ command: 'radar', args: 'summary', ...TYPED })
  expect(out.text).toMatch(/✗ Bash make — interrupted/)
})

test('the pane lists calls newest first, filters errors and clears', async ($, on) => {
  mock.clock(on)
  on('tool.call', ($, e) => (e.tool === 'Bash' && e.command === 'false' ? { isError: true, result: undefined, text: 'exit 1' } : BASH_OK))
  on('ui.close', () => ({ value: undefined }))

  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.tool.call({ tool: 'Bash', command: 'false' })
  await $.tool.call({ tool: 'Edit', file_path: '/r/a.ts', old_string: 'a', new_string: 'b' })

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /^3 calls · 1 failed/ })).toBeDefined()
    const drawn = JSON.stringify(await ui.drawn())
    expect(drawn.indexOf('a.ts')).toBeLessThan(drawn.indexOf(' ls '))
    expect(drawn.indexOf(' ls ')).toBeGreaterThan(0)

    await ui.press({ key: 'errors' })
    expect(await ui.find({ type: 'Text', text: /false — exit 1/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /a\.ts/ })).toBeUndefined()
    await ui.press({ key: 'errors' })
    expect(await ui.find({ type: 'Text', text: /a\.ts/ })).toBeDefined()
    await ui.unmount()
  }

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'clear' })
  expect(await ui.find({ type: 'Text', text: /No tool calls yet/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^0 calls/ })).toBeDefined()
})

test('a main-loop call carries no subagent marker', async ($, on) => {
  mock.clock(on)
  on('tool.call', () => BASH_OK)

  await $.tool.call({ tool: 'Bash', command: 'ls' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^Bash +ls/ })).toBeDefined()
})

test('/radar opens the pane, and says so when it has to wait', async ($, on) => {
  const opened: string[] = []
  let placed = true
  on('ui.open', ($, e) => {
    opened.push(e.id)
    return { value: placed ? { isPlaced: true } : { isPlaced: false, reason: 'the terminal is too narrow' } }
  })

  expect((await $.command.run({ command: 'radar', args: '', ...TYPED })).text).toBeUndefined()
  placed = false
  expect((await $.command.run({ command: 'radar', args: '', ...TYPED })).text).toMatch(/waiting for room/)
  expect(opened).toEqual(['tool-radar', 'tool-radar'])
})

test('autoOpen opens the pane at session start', { options: { autoOpen: true } }, async ($, on) => {
  const opened: string[] = []
  on('command.register', () => ({ value: { command: 'radar' } }))
  on('ui.open', ($, e) => (opened.push(e.id), { value: { isPlaced: true } }))
  on('session.start', () => ({ cwd: '/work' }))

  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  expect(opened).toEqual(['tool-radar'])
})

test('without autoOpen the session starts with no pane', async ($, on) => {
  const opened: string[] = []
  const registered: string[] = []
  on('command.register', ($, e) => (registered.push(e.name), { value: { command: e.name } }))
  on('ui.open', ($, e) => (opened.push(e.id), { value: { isPlaced: true } }))
  on('session.start', () => ({ cwd: '/work' }))

  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  expect(registered).toEqual(['radar'])
  expect(opened).toEqual([])
})
