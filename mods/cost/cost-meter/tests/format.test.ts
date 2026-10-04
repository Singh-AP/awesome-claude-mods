import { describe, expect, test } from 'claude-code/testing'

import { crossMarks, formatDuration, formatUsd, parseBudget, preview, report, statusLine } from '../hooks/format'

describe('formatUsd', () => {
  test('small amounts keep cents', () => expect(formatUsd(0.4249)).toBe('$0.42'))
  test('tens keep one decimal', () => expect(formatUsd(12.34)).toBe('$12.3'))
  test('hundreds round', () => expect(formatUsd(123.6)).toBe('$124'))
  test('never NaN', () => expect(formatUsd(Number.NaN)).toBe('$0.00'))
  test('zero', () => expect(formatUsd(0)).toBe('$0.00'))
  test('under a cent', () => expect(formatUsd(0.0004)).toBe('<$0.01'))
})

test('formatDuration matches the engine spelling', () => {
  expect(formatDuration(3200)).toBe('3s')
  expect(formatDuration(64_000)).toBe('1m 4s')
  expect(formatDuration(2 * 3_600_000 + 5 * 60_000)).toBe('2h 5m')
})

describe('statusLine', () => {
  test('shows every part with a reading', () => {
    const line = statusLine({
      usd: 0.42,
      percent: 38,
      limits: [
        { kind: 'five_hour', percentUsed: 21 },
        { kind: 'seven_day', percentUsed: 9.5 },
      ],
    })
    expect(line).toBe('💸 $0.42 · ctx 38% · 5h 21% · 7d 10%')
  })
  test('leaves out what is unknown', () => {
    expect(statusLine({ usd: 1.5, limits: [] })).toBe('💸 $1.50')
    expect(statusLine({ percent: 12, limits: [] })).toBe('💸 ctx 12%')
  })
  test('nothing known draws nothing', () => {
    expect(statusLine({ limits: [] })).toBe('')
    expect(statusLine({ usd: Number.NaN, limits: [] })).toBe('')
  })
})

describe('crossMarks', () => {
  test('announces each mark once', () => {
    let state = new Set<number>()
    const first = crossMarks(72, state)
    expect(first.crossed).toEqual([70])
    state = first.announced
    expect(crossMarks(75, state).crossed).toEqual([])
  })
  test('a jump announces only the highest mark', () => {
    const jump = crossMarks(96, new Set())
    expect(jump.crossed).toEqual([95])
    expect([...jump.announced].sort()).toEqual([70, 85, 95])
  })
  test('a compact re-arms the marks', () => {
    const after = crossMarks(30, new Set([70, 85]))
    expect(after.announced.size).toBe(0)
    expect(crossMarks(71, after.announced).crossed).toEqual([70])
  })
  test('an unknown fill crosses nothing', () => expect(crossMarks(undefined, new Set()).crossed).toEqual([]))
})

test('parseBudget', () => {
  expect(parseBudget(' 5 ')).toBe(5)
  expect(parseBudget('$2.50')).toBe(2.5)
  expect(parseBudget('off')).toBe(0)
  expect(parseBudget('lots')).toBeUndefined()
})

test('preview squeezes whitespace and cuts long prompts', () => {
  expect(preview('  fix\n the   bug ')).toBe('fix the bug')
  expect(preview('x'.repeat(60), 10)).toBe(`${'x'.repeat(9)}…`)
  expect(preview('')).toBe('(no prompt)')
})

test('report lists totals, the most expensive turn and the last turns', () => {
  const text = report(
    { usd: 1.2, percent: 40, limits: [{ kind: 'five_hour', percentUsed: 30, resetsAt: '2026-10-04T18:00:00Z' }] },
    [
      { prompt: 'add tests', usd: 0.2, durationMs: 30_000 },
      { prompt: 'refactor the parser', usd: 0.9, durationMs: 95_000 },
    ],
    { usd: 0, bar: 0 },
  )
  expect(text).toContain('Session cost: $1.20')
  expect(text).toContain('Rate limit 5h: 30% used, resets 2026-10-04 18:00 UTC')
  expect(text).toContain('Most expensive: $0.90 for "refactor the parser"')
  expect(text).toContain('1m 35s')
})
