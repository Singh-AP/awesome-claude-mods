import { describe, expect, test } from 'claude-code/testing'

import { commitsToast, parseStatus, statusLine, summary } from '../hooks/status'

const DIRTY = [
  '# branch.oid 1f2e3d4c5b6a79881f2e3d4c5b6a79881f2e3d4c',
  '# branch.head feat/login',
  '# branch.upstream origin/feat/login',
  '# branch.ab +2 -1',
  '1 .M N... 100644 100644 100644 aaa bbb src/a.ts',
  '1 M. N... 100644 100644 100644 aaa bbb src/b.ts',
  '1 MM N... 100644 100644 100644 aaa bbb src/c.ts',
  '2 R. N... 100644 100644 100644 aaa bbb R100 src/new.ts\tsrc/old.ts',
  'u UU N... 100644 100644 100644 100644 aaa bbb ccc src/conflict.ts',
  '? notes.md',
  '? tmp/',
  '',
].join('\n')

describe('parseStatus', () => {
  test('reads branch, upstream, ahead/behind and every kind of change', () => {
    const s = parseStatus(DIRTY)
    expect(s.branch).toBe('feat/login')
    expect(s.upstream).toBe('origin/feat/login')
    expect([s.ahead, s.behind]).toEqual([2, 1])
    expect(s.staged).toBe(3)
    expect(s.modified).toBe(2)
    expect(s.untracked).toBe(2)
    expect(s.conflicts).toBe(1)
  })

  test('a detached HEAD has no branch', () => {
    const s = parseStatus('# branch.oid abcdef1234567\n# branch.head (detached)\n')
    expect(s.branch).toBeNull()
    expect(statusLine(s)).toBe('⎇ @abcdef1 ✓')
  })

  test('a repository with no commits yet', () => {
    const s = parseStatus('# branch.oid (initial)\n# branch.head main\n? a.txt\n')
    expect(s.oid).toBeNull()
    expect(statusLine(s)).toBe('⎇ main (no commits) ?1')
  })
})

describe('statusLine', () => {
  test('shows only what is there', () => {
    expect(statusLine(parseStatus(DIRTY))).toBe('⎇ feat/login ↑2 ↓1 ✖1 ●2 +3 ?2')
  })
  test('clean and in sync gets a check mark', () => {
    expect(statusLine(parseStatus('# branch.oid abc\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +0 -0\n'))).toBe('⎇ main ✓')
  })
  test('clean but ahead shows the arrows, no check mark', () => {
    expect(statusLine(parseStatus('# branch.oid abc\n# branch.head main\n# branch.ab +3 -0\n'))).toBe('⎇ main ↑3')
  })
})

test('summary describes the repository in words', () => {
  const text = summary(parseStatus(DIRTY), 'abc1234 Add login (2 hours ago)\ndef5678 Fix typo (3 hours ago)\n', 2)
  expect(text).toContain('Branch: feat/login')
  expect(text).toContain('Upstream: origin/feat/login (2 ahead, 1 behind)')
  expect(text).toContain('Working tree: 1 conflict, 3 staged, 2 modified, 2 untracked')
  expect(text).toContain('Stash: 2 entries')
  expect(text).toContain('  abc1234 Add login (2 hours ago)')
})

test('summary of a fresh local branch', () => {
  const text = summary(parseStatus('# branch.oid abc\n# branch.head spike\n'), '', 0)
  expect(text).toContain('Upstream: none (not pushed yet)')
  expect(text).toContain('Working tree: clean')
  expect(text).not.toContain('Stash')
})

test('commitsToast counts in words', () => {
  const s = parseStatus('# branch.oid abc\n# branch.head main\n')
  expect(commitsToast(1, s)).toBe('1 new commit on main this turn')
  expect(commitsToast(3, s)).toBe('3 new commits on main this turn')
})
