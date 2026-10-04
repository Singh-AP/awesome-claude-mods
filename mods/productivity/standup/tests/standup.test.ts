import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { Entry } from '../hooks/journal'

const TYPED = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } } as const
const USAGE = { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

const at = (y: number, m: number, d: number, h = 9, min = 0) => new Date(y, m - 1, d, h, min).getTime()

type World = { store: Map<string, unknown>; asked: { system?: string; prompt: string }[]; copied: string[] }

/** Stubs the world beneath the mod; `reply` answers the model, null fails it. */
function world(on: On, reply: string | null = 'Yesterday\n- Fixed it.', seed: Record<string, unknown> = {}): World {
  const w: World = { store: new Map(Object.entries(seed)), asked: [], copied: [] }
  on('store.get', ($, e) => ({ value: w.store.get(e.key) }))
  on('store.set', ($, e) => (w.store.set(e.key, e.value), { value: undefined }))
  on('store.delete', ($, e) => (w.store.delete(e.key), { value: undefined }))
  on('store.keys', () => ({ value: [...w.store.keys()] }))
  on('session.repo', () => ({ value: { root: '/work/api', remote: null, internal: false, name: null } }))
  on('session.root', () => ({ value: '/work/api' }))
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', ($, e) => {
    if (e.tool === 'Bash' && e.command.startsWith('git commit')) {
      return { result: { stdout: '', stderr: '', interrupted: false }, text: '[main 1a2b3c4] Fix login redirect\n 1 file changed' }
    }
    if (e.tool === 'Write' && e.file_path.endsWith('broken.ts')) return { isError: true, result: 'disk full', text: 'disk full' }
    return { result: 'ok' }
  })
  on('model.complete', ($, e) => {
    w.asked.push({ system: e.system, prompt: e.prompt })
    return reply === null
      ? { value: { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded', usage: USAGE } }
      : { value: { isAnswered: true, text: reply, usage: USAGE } }
  })
  on('ui.copy', ($, e) => (w.copied.push(e.text), { value: { isCopied: true } }))
  return w
}

const submit = (text: string, kind: 'composer' | 'plugin' = 'composer') =>
  ({ text, wait: false, origin: kind === 'composer' ? { kind } : { kind, name: 'other' } }) as const

const done = (durationMs = 240_000, agentId?: string) => ({
  turnId: 't1',
  answer: 'ok',
  durationMs,
  isAborted: false,
  reason: 'answer' as const,
  ...(agentId === undefined ? {} : { agentId }),
})

test('a turn is journaled with its prompt, files and commits', async ($, on) => {
  mock.clock(on, { now: at(2026, 10, 2, 9, 14) })
  const w = world(on)

  await $.prompt.submit(submit('Fix the login redirect bug'))
  await $.tool.call({ tool: 'Edit', file_path: '/work/api/src/auth.ts', old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Write', file_path: '/work/api/src/auth.ts', content: 'x' })
  await $.tool.call({ tool: 'Write', file_path: '/work/api/broken.ts', content: 'x' })
  await $.tool.call({ tool: 'Bash', command: 'git commit -m "whatever"' })
  await $.turn.complete(done())

  const day = w.store.get('day:2026-10-02') as Entry[]
  expect(day.length).toBe(1)
  expect(day[0]).toMatchObject({
    project: 'api',
    prompt: 'Fix the login redirect bug',
    files: ['src/auth.ts'],
    commits: ['Fix login redirect'],
    durationMs: 240_000,
  })
})

test('subagent turns, plugin prompts and slash commands are not the person\'s turns', async ($, on) => {
  mock.clock(on, { now: at(2026, 10, 2) })
  const w = world(on)

  await $.prompt.submit(submit('/compact'))
  await $.prompt.submit(submit('Summarize the TODOs', 'plugin'))
  await $.turn.complete(done())
  expect(w.store.get('day:2026-10-02')).toBeUndefined()

  await $.prompt.submit(submit('Add tests'))
  await $.turn.complete(done(5_000, 'sub-1'))
  expect(w.store.get('day:2026-10-02')).toBeUndefined()
  await $.turn.complete(done())
  expect((w.store.get('day:2026-10-02') as Entry[])[0]?.prompt).toBe('Add tests')
})

test('journaling drops days older than two weeks', async ($, on) => {
  mock.clock(on, { now: at(2026, 10, 20) })
  const w = world(on, null, { 'day:2026-09-30': [], 'day:2026-10-10': [] })

  await $.prompt.submit(submit('Ship it'))
  await $.turn.complete(done())

  expect([...w.store.keys()].sort()).toEqual(['day:2026-10-10', 'day:2026-10-20'])
})

const seed = (): Record<string, unknown> => ({
  'day:2026-10-01': [{ at: at(2026, 10, 1, 16), project: 'api', prompt: 'Old work', files: [], commits: [], durationMs: 60_000 }],
  'day:2026-10-02': [{ at: at(2026, 10, 2, 9, 14), project: 'api', prompt: 'Fix the login redirect', files: ['src/auth.ts'], commits: ['Fix login redirect'], durationMs: 240_000 }],
  'day:2026-10-05': [{ at: at(2026, 10, 5, 10), project: 'web', prompt: 'Dark mode toggle', files: ['ui/theme.ts'], commits: [], durationMs: 120_000 }],
})

test('/standup writes Friday and today on a Monday, and saves it for /standup copy', async ($, on) => {
  mock.clock(on, { now: at(2026, 10, 5, 11) })
  const w = world(on, 'Friday\n- Fixed the login redirect.\nToday\n- Dark mode.\nBlockers\n- None noted.', seed())

  const out = await $.command.run({ command: 'standup', args: '', ...TYPED })

  expect(out.text).toMatch(/^Friday\n- Fixed the login redirect\./)
  expect(out.text).toMatch(/\/standup copy/)
  expect(w.asked.length).toBe(1)
  expect(w.asked[0]?.prompt).toMatch(/Friday \(2026-10-02\)/)
  expect(w.asked[0]?.prompt).toMatch(/Today \(2026-10-05\)/)
  expect(w.asked[0]?.prompt).not.toMatch(/Old work/)
  expect(w.asked[0]?.prompt).toMatch(/Headings: Friday, Today, Blockers/)

  const copied = await $.command.run({ command: 'standup', args: 'copy', ...TYPED })
  expect(copied.text).toBe('standup: copied to your clipboard.')
  expect(w.copied[0]).toMatch(/^Friday/)
})

test('/standup falls back to the journal when the model is unavailable', async ($, on) => {
  mock.clock(on, { now: at(2026, 10, 5, 11) })
  world(on, null, seed())

  const out = await $.command.run({ command: 'standup', args: '', ...TYPED })

  expect(out.text).toMatch(/model was unavailable \(api-error\)/)
  expect(out.text).toMatch(/"Dark mode toggle"/)
})

test('/standup with an empty journal says so without calling the model', async ($, on) => {
  mock.clock(on, { now: at(2026, 10, 5) })
  const w = world(on)

  const out = await $.command.run({ command: 'standup', args: '', ...TYPED })

  expect(out.text).toMatch(/nothing journaled yet/)
  expect(w.asked.length).toBe(0)
  expect((await $.command.run({ command: 'standup', args: 'copy', ...TYPED })).text).toMatch(/Run \/standup first/)
})

test('/standup raw [days] and /standup clear', async ($, on) => {
  mock.clock(on, { now: at(2026, 10, 5, 11) })
  const w = world(on, null, { ...seed(), last: 'old standup' })

  const two = await $.command.run({ command: 'standup', args: 'raw', ...TYPED })
  expect(two.text).toMatch(/^Friday \(2026-10-02\)/)
  expect(two.text).not.toMatch(/Old work/)
  const three = await $.command.run({ command: 'standup', args: 'raw 3', ...TYPED })
  expect(three.text).toMatch(/Old work/)

  const cleared = await $.command.run({ command: 'standup', args: 'clear', ...TYPED })
  expect(cleared.text).toBe('standup: cleared 3 days of journal.')
  expect(w.store.size).toBe(0)
  expect((await $.command.run({ command: 'standup', args: 'raw', ...TYPED })).text).toMatch(/journal is empty/)
})

test('an unknown subcommand shows usage', async ($, on) => {
  mock.clock(on)
  world(on)
  expect((await $.command.run({ command: 'standup', args: 'bogus', ...TYPED })).text).toMatch(/^Usage/)
})
