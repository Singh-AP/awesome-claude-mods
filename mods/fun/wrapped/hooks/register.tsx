import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderSurface } from 'claude-code'

import type { Summary } from '../types'
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
  hourOf,
  isCommit,
  lineCount,
  merge,
  num,
  shareCard,
  summarize,
  yearOf,
  type Tally,
} from './stats'

const PANE = 'wrapped'
const summary = atom({ plugin: 'wrapped', key: 'summary' } as const, null)

// Session records kept whole before old ones are folded into their year.
const KEEP_SESSIONS = 60
const FOLD_AT = 120

// What this session counted since the last write; a reload loses at most a turn of it.
let fresh: Tally = emptyTally(Number.MAX_SAFE_INTEGER)
let project = ''
let costSeen = 0
let shareCost = false

const isHuman = (kind: string) => kind === 'composer' || kind === 'bridge' || kind === 'sdk'

/** Adds what this session counted to its own record. Only this session writes that key. */
async function flush($: EngineInterface) {
  const now = await $.clock.now()
  const key = `s:${await $.session.id()}`
  const stored = asTally(await $.store.get(key), now)
  const merged = absorb(stored, fresh)
  merged.lastAt = now
  const usage = await $.session.usage()
  const reading = usage.cost?.usd
  if (typeof reading === 'number') {
    merged.cost = stored.cost + fresh.cost + costDelta(costSeen, reading)
    merged.costSeen = reading
    costSeen = reading
  }
  fresh = emptyTally(Number.MAX_SAFE_INTEGER)
  await $.store.set(key, merged)
}

/** Folds the oldest session records into one record per year, so the store stays small. */
async function fold($: EngineInterface) {
  const now = await $.clock.now()
  const current = `s:${await $.session.id()}`
  const keys = (await $.store.keys()).filter(k => k.startsWith('s:') && k !== current)
  if (keys.length < FOLD_AT) return
  const records: { key: string; tally: Tally }[] = []
  for (const key of keys) records.push({ key, tally: asTally(await $.store.get(key), now) })
  records.sort((a, b) => a.tally.lastAt - b.tally.lastAt)
  const old = records.slice(0, records.length - KEEP_SESSIONS)
  const years = new Map<string, Tally>()
  for (const { tally } of old) {
    const year = yearOf(tally.firstAt)
    const into = years.get(year) ?? asTally(await $.store.get(`y:${year}`), tally.firstAt)
    years.set(year, merge(into, tally))
  }
  for (const [year, tally] of years) await $.store.set(`y:${year}`, tally)
  for (const { key } of old) await $.store.delete(key)
}

/** Sums every record for `year` ('all' for a lifetime). */
async function gather($: EngineInterface, year: string): Promise<Summary> {
  await flush($)
  const now = await $.clock.now()
  let total: Tally | undefined
  for (const key of await $.store.keys()) {
    const isSession = key.startsWith('s:')
    if (!isSession && !key.startsWith('y:')) continue
    const tally = asTally(await $.store.get(key), now)
    if (year !== 'all' && (isSession ? yearOf(tally.firstAt) : key.slice(2)) !== year) continue
    total = total === undefined ? tally : merge(total, tally)
  }
  const label = year === 'all' ? 'Claude Code Wrapped · all time' : `Claude Code Wrapped · ${year}`
  return summarize(total ?? emptyTally(now), label, dayKey(now))
}

/** `''` this year, `all`, or a four-digit year; undefined for anything else. */
async function yearFrom($: EngineInterface, arg: string): Promise<string | undefined> {
  if (arg === '') return yearOf(await $.clock.now())
  if (arg === 'all' || /^\d{4}$/.test(arg)) return arg
  return undefined
}

async function copyCard($: EngineInterface, surface: RenderSurface) {
  const shown = await read($, summary)
  if (shown === null) return
  const copied = await $.ui.copy({ text: shareCard(shown, shareCost), surface })
  $.ui.toast(copied.isCopied ? 'Share card copied. Paste it anywhere! ✨' : `Could not copy: ${copied.reason}`)
}

export const register: Register = (on, options) => {
  shareCost = options.shareCost === true

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'wrapped',
      description: 'Your Claude Code year in review. /wrapped [year|all] · text · reset',
      argumentHint: '[year | all | text [year|all] | reset]',
    })
    const root = await $.session.root()
    project = root.split(/[\\/]/).filter(Boolean).pop() ?? root
    const now = await $.clock.now()
    const own = asTally(await $.store.get(`s:${await $.session.id()}`), now)
    costSeen = own.costSeen
    await fold($)
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (isHuman(e.origin.kind)) {
      fresh.prompts += 1
      fresh.hours[hourOf(await $.clock.now())]! += 1
    }
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined) return ran
    fresh.tools[e.tool] = (fresh.tools[e.tool] ?? 0) + 1
    const isError = ran.isError === true
    if (isError) {
      fresh.failed += 1
      return ran
    }
    if (e.tool === 'Edit') {
      fresh.lines += lineCount(e.new_string)
      fresh.files.push(hashPath(e.file_path))
    } else if (e.tool === 'Write') {
      fresh.lines += lineCount(e.content)
      fresh.files.push(hashPath(e.file_path))
    } else if (e.tool === 'Bash' && isCommit(e.command, ran.text ?? '', isError)) {
      fresh.commits += 1
    }
    return ran
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    const today = dayKey(await $.clock.now())
    fresh.turns += 1
    fresh.turnMs += e.durationMs
    fresh.longestTurnMs = Math.max(fresh.longestTurnMs, e.durationMs)
    fresh.days[today] = (fresh.days[today] ?? 0) + 1
    if (project !== '') fresh.projects[project] = (fresh.projects[project] ?? 0) + 1
    await flush($)
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    await flush($)
    return next(e)
  })

  on('command.run', { command: 'wrapped' }, async ($, e) => {
    const [verb = '', arg = ''] = e.args.trim().toLowerCase().split(/\s+/)

    if (verb === 'reset') {
      let answer = ''
      try {
        answer = await $.ui.ask('Wipe every wrapped stat on this machine? This cannot be undone.', {
          header: 'wrapped',
          options: ['Wipe my stats', 'Keep them'],
        })
      } catch {
        // Nobody to ask: keep everything.
      }
      if (answer !== 'Wipe my stats') return { text: 'wrapped: kept your stats.' }
      for (const key of await $.store.keys()) await $.store.delete(key)
      fresh = emptyTally(Number.MAX_SAFE_INTEGER)
      costSeen = 0
      await update($, summary, () => null)
      return { text: 'wrapped: all stats wiped. Counting starts fresh from now.' }
    }

    if (verb === 'text') {
      const year = await yearFrom($, arg)
      if (year === undefined) return { text: 'Usage: /wrapped text [year|all]' }
      const shown = await gather($, year)
      if (shown.isEmpty) return { text: `${shown.label}: nothing counted yet. wrapped counts from the day it was installed.` }
      return { text: shareCard(shown, shareCost) }
    }

    const year = await yearFrom($, verb)
    if (year === undefined) return { text: 'Usage: /wrapped [year|all] · /wrapped text [year|all] · /wrapped reset' }
    const shown = await gather($, year)
    await update($, summary, () => shown)
    const opened = await $.ui.open({ id: PANE, title: 'Wrapped', focus: true, closeOnEscape: true })
    return opened.isPlaced ? {} : { text: shareCard(shown, shareCost) }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const shown = await read($, summary)
    const width = Math.max(24, Math.min(e.props.bodyColumns, 72))

    if (shown === null || shown.isEmpty) {
      return (
        <Box flexDirection="column" gap={1} width={width}>
          <Text bold color="#c084fc">
            ✦ {shown?.label ?? 'Claude Code Wrapped'} ✦
          </Text>
          <Text>Nothing counted yet. wrapped keeps score from the day it was installed: come back after a few turns.</Text>
          <Button key="close" label="Close" role="dismiss" hotkey="x" onPress={() => $.ui.close({ id: PANE })} />
        </Box>
      )
    }

    const perRow = width >= 54 ? 3 : 2
    const cell = Math.floor(width / perRow)
    const headline: [string, string][] = [
      [num(shown.prompts), 'prompts'],
      [num(shown.sessions), 'sessions'],
      [duration(shown.turnMs), 'with Claude'],
      [num(shown.toolCalls), 'tool calls'],
      [num(shown.lines), 'lines written'],
      [num(shown.commits), 'commits'],
    ]
    const rows: [string, string][][] = []
    for (let i = 0; i < headline.length; i += perRow) rows.push(headline.slice(i, i + perRow))

    const maxCount = shown.topTools[0]?.count ?? 0
    const nameWidth = Math.max(4, ...shown.topTools.map(t => t.name.length))
    const barWidth = Math.max(4, width - nameWidth - 10)
    const facts = [
      shown.streak.longest > 0 ? `🔥 ${shown.streak.current}-day streak · best ${shown.streak.longest}` : '',
      shown.busiestHour >= 0 ? `🕐 busiest hour ${hourLabel(shown.busiestHour)}` : '',
      shown.longestTurnMs > 0 ? `⏱  longest turn ${duration(shown.longestTurnMs)}` : '',
      shown.topProject !== '' ? `📁 top project ${shown.topProject}` : '',
      shown.files > 0 ? `📄 ${num(shown.files)} files touched` : '',
      shown.cost > 0 ? `💸 $${shown.cost.toFixed(2)} of tokens` : '',
    ].filter(f => f !== '')

    return (
      <Box flexDirection="column" width={width}>
        <Text bold color="#c084fc">
          ✦ {shown.label.toUpperCase()} ✦
        </Text>
        <Text> </Text>
        <Box flexDirection="row" gap={1}>
          <Text>You are</Text>
          <Text bold color="#fbbf24">
            {shown.persona.emoji} {shown.persona.title}
          </Text>
        </Box>
        <Text dimColor wrap="wrap">
          {shown.persona.blurb}
        </Text>
        <Text> </Text>
        {rows.map(row => (
          <Box flexDirection="column" marginBottom={1}>
            <Box flexDirection="row">
              {row.map(([value]) => (
                <Box width={cell}>
                  <Text bold color="#34d399">
                    {value}
                  </Text>
                </Box>
              ))}
            </Box>
            <Box flexDirection="row">
              {row.map(([, name]) => (
                <Box width={cell}>
                  <Text dimColor>{name}</Text>
                </Box>
              ))}
            </Box>
          </Box>
        ))}
        {shown.topTools.length > 0 && <Text bold>Top tools</Text>}
        {shown.topTools.map(tool => (
          <Box flexDirection="row" gap={1}>
            <Box width={nameWidth}>
              <Text>{tool.name}</Text>
            </Box>
            <Text color="#60a5fa">{bar(tool.count, maxCount, barWidth)}</Text>
            <Text dimColor>{num(tool.count)}</Text>
          </Box>
        ))}
        <Text> </Text>
        {facts.map(fact => (
          <Text wrap="truncate-end">{fact}</Text>
        ))}
        <Text> </Text>
        <Box flexDirection="row" gap={2}>
          <Button
            key="copy"
            label="Copy share card"
            hotkey="c"
            variant="primary"
            autoFocus
            onPress={press => copyCard($, press.surface)}
          />
          <Button key="close" label="Close" role="dismiss" hotkey="x" onPress={() => $.ui.close({ id: PANE })} />
        </Box>
      </Box>
    )
  })
}
