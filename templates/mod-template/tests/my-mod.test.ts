import { expect, test } from 'claude-code/testing'

import { describeCounts } from '../hooks/counts'

const TYPED = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } } as const

test('counts tool calls and shows them in the status line', async ($, on) => {
  const statuses: (string | undefined)[] = []
  on('ui.status', ($, e) => (statuses.push(e.text), { value: undefined }))
  on('tool.call', () => ({ result: 'ok' }))

  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.tool.call({ tool: 'Read', file_path: 'README.md' })
  await $.tool.call({ tool: 'Bash', command: 'pwd' })

  expect(statuses.at(-1)).toBe('tools: 3')
  const out = await $.command.run({ command: 'my-mod', args: '', ...TYPED })
  expect(out.text).toBe('Bash: 2\nRead: 1')
})

test('the label option changes the status line', { options: { label: 'calls' } }, async ($, on) => {
  const statuses: (string | undefined)[] = []
  on('ui.status', ($, e) => (statuses.push(e.text), { value: undefined }))
  on('tool.call', () => ({ result: 'ok' }))

  await $.tool.call({ tool: 'Bash', command: 'ls' })

  expect(statuses.at(-1)).toBe('calls: 1')
})

test('describeCounts handles no calls', () => {
  expect(describeCounts(new Map())).toBe('No tool calls yet.')
})
