import { describe, expect, test } from 'claude-code/testing'

import type { RadarCall } from '../types'
import { countCall, emptyTotals, formatDuration, headerLine, mcpParts, preview, rowLine, summaryText, toolLabel } from '../hooks/format'

describe('preview', () => {
  test('Bash shows the command on one line', () => {
    expect(preview('Bash', { command: 'npm   test\n  --watch' })).toBe('npm test --watch')
  })
  test('file tools show the last two path segments', () => {
    expect(preview('Edit', { file_path: '/repo/src/hooks/register.ts' })).toBe('hooks/register.ts')
    expect(preview('Read', { file_path: 'README.md' })).toBe('README.md')
    expect(preview('NotebookEdit', { notebook_path: '/a/b/nb.ipynb' })).toBe('b/nb.ipynb')
  })
  test('search tools show the pattern', () => {
    expect(preview('Grep', { pattern: 'TODO', path: '/repo/src' })).toBe('TODO in repo/src')
    expect(preview('Glob', { pattern: '**/*.ts' })).toBe('**/*.ts')
  })
  test('web, agent and todo tools', () => {
    expect(preview('WebFetch', { url: 'https://example.com/docs' })).toBe('example.com/docs')
    expect(preview('WebSearch', { query: 'bun test' })).toBe('bun test')
    expect(preview('Agent', { description: 'Find the bug', subagent_type: 'Explore', prompt: 'long' })).toBe('[Explore] Find the bug')
    expect(preview('TodoWrite', { todos: [1, 2, 3] })).toBe('3 todos')
  })
  test('MCP tools show the tool name and the first string argument', () => {
    expect(preview('mcp__github__search_issues', { query: 'is:open bug', limit: 5 })).toBe('search_issues is:open bug')
  })
  test('is capped at 200 characters', () => {
    expect(preview('Bash', { command: 'x'.repeat(500) }).length).toBe(200)
  })
})

test('mcp names split on double underscores', () => {
  expect(mcpParts('mcp__plugin_a_b__do__it')).toEqual({ server: 'plugin_a_b', name: 'do__it' })
  expect(mcpParts('Bash')).toBeUndefined()
  expect(toolLabel('mcp__github__x')).toBe('mcp:github')
  expect(toolLabel('Read')).toBe('Read')
})

test('formatDuration', () => {
  expect(formatDuration(240)).toBe('240ms')
  expect(formatDuration(1234)).toBe('1.2s')
  expect(formatDuration(125_000)).toBe('2m05s')
})

test('countCall keeps totals per tool and outcome', () => {
  let t = emptyTotals()
  t = countCall(t, 'Bash', 'done', 1000)
  t = countCall(t, 'Bash', 'failed', 3000)
  t = countCall(t, 'mcp__gh__x', 'denied', 0)
  expect(t).toEqual({ calls: 3, failed: 1, denied: 1, totalMs: 4000, byTool: { Bash: 2, 'mcp:gh': 1 } })
})

test('headerLine fits the width and lists the busiest tools', () => {
  let t = emptyTotals()
  for (let i = 0; i < 20; i++) t = countCall(t, 'Bash', 'done', 1000)
  for (let i = 0; i < 12; i++) t = countCall(t, 'Edit', 'done', 1000)
  t = countCall(t, 'Read', 'failed', 1600)
  expect(headerLine(t, 1, 200)).toBe('34 calls · 1 failed · 1 running · avg 1.0s · Bash 20 Edit 12 Read 1')
  expect(headerLine(t, 0, 40).length).toBeLessThan(41)
  expect(headerLine(emptyTotals(), 0, 80)).toBe('0 calls')
})

const CALL: RadarCall = { id: 'a', tool: 'Bash', preview: 'npm test', status: 'done', startedAt: 0, ms: 1234 }

test('rowLine is exactly as wide as the pane', () => {
  const row = rowLine(CALL, 50)
  expect(row.glyph).toBe('✓')
  expect(row.text.length).toBe(48)
  expect(row.text.startsWith('Bash ')).toBe(true)
  expect(row.text.endsWith(' 1.2s')).toBe(true)
})

test('rowLine marks subagents, failures and running calls', () => {
  expect(rowLine({ ...CALL, agent: 'abc' }, 50).text.startsWith('↳ Bash')).toBe(true)
  const failed = rowLine({ ...CALL, status: 'failed', error: 'exit code 1' }, 60)
  expect(failed.color).toBe('red')
  expect(failed.text).toMatch(/npm test — exit code 1/)
  expect(rowLine({ ...CALL, status: 'running', ms: undefined }, 50).text.endsWith(' …')).toBe(true)
  expect(rowLine(CALL, 5).text.length).toBeLessThan(11)
})

test('summaryText lists failures and the slowest calls', () => {
  const calls: RadarCall[] = [
    { ...CALL, id: '1', ms: 300 },
    { ...CALL, id: '2', preview: 'npm run build', ms: 9000 },
    { ...CALL, id: '3', status: 'failed', preview: 'pytest', error: 'exit 1', ms: 2000 },
  ]
  let t = emptyTotals()
  t = countCall(t, 'Bash', 'done', 300)
  t = countCall(t, 'Bash', 'done', 9000)
  t = countCall(t, 'Bash', 'failed', 2000)
  const text = summaryText(t, calls)
  expect(text).toMatch(/^3 calls · 1 failed · avg 3\.8s/)
  expect(text).toMatch(/By tool: Bash 3/)
  expect(text).toMatch(/✗ Bash pytest — exit 1/)
  expect(text.indexOf('npm run build')).toBeLessThan(text.indexOf('npm test'))
  expect(summaryText(emptyTotals(), [])).toBe('No tool calls yet this session.')
})
