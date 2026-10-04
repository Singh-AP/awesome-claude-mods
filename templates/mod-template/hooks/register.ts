import type { Register } from 'claude-code'

import { describeCounts } from './counts'

// Module state starts over on every hot reload; keep what must survive in
// $.state (this session) or $.store (across sessions).
const counts = new Map<string, number>()

export const register: Register = (on, options) => {
  const label = String(options.label ?? 'tools')

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'my-mod', description: 'Show tool calls by tool' })
    return next(e)
  })

  // Every tool call, main thread and subagents. `next(e)` runs it.
  on('tool.call', async ($, e, next) => {
    counts.set(e.tool, (counts.get(e.tool) ?? 0) + 1)
    const total = [...counts.values()].reduce((a, b) => a + b, 0)
    $.ui.status(`${label}: ${total}`)
    return next(e)
  })

  on('command.run', { command: 'my-mod' }, async () => ({ text: describeCounts(counts) }))
}
