import { expect, test } from 'claude-code/testing'

import { ago, append, flaky, readRuns, report, sparkline, statusLine, toRun, transition, type Run } from '../hooks/history'

const MIN = 60_000

const run = (over: Partial<Run>): Run => ({
  at: 0, runner: 'pytest', command: 'pytest -q', counted: true, passed: 10, failed: 0, skipped: 0, ok: true, failing: [], epoch: 's:0', ...over,
})

test('ago reads naturally', () => {
  expect(ago(10_000)).toBe('just now')
  expect(ago(2 * MIN)).toBe('2m ago')
  expect(ago(3 * 60 * MIN)).toBe('3h ago')
  expect(ago(50 * 60 * MIN)).toBe('2d ago')
})

test('the status line says green, red and how long ago', () => {
  expect(statusLine(run({ passed: 44 }), 2 * MIN)).toBe('🧪 ✅ 44/44 passing · 2m ago')
  expect(statusLine(run({ passed: 41, failed: 3, ok: false }), 0)).toBe('🧪 ❌ 41/44 passing · just now')
  expect(statusLine(run({ counted: false, ok: false }), 0)).toBe('🧪 ❌ tests failed · just now')
  expect(statusLine(run({ passed: 5, ok: false }), 0)).toBe('🧪 ❌ 5/5 passing, exit failed · just now')
})

test('toRun marks a run red on a failure or a failed exit', () => {
  const parsed = { passed: 3, failed: 1, skipped: 0, failing: ['a'], format: 'jest' }
  expect(toRun({ at: 1, runner: 'jest', command: 'npx  jest', parsed, exitOk: true, epoch: 'e' }).ok).toBe(false)
  expect(toRun({ at: 1, runner: 'jest', command: 'npx jest', parsed: undefined, exitOk: false, epoch: 'e' }).counted).toBe(false)
  expect(toRun({ at: 1, runner: 'jest', command: 'npx  jest\n', parsed: undefined, exitOk: true, epoch: 'e' }).command).toBe('npx jest')
})

test('transitions toast only when the colour changes', () => {
  const green = run({ passed: 44 })
  const red = run({ passed: 41, failed: 3, ok: false, failing: ['test_login'] })
  expect(transition(undefined, red)).toBeUndefined()
  expect(transition(green, green)).toBeUndefined()
  expect(transition(green, red)).toBe('tests went red: 3 failing · test_login')
  expect(transition(red, green)).toBe('tests are green again 🎉 (44 passing)')
})

test('the sparkline shows the pass rate per run', () => {
  const line = sparkline([run({ passed: 0, failed: 10, ok: false }), run({ passed: 5, failed: 5, ok: false }), run({ passed: 10 }), run({ counted: false, ok: true })])
  expect(line).toBe('▁▅██')
})

test('a test that fails then passes with no edits in between is flagged flaky', () => {
  const runs = [
    run({ ok: false, failed: 1, failing: ['test_retry'], epoch: 's:3' }),
    run({ ok: true, epoch: 's:3' }),
    run({ ok: false, failed: 1, failing: ['test_edit'], epoch: 's:4' }),
    run({ ok: true, epoch: 's:5' }),
  ]
  expect(flaky(runs)).toEqual(['test_retry'])
  expect(flaky([run({ ok: false, counted: false, epoch: 'x' }), run({ ok: true, counted: false, epoch: 'x' })])).toEqual(['the whole run (pytest -q)'])
  expect(flaky([run({ ok: false, failing: ['a'], command: 'pytest a' }), run({ ok: true, command: 'pytest b' })])).toEqual([])
})

test('history keeps the last 20 runs', () => {
  let runs: Run[] = []
  for (let i = 0; i < 25; i++) runs = append(runs, run({ at: i }))
  expect(runs.length).toBe(20)
  expect(runs[0]!.at).toBe(5)
})

test('the report lists runs newest first with flakes', () => {
  const text = report([
    run({ at: 0, ok: false, passed: 9, failed: 1, failing: ['test_retry'] }),
    run({ at: MIN, passed: 10 }),
  ], 3 * MIN)
  expect(text).toMatch(/^Last 2 runs · pass rate ▇█/)
  expect(text.indexOf('2m ago')).toBeLessThan(text.indexOf('3m ago'))
  expect(text).toMatch(/✗ test_retry/)
  expect(text).toMatch(/Possibly flaky .*: test_retry/)
  expect(report([], 0)).toMatch(/No test runs/)
})

test('readRuns drops anything malformed', () => {
  expect(readRuns('nope')).toEqual([])
  expect(readRuns([run({}), { at: 'x' }, null]).length).toBe(1)
})
