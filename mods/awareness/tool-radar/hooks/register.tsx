import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { RadarCall, RadarStatus } from '../types'
import { countCall, emptyTotals, headerLine, preview, rowLine, summaryText } from './format'

const PANE = 'tool-radar'
const TITLE = 'Tool radar'
// How many calls the pane remembers; the totals count every call.
const CAP = 300

const calls = atom({ plugin: 'tool-radar', key: 'calls' } as const, [])
const totals = atom({ plugin: 'tool-radar', key: 'totals' } as const, emptyTotals())
const errorsOnly = atom({ plugin: 'tool-radar', key: 'errorsOnly' } as const, false)

// Ids for calls that carry no tool_use_id (a plugin's own $.tool.call).
let seq = 0

async function settle($: EngineInterface, id: string, tool: string, status: RadarStatus, startedAt: number, error?: string) {
  const ms = Math.max(0, (await $.clock.now()) - startedAt)
  const cut = error === undefined ? undefined : error.slice(0, 300)
  await update($, calls, list =>
    list.map(call => (call.id === id ? { ...call, status, ms, ...(cut === undefined ? {} : { error: cut }) } : call)),
  )
  await update($, totals, t => countCall(t, tool, status, ms))
}

async function clearAll($: EngineInterface) {
  await update($, calls, () => [])
  await update($, totals, () => emptyTotals())
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'radar',
      description: 'Tool radar: open the live pane, or /radar summary | clear | close',
      argumentHint: '[summary|clear|close]',
      immediate: true,
    })
    if (options.autoOpen === true) void $.ui.open({ id: PANE, title: TITLE })
    return next(e)
  })

  on('command.run', { command: 'radar' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'summary' || arg === 'stats') {
      return { text: summaryText(await read($, totals), await read($, calls)) }
    }
    if (arg === 'clear' || arg === 'reset') {
      await clearAll($)
      return { text: 'Cleared the radar.' }
    }
    if (arg === 'close') {
      await $.ui.close({ id: PANE })
      return {}
    }
    const opened = await $.ui.open({ id: PANE, title: TITLE })
    return opened.isPlaced ? {} : { text: `The radar pane is waiting for room: ${opened.reason}.` }
  })

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    seq += 1
    const id = e.tool_use_id ?? `radar-${seq}`
    const startedAt = await $.clock.now()
    const call: RadarCall = {
      id,
      tool,
      preview: preview(tool, e as unknown as Record<string, unknown>),
      status: 'running',
      startedAt,
      ...(e.agentId === undefined ? {} : { agent: e.agentId }),
    }
    await update($, calls, list => [...list, call].slice(-CAP))

    let ran
    try {
      ran = await next(e)
    } catch (error) {
      await settle($, id, tool, 'failed', startedAt, 'interrupted')
      throw error
    }
    if (ran.deny !== undefined) await settle($, id, tool, 'denied', startedAt, ran.deny)
    else if (ran.isError === true) await settle($, id, tool, 'failed', startedAt, ran.text ?? 'the tool reported an error')
    else await settle($, id, tool, 'done', startedAt)

    return ran
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const list = await read($, calls)
    const sums = await read($, totals)
    const onlyErrors = await read($, errorsOnly)

    const width = Math.max(24, e.props.bodyColumns)
    const running = list.filter(call => call.status === 'running').length
    // Docked beside the transcript the pane has a fixed height; inline it grows.
    const room = e.props.placement === 'dock' ? Math.max(5, e.props.scroll.bodyRows - 3) : 12
    const shown = list
      .filter(call => !onlyErrors || call.status === 'failed' || call.status === 'denied')
      .slice(-room)
      .reverse()

    return (
      <Box flexDirection="column">
        <Text bold wrap="truncate-end">
          {headerLine(sums, running, width)}
        </Text>
        <Box flexDirection="row" columnGap={1}>
          <Button key="clear" label="Clear" hotkey="c" onPress={() => clearAll($)} />
          <Button
            key="errors"
            label={onlyErrors ? 'All calls' : 'Errors only'}
            hotkey="e"
            onPress={() => update($, errorsOnly, value => !value)}
          />
          <Button key="close" label="Close" hotkey="x" role="dismiss" onPress={() => $.ui.close({ id: PANE })} />
        </Box>
        {shown.length === 0 && (
          <Text key="empty" dimColor>
            {onlyErrors ? 'No failed or denied calls.' : 'No tool calls yet. They show here as Claude works.'}
          </Text>
        )}
        {shown.map(call => {
          const row = rowLine(call, width)
          return (
            <Box key={`row-${call.id}`} flexDirection="row">
              <Text color={row.color}>{row.glyph} </Text>
              <Text color={row.color} dimColor={call.status === 'done'} wrap="truncate-end">
                {row.text}
              </Text>
            </Box>
          )
        })}
      </Box>
    )
  })
}
