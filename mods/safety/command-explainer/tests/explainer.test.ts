import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { formatNotice, isPending, isPlain, linesForGroup, Lru, parseExplanation } from '../hooks/explain'

const TYPED = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } } as const
const USAGE = { input_tokens: 90, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const BASH_OK = { result: { stdout: '', stderr: '', interrupted: false } }

type World = { notices: { id: string; text: string | undefined }[]; models: string[]; checks: number; bashStarted: number }

/**
 * Stubs beneath the mod. The Bash call stays open for 2 s and the model takes
 * `modelMs`, both on the mock clock, so a test controls which lands first.
 */
function world(on: On, opts: { decision?: 'ask' | 'allow' | 'deny'; reply?: string; modelMs?: number; refuse?: string } = {}) {
  const clock = mock.clock(on)
  const seen: World = { notices: [], models: [], checks: 0, bashStarted: 0 }
  on('tool.check', () => (seen.checks++, { decision: opts.decision ?? 'ask' }))
  on('session.model', () => ({ value: 'claude-session-model' }))
  on('model.complete', async ($, e) => {
    seen.models.push(e.model)
    if (opts.refuse !== undefined && e.model === opts.refuse) return { deny: `model ${e.model} is blocked` }
    await clock.sleep(opts.modelMs ?? 300)
    if (opts.reply === '') return { value: { isAnswered: false as const, reason: 'empty-reply' as const, usage: USAGE } }
    return { value: { isAnswered: true as const, text: opts.reply ?? 'danger — deletes everything under build/ for good.', usage: USAGE } }
  })
  on('ui.notice', ($, e) => (seen.notices.push({ id: e.tool_use_id, text: e.text }), { value: undefined }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  // What Claude Code itself draws for the tool row.
  on('ui.render', () => ({ type: 'Text' as const, props: {}, children: ['⏺ Bash(rm -rf build && make)'] }))
  on('tool.call', async () => {
    seen.bashStarted++
    await clock.sleep(2000)
    return BASH_OK
  })
  return { clock, seen }
}

test('the call starts at once and the explanation lands under its dialog', async ($, on) => {
  const { clock, seen } = world(on)
  const call = $.tool.call({ tool: 'Bash', command: 'rm -rf build && make' })

  await clock.settle()
  expect(seen.bashStarted).toBe(1)
  expect(seen.notices).toEqual([])

  await clock.advance(300)
  expect(seen.notices.length).toBe(1)
  expect(seen.notices[0]!.text).toBe('🛑 Danger: Deletes everything under build/ for good.')
  expect(seen.notices[0]!.id).toBeDefined()

  await clock.advance(1700)
  expect((await call).deny).toBeUndefined()
})

// A Bash row: pending (at its permission dialog, isRunning still false) or done.
function toolRow(id: string, isDone: boolean) {
  const state = isDone ? { isRunning: false, output: { stdout: '', stderr: '', interrupted: false } } : { isRunning: false }
  return {
    plugin: 'command-explainer',
    component: 'ToolUse',
    requestId: id,
    viewport: { columns: 100, rows: 30 },
    props: { tool_use_id: id, tool: 'Bash', input: { command: 'rm -rf build && make' }, isErrored: false, isInterrupted: false, ...state },
  } as const
}

function groupRow(id: string, isExpanded = false) {
  return {
    plugin: 'command-explainer',
    component: 'ToolGroup',
    requestId: `collapsed-${id}`,
    viewport: { columns: 100, rows: 30 },
    props: {
      isActive: true,
      isExpanded,
      calls: [{ tool_use_id: id, tool: 'Bash', input: { command: 'rm -rf build && make' }, isRunning: false, isErrored: false, isInterrupted: false }],
    },
  } as const
}

test('the explanation is drawn under the call\'s own row while it waits', async ($, on) => {
  const { clock, seen } = world(on)
  const call = $.tool.call({ tool: 'Bash', command: 'rm -rf build && make' })
  await clock.advance(300)
  const id = seen.notices[0]!.id

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...toolRow(id, false), surface })
    expect(await ui.find({ type: 'Text', text: /Bash\(rm -rf build/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /🛑 Danger: Deletes everything under build/ })).toBeDefined()
    await ui.unmount()
  }

  const done = await $.ui.mount({ ...toolRow(id, true), surface: 'terminal' })
  expect(await done.find({ type: 'Text', text: /Danger/ })).toBeUndefined()
  const other = await $.ui.mount({ ...toolRow('toolu_other', false), surface: 'terminal' })
  expect(await other.find({ type: 'Text', text: /Danger/ })).toBeUndefined()

  // The usual case: the pending call drawn inside a collapsed group.
  for (const surface of ['terminal', 'desktop'] as const) {
    const group = await $.ui.mount({ ...groupRow(id), surface })
    expect(await group.find({ type: 'Text', text: /🛑 Danger: Deletes everything under build/ })).toBeDefined()
    await group.unmount()
  }
  // Expanded, each call draws as its own ToolUse row, which carries the line.
  const expanded = await $.ui.mount({ ...groupRow(id, true), surface: 'terminal' })
  expect(await expanded.find({ type: 'Text', text: /Danger/ })).toBeUndefined()

  await clock.advance(1700)
  await call
})

test('no dialog coming (already allowed): no model call', async ($, on) => {
  const { clock, seen } = world(on, { decision: 'allow' })
  const call = $.tool.call({ tool: 'Bash', command: 'npm run build' })
  await clock.advance(2000)
  await call
  expect(seen.checks).toBe(1)
  expect(seen.models).toEqual([])
  expect(seen.notices).toEqual([])
})

test('obvious read-only commands are not even checked', async ($, on) => {
  const { clock, seen } = world(on)
  const call = $.tool.call({ tool: 'Bash', command: 'git status' })
  await clock.advance(2000)
  await call
  expect(seen.checks).toBe(0)
  expect(seen.models).toEqual([])
})

test('a repeated command is explained from the cache', async ($, on) => {
  const { clock, seen } = world(on)
  const first = $.tool.call({ tool: 'Bash', command: 'git push --force' })
  await clock.advance(2000)
  await first
  const second = $.tool.call({ tool: 'Bash', command: 'git push --force' })
  await clock.settle()
  await clock.advance(2000)
  await second
  expect(seen.models.length).toBe(1)
  expect(seen.notices.length).toBe(2)
})

test('a model that does not answer shows nothing and holds nothing', async ($, on) => {
  const { clock, seen } = world(on, { reply: '' })
  const call = $.tool.call({ tool: 'Bash', command: 'make deploy' })
  await clock.advance(2000)
  expect((await call).deny).toBeUndefined()
  expect(seen.notices).toEqual([])
})

test('a model the organization blocks falls back to the session model', async ($, on) => {
  const { clock, seen } = world(on, { refuse: 'haiku', reply: 'caution — installs the left-pad package into node_modules.' })
  const call = $.tool.call({ tool: 'Bash', command: 'npm install left-pad' })
  await clock.advance(2000)
  await call
  expect(seen.models).toEqual(['haiku', 'claude-session-model'])
  expect(seen.notices[0]!.text).toBe('⚠️ Caution: Installs the left-pad package into node_modules.')
})

test('minLength skips short commands', { options: { minLength: 30 } }, async ($, on) => {
  const { clock, seen } = world(on)
  const call = $.tool.call({ tool: 'Bash', command: 'make clean' })
  await clock.advance(2000)
  await call
  expect(seen.checks).toBe(0)
})

test('/explain answers on demand, without a dialog', async ($, on) => {
  const { clock, seen } = world(on, { reply: 'safe — prints the five most recent commits.', modelMs: 0 })
  const answer = $.command.run({ command: 'explain', args: 'git log -5 --oneline | cat', ...TYPED })
  await clock.settle()
  expect((await answer).text).toBe('💡 Safe: Prints the five most recent commits.')
  expect(seen.checks).toBe(0)
  const usage = await $.command.run({ command: 'explain', args: '', ...TYPED })
  expect(usage.text).toMatch(/Usage: \/explain <command>/)
})

describe('parseExplanation', () => {
  const cases: [string, string | undefined, string][] = [
    ['danger — deletes the repo', 'danger', 'Deletes the repo'],
    ['Caution: installs packages', 'caution', 'Installs packages'],
    ['[safe] lists files', 'safe', 'Lists files'],
    ['Risk: danger - wipes the disk', 'danger', 'Wipes the disk'],
    ['**caution** – pushes to origin', 'caution', 'Pushes to origin'],
    ['"safe — prints the date"', 'safe', 'Prints the date'],
    ['\n\nsafe. shows git status\nextra line', 'safe', 'Shows git status'],
    ['Copies a.txt to b.txt', undefined, 'Copies a.txt to b.txt'],
  ]
  for (const [reply, risk, summary] of cases) {
    test(JSON.stringify(reply), () => expect(parseExplanation(reply)).toEqual({ risk: risk as never, summary }))
  }
  test('an empty reply or a bare risk is no explanation', () => {
    expect(parseExplanation('   \n ')).toBeUndefined()
    expect(parseExplanation('danger —')).toBeUndefined()
  })
  test('formatNotice', () => {
    expect(formatNotice({ risk: undefined, summary: 'Does a thing' })).toBe('💡 Does a thing')
  })
})

describe('isPlain', () => {
  const plain = ['ls -la', 'pwd', 'cat README.md', 'git status', 'git diff --stat', 'git log -3', 'git branch', 'git branch -a', '/bin/ls', 'echo hi']
  const notPlain = ['cat a > b', 'ls | xargs rm', 'echo $(whoami)', 'git push', 'git branch -D x', 'env FOO=1 make', 'rm a', 'npm test', 'git checkout .']
  for (const c of plain) test(`plain: ${c}`, () => expect(isPlain(c)).toBe(true))
  for (const c of notPlain) test(`explained: ${c}`, () => expect(isPlain(c)).toBe(false))
})

test('a call is pending until it has an output, an error or an abort', () => {
  const base = { isRunning: false, isErrored: false, isInterrupted: false }
  expect(isPending(base)).toBe(true)
  expect(isPending({ ...base, isRunning: true })).toBe(true)
  expect(isPending({ ...base, output: { stdout: '' } })).toBe(false)
  expect(isPending({ ...base, isErrored: true })).toBe(false)
  expect(isPending({ ...base, isInterrupted: true })).toBe(false)
})

test('linesForGroup picks pending Bash calls that have a line', () => {
  const pending = { isRunning: false, isErrored: false, isInterrupted: false }
  const calls = [
    { ...pending, tool_use_id: 'a', tool: 'Bash' },
    { ...pending, tool_use_id: 'b', tool: 'Read' },
    { ...pending, tool_use_id: 'c', tool: 'Bash', output: 'done' },
    { ...pending, tool: 'Bash' },
  ]
  expect(linesForGroup(calls, { a: 'A', b: 'B', c: 'C' })).toEqual(['A'])
})

test('Lru forgets the least recently used entry', () => {
  const lru = new Lru<string, number>(2)
  lru.set('a', 1)
  lru.set('b', 2)
  lru.get('a')
  lru.set('c', 3)
  expect(lru.get('b')).toBeUndefined()
  expect(lru.get('a')).toBe(1)
  expect(lru.size).toBe(2)
})
