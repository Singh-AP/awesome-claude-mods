import { describe, expect, test } from 'claude-code/testing'

import {
  absorb,
  asTally,
  bar,
  costDelta,
  dayKey,
  duration,
  emptyTally,
  hashPath,
  hourLabel,
  isCommit,
  lineCount,
  merge,
  personaOf,
  SHARE_FOOTER,
  shareCard,
  streaks,
  summarize,
  type Tally,
} from '../hooks/stats'

const tally = (over: Partial<Tally>): Tally => ({ ...emptyTally(1_000), ...over })

test('merge sums counters, keeps records and unions files', () => {
  const a = tally({ sessions: 1, prompts: 3, turns: 2, longestTurnMs: 500, tools: { Bash: 2 }, files: ['x', 'y'], days: { '2026-01-01': 2 }, firstAt: 50 })
  const b = tally({ sessions: 1, prompts: 4, turns: 1, longestTurnMs: 900, tools: { Bash: 1, Read: 5 }, files: ['y', 'z'], days: { '2026-01-01': 1, '2026-01-02': 1 }, lastAt: 9_000 })
  const m = merge(a, b)
  expect(m).toMatchObject({ sessions: 2, prompts: 7, turns: 3, longestTurnMs: 900, firstAt: 50, lastAt: 9_000 })
  expect(m.tools).toEqual({ Bash: 3, Read: 5 })
  expect(m.files).toEqual(['x', 'y', 'z'])
  expect(m.days).toEqual({ '2026-01-01': 3, '2026-01-02': 1 })
})

test('absorb keeps a session record at one session and caps its files', () => {
  const stored = tally({ sessions: 1, prompts: 1, costSeen: 2 })
  const fresh = tally({ sessions: 0, prompts: 2, files: Array.from({ length: 3000 }, (_, i) => `f${i}`) })
  const merged = absorb(stored, fresh)
  expect(merged.sessions).toBe(1)
  expect(merged.prompts).toBe(3)
  expect(merged.files.length).toBe(500)
  expect(merged.costSeen).toBe(2)
})

test('asTally repairs old or damaged records', () => {
  expect(asTally(undefined, 5).firstAt).toBe(5)
  const t = asTally({ prompts: 2, hours: [1, 2] }, 5)
  expect(t.prompts).toBe(2)
  expect(t.hours.length).toBe(24)
  expect(t.hours[1]).toBe(2)
  expect(t.hours[2]).toBe(0)
})

test('cost deltas survive a ledger reset', () => {
  expect(costDelta(1.5, 2.25)).toBe(0.75)
  expect(costDelta(3, 0.4)).toBe(0.4)
})

test('days, hours and files are keyed compactly', () => {
  const ms = new Date(2026, 9, 4, 23, 30).getTime()
  expect(dayKey(ms)).toBe('2026-10-04')
  expect(hashPath('/a/b.ts')).toBe(hashPath('/a/b.ts'))
  expect(hashPath('/a/b.ts')).not.toBe(hashPath('/a/c.ts'))
  expect(hashPath('/a/b.ts')).not.toMatch(/\//)
  expect(lineCount('')).toBe(0)
  expect(lineCount('a')).toBe(1)
  expect(lineCount('a\nb\n')).toBe(2)
})

test('commits are counted only when they went through', () => {
  expect(isCommit('git commit -m x', '[main abc1234] x', false)).toBe(true)
  expect(isCommit('git commit -m x', 'nothing to commit', false)).toBe(false)
  expect(isCommit('git commit -m x', '', true)).toBe(false)
  expect(isCommit('git log', '', false)).toBe(false)
})

describe('streaks', () => {
  test('a run ending today is current', () => {
    expect(streaks(['2026-10-02', '2026-10-03', '2026-10-04'], '2026-10-04')).toEqual({ current: 3, longest: 3 })
  })
  test('a run ending yesterday still counts while today is young', () => {
    expect(streaks(['2026-10-02', '2026-10-03'], '2026-10-04')).toEqual({ current: 2, longest: 2 })
  })
  test('a gap breaks the current run but not the record', () => {
    expect(streaks(['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-10-04'], '2026-10-04')).toEqual({ current: 1, longest: 4 })
  })
  test('runs cross month and year ends', () => {
    expect(streaks(['2025-12-30', '2025-12-31', '2026-01-01'], '2026-01-01')).toEqual({ current: 3, longest: 3 })
  })
  test('nothing active is no streak', () => {
    expect(streaks([], '2026-10-04')).toEqual({ current: 0, longest: 0 })
  })
})

describe('personas', () => {
  const hoursAt = (hour: number) => Array.from({ length: 24 }, (_, i) => (i === hour ? 10 : 1))
  test('late nights make a Night Owl', () => {
    expect(personaOf(tally({ prompts: 20, hours: hoursAt(23) })).title).toBe('The Night Owl')
  })
  test('dawn makes an Early Bird', () => {
    expect(personaOf(tally({ prompts: 20, hours: hoursAt(6) })).title).toBe('The Early Bird')
  })
  test('a long turn makes a Marathoner', () => {
    expect(personaOf(tally({ prompts: 20, hours: hoursAt(14), longestTurnMs: 20 * 60_000 })).title).toBe('The Marathoner')
  })
  test('the dominant tool picks the rest', () => {
    const day = hoursAt(14)
    expect(personaOf(tally({ prompts: 9, hours: day, tools: { Bash: 30, Read: 10 } })).title).toBe('The Shell Wizard')
    expect(personaOf(tally({ prompts: 9, hours: day, tools: { Edit: 20, Read: 15, Bash: 5 } })).title).toBe('The Refactorer')
    expect(personaOf(tally({ prompts: 9, hours: day, tools: { Read: 20, Grep: 10, Bash: 9, Edit: 9 } })).title).toBe('The Reader')
    expect(personaOf(tally({ prompts: 9, hours: day, tools: { Agent: 5, Read: 9, Bash: 9, Edit: 9 } })).title).toBe('The Conductor')
    expect(personaOf(tally({ prompts: 9, hours: day, tools: { WebSearch: 8, Read: 10, Bash: 10, Edit: 10 } })).title).toBe('The Researcher')
  })
  test('commits make a Shipper, and everyone else collaborates', () => {
    expect(personaOf(tally({ commits: 30 })).title).toBe('The Shipper')
    expect(personaOf(tally({})).title).toBe('The Collaborator')
  })
})

test('labels read naturally', () => {
  expect(hourLabel(0)).toBe('12am')
  expect(hourLabel(13)).toBe('1pm')
  expect(hourLabel(23)).toBe('11pm')
  expect(duration(0)).toBe('0s')
  expect(duration(30_000)).toBe('30s')
  expect(duration(60_000)).toBe('1m')
  expect(duration(42 * 60_000)).toBe('42m')
  expect(duration(90 * 60_000)).toBe('1.5h')
  expect(duration(96 * 3_600_000)).toBe('96h')
})

test('bars are smooth to an eighth of a cell', () => {
  expect(bar(10, 10, 4)).toBe('████')
  expect(bar(5, 10, 4)).toBe('██')
  expect(bar(1, 8, 1)).toBe('▏')
  expect(bar(1, 0, 4)).toBe('')
})

test('the share card carries the headline stats and the footer', () => {
  const t = tally({ sessions: 3, prompts: 1284, turnMs: 96 * 3_600_000, tools: { Bash: 6201, Edit: 4102, Read: 3050 }, lines: 41_200, commits: 128, cost: 12.5, days: { '2026-10-03': 1, '2026-10-04': 2 } })
  const s = summarize(t, 'Claude Code Wrapped · 2026', '2026-10-04')
  const card = shareCard(s, false)
  expect(card).toMatch(/^✦ My Claude Code Wrapped · 2026 ✦/)
  expect(card).toMatch(/1,284 prompts · 3 sessions · 96h with Claude/)
  expect(card).toMatch(/13,353 tool calls · 41,200 lines written · 128 commits/)
  expect(card).toMatch(/Top tools: Bash · Edit · Read/)
  expect(card).toMatch(/Longest streak: 2 days/)
  expect(card).not.toMatch(/\$/)
  expect(card.endsWith(SHARE_FOOTER)).toBe(true)
  expect(shareCard(s, true)).toMatch(/\$12\.50 of tokens/)
})

test('the share card speaks in singulars too', () => {
  const s = summarize(tally({ sessions: 1, prompts: 1, tools: { Read: 1 }, lines: 1, commits: 1 }), 'x', '2026-10-04')
  expect(shareCard(s, false)).toMatch(/1 prompt · 1 session · 0s with Claude\n1 tool call · 1 line written · 1 commit/)
})

test('an empty tally summarizes as empty', () => {
  expect(summarize(emptyTally(0), 'x', '2026-10-04').isEmpty).toBe(true)
})
