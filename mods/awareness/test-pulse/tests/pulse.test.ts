import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const TYPED = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } } as const
const START = { cwd: '/work', surface: 'terminal', isInteractive: true } as const

const GREEN = 'ℹ tests 2\nℹ pass 2\nℹ fail 0\n'
const RED = '✖ divides (1ms)\nℹ tests 2\nℹ pass 1\nℹ fail 1\n'

// Answers Bash with the given output; `null` for a failed exit.
function shell(on: On, outputs: Array<{ text: string; ok: boolean }>) {
  on('tool.call', ($, e) => {
    if (e.tool !== 'Bash') return { result: { filePath: 'x' } }
    const next = outputs.shift() ?? { text: '', ok: true }
    return next.ok
      ? { result: { stdout: next.text, stderr: '', interrupted: false }, text: next.text }
      : { isError: true as const, result: next.text, text: `Exit code 1\n${next.text}` }
  })
}

function ui(on: On) {
  const statuses: (string | undefined)[] = []
  const toasts: string[] = []
  on('ui.status', ($, e) => (statuses.push(e.text), { value: undefined }))
  on('ui.toast', ($, e) => (toasts.push(e.text), { value: undefined }))
  return { statuses, toasts }
}

test('a green run shows in the status line', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  const seen = ui(on)
  shell(on, [{ text: GREEN, ok: true }])

  await $.tool.call({ tool: 'Bash', command: 'node --test' })

  expect(seen.statuses.at(-1)).toBe('🧪 ✅ 2/2 passing · just now')
  expect(seen.toasts).toEqual([])
})

test('green to red and back toasts both ways, and other commands are ignored', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const seen = ui(on)
  shell(on, [{ text: 'hi', ok: true }, { text: GREEN, ok: true }, { text: RED, ok: false }, { text: GREEN, ok: true }])

  await $.tool.call({ tool: 'Bash', command: 'echo hi' })
  expect(seen.statuses).toEqual([])

  await $.tool.call({ tool: 'Bash', command: 'node --test' })
  await $.tool.call({ tool: 'Bash', command: 'node --test' })
  expect(seen.statuses.at(-1)).toBe('🧪 ❌ 1/2 passing · just now')
  expect(seen.toasts).toEqual(['tests went red: 1 failing · divides'])

  await $.tool.call({ tool: 'Bash', command: 'node --test' })
  expect(seen.toasts.at(-1)).toBe('tests are green again 🎉 (2 passing)')
})

test('the status ages once a minute', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const seen = ui(on)
  shell(on, [{ text: GREEN, ok: true }])

  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  await clock.advance(3 * 60_000)

  expect(seen.statuses.at(-1)).toBe('🧪 ✅ 2/2 passing · 3m ago')
})

test('/tests shows history and spots a flake; edits in between clear suspicion', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  ui(on)
  shell(on, [{ text: RED, ok: false }, { text: GREEN, ok: true }])

  await $.tool.call({ tool: 'Bash', command: 'node --test' })
  await $.tool.call({ tool: 'Bash', command: 'node --test' })
  const out = await $.command.run({ command: 'tests', args: '', ...TYPED })

  expect(out.text).toMatch(/Last 2 runs · pass rate ▅█/)
  expect(out.text).toMatch(/Possibly flaky .*divides/)
})

test('an edit between the red and the green run is a fix, not a flake', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  ui(on)
  shell(on, [{ text: RED, ok: false }, { text: GREEN, ok: true }])

  await $.tool.call({ tool: 'Bash', command: 'node --test' })
  await $.tool.call({ tool: 'Edit', file_path: 'a.js', old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Bash', command: 'node --test' })
  const out = await $.command.run({ command: 'tests', args: '', ...TYPED })

  expect(out.text).not.toMatch(/flaky/)
})

test('a run with no summary counts by exit status', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const seen = ui(on)
  shell(on, [{ text: 'boom', ok: false }])

  await $.tool.call({ tool: 'Bash', command: 'make test' })

  expect(seen.statuses.at(-1)).toBe('🧪 ❌ tests failed · just now')
})

test('history comes back at session start, per project, and /tests clear wipes it', async ($, on) => {
  mock.clock(on, { now: 10 * 60_000 })
  const saved = new Map<string, unknown>([['runs:/work', [{ at: 0, runner: 'pytest', command: 'pytest', counted: true, passed: 8, failed: 0, skipped: 0, ok: true, failing: [], epoch: 'old:0' }]]])
  on('store.get', ($, e) => ({ value: saved.get(e.key) }))
  on('store.set', ($, e) => (saved.set(e.key, e.value), { value: undefined }))
  on('store.delete', ($, e) => (saved.delete(e.key), { value: undefined }))
  on('session.root', () => ({ value: '/work' }))
  on('session.start', () => ({ cwd: '/work' }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  const seen = ui(on)

  await $.session.start(START)
  expect(seen.statuses.at(-1)).toBe('🧪 ✅ 8/8 passing · 10m ago')

  const cleared = await $.command.run({ command: 'tests', args: 'clear', ...TYPED })
  expect(cleared.text).toMatch(/cleared/)
  expect(saved.has('runs:/work')).toBe(false)
  expect(seen.statuses.at(-1)).toBeUndefined()
})

test('a denied or backgrounded test run is not recorded', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const seen = ui(on)
  on('tool.call', ($, e) => (e.tool === 'Bash' && e.command === 'npm test' ? { deny: 'nope' } : { result: { stdout: GREEN, stderr: '', interrupted: false } }))

  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  await $.tool.call({ tool: 'Bash', command: 'pytest', run_in_background: true })

  expect(seen.statuses).toEqual([])
})
