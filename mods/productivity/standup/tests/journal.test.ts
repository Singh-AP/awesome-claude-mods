import { describe, expect, test } from 'claude-code/testing'

import {
  clip,
  commitSubject,
  dayLabel,
  dayOf,
  expiredKeys,
  isGitCommit,
  journalDays,
  journalText,
  relativeTo,
  standupPrompt,
  trimEntry,
  withEntry,
  type Entry,
} from '../hooks/journal'

const at = (y: number, m: number, d: number, h = 9, min = 0) => new Date(y, m - 1, d, h, min).getTime()

const entry = (over: Partial<Entry> = {}): Entry => ({
  at: at(2026, 10, 2, 9, 14),
  project: 'api',
  prompt: 'Fix the login redirect',
  files: ['src/auth.ts'],
  commits: [],
  durationMs: 240_000,
  ...over,
})

describe('dates', () => {
  test('dayOf is the local day', () => expect(dayOf(at(2026, 1, 5, 23, 59))).toBe('2026-01-05'))
  test('labels today, yesterday and older days', () => {
    expect(dayLabel('2026-10-05', '2026-10-05')).toBe('Today')
    expect(dayLabel('2026-10-04', '2026-10-05')).toBe('Yesterday')
    expect(dayLabel('2026-10-02', '2026-10-05')).toBe('Friday')
    expect(dayLabel('2026-02-28', '2026-03-01')).toBe('Yesterday')
  })
  test('expires days older than two weeks', () => {
    const keys = ['day:2026-09-20', 'day:2026-09-21', 'day:2026-09-22', 'day:2026-10-04', 'last']
    expect(expiredKeys(keys, '2026-10-04')).toEqual(['day:2026-09-20'])
  })
  test('journalDays lists days newest first and ignores other keys', () => {
    expect(journalDays(['day:2026-10-01', 'last', 'day:2026-10-03', 'day:2026-09-30'])).toEqual(['2026-10-03', '2026-10-01', '2026-09-30'])
  })
})

describe('commits', () => {
  test('recognizes git commit invocations', () => {
    expect(isGitCommit('git commit -m "x"')).toBe(true)
    expect(isGitCommit('git add . && git commit -am wip')).toBe(true)
    expect(isGitCommit('git -C repo commit --amend --no-edit')).toBe(true)
    expect(isGitCommit('git log --grep commit')).toBe(false)
    expect(isGitCommit('echo commit')).toBe(false)
  })
  test("takes the subject from git's own output first", () => {
    expect(commitSubject('git commit -m "ignored"', '[main 1a2b3c4] Fix login redirect\n 1 file changed')).toBe('Fix login redirect')
    expect(commitSubject('git commit', '[main (root-commit) 9f8e7d6] Initial commit\n')).toBe('Initial commit')
  })
  test('falls back to -m, --message and heredocs', () => {
    expect(commitSubject('git commit -m "Add retry to fetch"', '')).toBe('Add retry to fetch')
    expect(commitSubject("git commit -m 'Bump deps'", '')).toBe('Bump deps')
    expect(commitSubject('git commit --message=wip', '')).toBe('wip')
    const heredoc = 'git commit -m "$(cat <<\'EOF\'\nRefactor the parser\n\nLonger body.\nEOF\n)"'
    expect(commitSubject(heredoc, '')).toBe('Refactor the parser')
  })
  test('says nothing when there is no message to find', () => {
    expect(commitSubject('git commit', 'nothing to commit, working tree clean')).toBeUndefined()
  })
})

describe('entries', () => {
  test('clip collapses whitespace and cuts', () => {
    expect(clip('  a \n b  ', 10)).toBe('a b')
    expect(clip('abcdefghij', 5)).toBe('abcd…')
  })
  test('relativeTo strips the root', () => {
    expect(relativeTo('/work/api/src/a.ts', '/work/api')).toBe('src/a.ts')
    expect(relativeTo('/work/api/src/a.ts', '/work/api/')).toBe('src/a.ts')
    expect(relativeTo('/elsewhere/a.ts', '/work/api')).toBe('/elsewhere/a.ts')
    expect(relativeTo('/work/apiary/a.ts', '/work/api')).toBe('/work/apiary/a.ts')
  })
  test('trimEntry dedupes files and caps every field', () => {
    const big = trimEntry(entry({
      prompt: 'x'.repeat(500),
      files: [...Array(40).keys()].map(i => `f${i % 30}.ts`),
      commits: [...Array(9).keys()].map(i => `c${i}`),
    }))
    expect(big.prompt.length).toBe(160)
    expect(big.files.length).toBe(15)
    expect(big.commits.length).toBe(5)
  })
  test('withEntry keeps the newest 80', () => {
    let day: Entry[] = []
    for (let i = 0; i < 85; i++) day = withEntry(day, entry({ prompt: `p${i}` }))
    expect(day.length).toBe(80)
    expect(day[0]?.prompt).toBe('p5')
    expect(day.at(-1)?.prompt).toBe('p84')
  })
})

test('journalText groups by day and project', () => {
  const text = journalText(
    [
      { day: '2026-10-02', entries: [entry(), entry({ project: 'web', prompt: 'Dark mode', files: [], commits: ['Add dark mode'], at: at(2026, 10, 2, 14, 5), durationMs: 20_000 })] },
      { day: '2026-10-05', entries: [entry({ at: at(2026, 10, 5, 10, 0), prompt: '', files: [] })] },
    ],
    '2026-10-05',
  )
  expect(text).toBe(
    [
      'Friday (2026-10-02)',
      '  api',
      '    09:14 (4m) · "Fix the login redirect" · files: src/auth.ts',
      '  web',
      '    14:05 (<1m) · "Dark mode" · commits: "Add dark mode"',
      '',
      'Today (2026-10-05)',
      '  api',
      '    10:00 (4m) · (no prompt)',
    ].join('\n'),
  )
})

test('standupPrompt lists the headings to write', () => {
  expect(standupPrompt('J', ['Friday', 'Today', 'Blockers'])).toBe('Journal:\n\nJ\n\nHeadings: Friday, Today, Blockers\n\nWrite the standup.')
})
