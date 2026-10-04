// Pure helpers: no `$`, so the tests and other mods can import them.

import type { RadarCall, RadarStatus, RadarTotals } from '../types'

export const GLYPH: Record<RadarStatus, string> = {
  running: '◐',
  done: '✓',
  failed: '✗',
  denied: '⊘',
}

export const COLOR: Record<RadarStatus, string | undefined> = {
  running: 'yellow',
  done: undefined,
  failed: 'red',
  denied: 'magenta',
}

export function emptyTotals(): RadarTotals {
  return { calls: 0, failed: 0, denied: 0, totalMs: 0, byTool: {} }
}

/** `mcp__github__search_issues` → `{ server: 'github', name: 'search_issues' }`. */
export function mcpParts(tool: string): { server: string; name: string } | undefined {
  if (!tool.startsWith('mcp__')) return undefined
  const [, server = '', ...rest] = tool.split('__')
  return { server, name: rest.join('__') }
}

/** The short name a call is counted and listed under: `Bash`, `mcp:github`. */
export function toolLabel(tool: string): string {
  const mcp = mcpParts(tool)
  return mcp === undefined ? tool : `mcp:${mcp.server}`
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function shortPath(path: string): string {
  const parts = path.split(/[\\/]/).filter(p => p !== '')
  return parts.slice(-2).join('/') || path
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** A one-line look at a call's arguments, at most 200 characters. */
export function preview(tool: string, input: Readonly<Record<string, unknown>>): string {
  const mcp = mcpParts(tool)
  let text: string
  switch (tool) {
    case 'Bash':
      text = str(input.command) ?? ''
      break
    case 'Read':
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
      text = shortPath(str(input.file_path) ?? '')
      break
    case 'NotebookEdit':
      text = shortPath(str(input.notebook_path) ?? '')
      break
    case 'Grep':
    case 'Glob':
      text = [str(input.pattern), str(input.path) && `in ${shortPath(String(input.path))}`].filter(Boolean).join(' ')
      break
    case 'WebFetch':
      text = (str(input.url) ?? '').replace(/^https?:\/\//, '')
      break
    case 'WebSearch':
    case 'ToolSearch':
      text = str(input.query) ?? ''
      break
    case 'Agent':
    case 'Task':
      text = [str(input.subagent_type) && `[${String(input.subagent_type)}]`, str(input.description)].filter(Boolean).join(' ')
      break
    case 'Skill':
      text = str(input.skill) ?? str(input.name) ?? ''
      break
    case 'TodoWrite':
      text = Array.isArray(input.todos) ? `${input.todos.length} todos` : ''
      break
    default: {
      const first = Object.entries(input).find(([key, value]) => key !== 'tool' && key !== 'tool_use_id' && key !== 'agentId' && typeof value === 'string')
      const arg = first === undefined ? '' : String(first[1])
      text = mcp === undefined ? arg : `${mcp.name} ${arg}`.trim()
    }
  }
  return oneLine(text).slice(0, 200)
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.round((ms % 60_000) / 1000)
  return `${minutes}m${String(seconds).padStart(2, '0')}s`
}

/** Adds one finished call to the running totals. */
export function countCall(totals: RadarTotals, tool: string, status: RadarStatus, ms: number): RadarTotals {
  const label = toolLabel(tool)
  return {
    calls: totals.calls + 1,
    failed: totals.failed + (status === 'failed' ? 1 : 0),
    denied: totals.denied + (status === 'denied' ? 1 : 0),
    totalMs: totals.totalMs + ms,
    byTool: { ...totals.byTool, [label]: (totals.byTool[label] ?? 0) + 1 },
  }
}

/** Tools by count, most used first. */
export function topTools(totals: RadarTotals): Array<[string, number]> {
  return Object.entries(totals.byTool).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

function fit(text: string, width: number): string {
  if (width <= 0) return ''
  if (text.length <= width) return text
  return width === 1 ? '…' : `${text.slice(0, width - 1)}…`
}

/** `42 calls · 3 failed · 1 running · avg 1.2s · Bash 20 Edit 12`, cut to `width`. */
export function headerLine(totals: RadarTotals, running: number, width: number): string {
  const parts = [`${totals.calls + running} call${totals.calls + running === 1 ? '' : 's'}`]
  if (totals.failed > 0) parts.push(`${totals.failed} failed`)
  if (totals.denied > 0) parts.push(`${totals.denied} denied`)
  if (running > 0) parts.push(`${running} running`)
  if (totals.calls > 0) parts.push(`avg ${formatDuration(totals.totalMs / totals.calls)}`)
  let line = parts.join(' · ')
  const tools = topTools(totals)
  if (tools.length > 0) {
    let tail = ''
    for (const [label, count] of tools) {
      const next = `${tail}${tail === '' ? '' : ' '}${label} ${count}`
      if (line.length + 3 + next.length > width) break
      tail = next
    }
    if (tail !== '') line = `${line} · ${tail}`
  }
  return fit(line, width)
}

/**
 * One row of the list, as `glyph` and the `text` after it, `width` cells in
 * all: `✓ Bash      npm test                     1.2s`.
 */
export function rowLine(call: RadarCall, width: number): { glyph: string; color: string | undefined; text: string } {
  const room = Math.max(10, width - 2)
  const nested = call.agent === undefined ? '' : '↳ '
  const name = fit(`${nested}${toolLabel(call.tool)}`, 12).padEnd(12)
  const time = call.status === 'running' ? '…' : formatDuration(call.ms ?? 0)
  const rest = room - name.length - 1 - time.length - 1
  const detail = call.status === 'failed' || call.status === 'denied'
    ? [call.preview, call.error && `— ${oneLine(call.error)}`].filter(Boolean).join(' ')
    : call.preview
  const middle = rest > 0 ? fit(detail, rest).padEnd(rest) : ''
  const text = rest > 0 ? `${name} ${middle} ${time}` : fit(`${name} ${time}`, room)

  return { glyph: GLYPH[call.status], color: COLOR[call.status], text }
}

/** The text `/radar summary` prints. */
export function summaryText(totals: RadarTotals, calls: readonly RadarCall[]): string {
  const running = calls.filter(c => c.status === 'running').length
  if (totals.calls + running === 0) return 'No tool calls yet this session.'

  const lines = [headerLine({ ...totals, byTool: {} }, running, 200)]
  const tools = topTools(totals)
  if (tools.length > 0) lines.push(`By tool: ${tools.map(([label, count]) => `${label} ${count}`).join(' · ')}`)

  const failures = calls.filter(c => c.status === 'failed' || c.status === 'denied').slice(-8)
  if (failures.length > 0) {
    lines.push('', 'Failures (newest last):')
    for (const c of failures) {
      const why = c.error === undefined ? '' : ` — ${fit(oneLine(c.error), 100)}`
      lines.push(`  ${GLYPH[c.status]} ${toolLabel(c.tool)} ${fit(c.preview, 60)}${why}`)
    }
  }

  const slowest = calls.filter(c => c.ms !== undefined).sort((a, b) => (b.ms ?? 0) - (a.ms ?? 0)).slice(0, 5)
  if (slowest.length > 0) {
    lines.push('', 'Slowest:')
    for (const c of slowest) lines.push(`  ${formatDuration(c.ms ?? 0).padStart(7)}  ${toolLabel(c.tool)} ${fit(c.preview, 70)}`)
  }
  return lines.join('\n')
}
