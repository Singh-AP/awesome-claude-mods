import { expect, test } from 'claude-code/testing'

import { isCommit, isFleeting, isGreenTestRun, levelOf, outcomeOf, progress, toolLine, xpBar, xpForLevel } from '../hooks/pet'

test('levels get further apart', () => {
  expect([1, 2, 3, 4, 5].map(xpForLevel)).toEqual([0, 50, 150, 300, 500])
  expect(levelOf(0)).toBe(1)
  expect(levelOf(49)).toBe(1)
  expect(levelOf(50)).toBe(2)
  expect(levelOf(299)).toBe(3)
  expect(levelOf(10_000)).toBe(20)
})

test('the XP bar fills across a level', () => {
  expect(progress(50)).toBe(0)
  expect(progress(100)).toBe(0.5)
  expect(xpBar(100, 10)).toBe('█████░░░░░')
  expect(xpBar(0, 4)).toBe('░░░░')
})

test('each tool gets its own line', () => {
  expect(toolLine('Read', { file_path: '/src/hooks/register.ts' })).toBe('📖 reading register.ts')
  expect(toolLine('Edit', { file_path: 'a/b.tsx' })).toBe('✏️ editing b.tsx')
  expect(toolLine('Write', { file_path: 'README.md' })).toBe('📝 writing README.md')
  expect(toolLine('Bash', { command: 'npm test' })).toBe('⚙️ running npm test')
  expect(toolLine('Bash', { command: 'x'.repeat(80) })).toMatch(/…$/)
  expect(toolLine('Grep', { pattern: 'TODO' })).toBe('🔍 searching TODO')
  expect(toolLine('WebFetch', {})).toBe('🌐 browsing the web')
  expect(toolLine('Agent', { description: 'Explore the repo' })).toBe('🤝 delegating Explore the repo')
  expect(toolLine('mcp__github__create_issue', {})).toBe('🔌 using github')
  expect(toolLine('Mystery', {})).toBe('🛠 using Mystery')
})

test('green test runs are spotted across runners', () => {
  expect(isGreenTestRun('npm test', 'Tests: 12 passed, 12 total', false)).toBe(true)
  expect(isGreenTestRun('pytest -q', '24 passed in 0.31s', false)).toBe(true)
  expect(isGreenTestRun('cargo test', 'test result: ok. 8 passed; 0 failed', false)).toBe(true)
  expect(isGreenTestRun('go test ./...', 'ok  \tpkg\t0.2s', false)).toBe(true)
  expect(isGreenTestRun('bun test', '✓ adds numbers', false)).toBe(true)
  // Not green: failures, errors, and things that are not test runs.
  expect(isGreenTestRun('npm test', 'Tests: 2 failed, 10 passed', false)).toBe(false)
  expect(isGreenTestRun('npm test', '10 passed', true)).toBe(false)
  expect(isGreenTestRun('ls', 'passed.txt', false)).toBe(false)
})

test('commits are spotted, non-commits are not', () => {
  expect(isCommit('git commit -m "x"', '[main 1a2b3c4] x\n 1 file changed', false)).toBe(true)
  expect(isCommit('git -C repo commit -am x', '[dev abcdef0] x', false)).toBe(true)
  expect(isCommit('git commit -m x', 'nothing to commit, working tree clean', false)).toBe(false)
  expect(isCommit('git commit --dry-run', '', false)).toBe(false)
  expect(isCommit('git commit -m x', 'error', true)).toBe(false)
  expect(isCommit('git status', '', false)).toBe(false)
})

test('outcomes set the mood and the XP', () => {
  expect(outcomeOf('Read', {}, { text: 'x' })).toMatchObject({ mood: 'work', xp: 1 })
  expect(outcomeOf('Bash', { command: 'rm -rf ~' }, { deny: 'no' })).toMatchObject({ mood: 'wary', xp: 1 })
  expect(outcomeOf('Bash', { command: 'make' }, { isError: true, text: 'boom' })).toMatchObject({ mood: 'startled', errors: 1 })
  expect(outcomeOf('Bash', { command: 'git commit -m x' }, { text: '[main abc1234] x' })).toMatchObject({ mood: 'party', xp: 21, commits: 1 })
  expect(outcomeOf('Bash', { command: 'npm test' }, { text: '3 passed' })).toMatchObject({ mood: 'happy', xp: 11, greenTests: 1 })
  expect(isFleeting('party')).toBe(true)
  expect(isFleeting('work')).toBe(false)
})
