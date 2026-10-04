import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Look, Mood, Pet, Species } from '../types'
import { drawFace, drawPet, isSpecies, SPECIES } from './art'
import { isFleeting, levelOf, moodWord, outcomeOf, toolLine, XP, xpBar, xpForLevel } from './pet'

const look = atom({ plugin: 'buddy', key: 'look' } as const, { mood: 'idle', line: '' })
const frame = atom({ plugin: 'buddy', key: 'frame' } as const, 0)
const pet = atom({ plugin: 'buddy', key: 'pet' } as const, { name: 'Byte', species: 'cat', xp: 0 })
const isHidden = atom({ plugin: 'buddy', key: 'isHidden' } as const, false)

type Stats = { toolCalls: number; turns: number; commits: number; greenTests: number; errors: number }
const NO_STATS: Stats = { toolCalls: 0, turns: 0, commits: 0, greenTests: 0, errors: 0 }

const count = (n: number, noun: string) => `${n.toLocaleString('en-US')} ${noun}${n === 1 ? '' : 's'}`

const COLORS: Record<Species, string> = {
  cat: '#f5a623',
  dog: '#c08552',
  blob: '#7ed957',
  robot: '#4fc3f7',
  ghost: '#b0bec5',
  duck: '#ffd54f',
}

// The module's own clockwork. A reload drops every timer with the old module.
let defaults: { name: string; species: Species } = { name: 'Byte', species: 'cat' }
let sleepAfterMs = 120_000
let isTurnRunning = false
let animation: Timer | undefined
let napping: Timer | undefined
let settling: Timer | undefined
// XP and counts earned since the last write to the store.
let pendingXp = 0
let pending: Stats = { ...NO_STATS }

function stopAnimation() {
  animation?.cancel()
  animation = undefined
}

/** Shows a mood. Only working and partying animate, so an idle pet runs no loop. */
async function show($: EngineInterface, mood: Mood, line: string) {
  await update($, look, () => ({ mood, line }))
  if (mood === 'work' || mood === 'party') {
    if (animation === undefined) animation = $.clock.every(500, () => void update($, frame, f => (f + 1) % 2))
  } else {
    stopAnimation()
  }
}

/** After a quiet spell the pet falls asleep: one pending timer, no polling. */
function napLater($: EngineInterface) {
  napping?.cancel()
  napping = $.clock.after(sleepAfterMs, () => {
    napping = undefined
    void show($, 'sleep', '')
  })
}

function wake() {
  napping?.cancel()
  napping = undefined
}

/** What the pet goes back to once a fleeting mood has had its moment. */
async function settle($: EngineInterface) {
  settling = undefined
  if (isTurnRunning) return show($, 'think', '')
  await show($, 'idle', '')
  napLater($)
}

/** A mood that lasts a few seconds, then gives way to what is going on. */
async function flash($: EngineInterface, mood: Mood, line: string) {
  settling?.cancel()
  await show($, mood, line)
  settling = $.clock.after(3500, () => void settle($))
}

async function award($: EngineInterface, xp: number, counts: Partial<Stats>) {
  pendingXp += xp
  for (const [key, value] of Object.entries(counts) as [keyof Stats, number][]) pending[key] += value
  const before = (await read($, pet)).xp
  const now = await update($, pet, p => ({ ...p, xp: p.xp + xp }))
  const level = levelOf(now.xp)
  if (level > levelOf(before)) {
    $.ui.toast(`🎉 ${now.name} reached level ${level}!`)
    await flash($, 'party', `🎉 level ${level}!`)
  }
}

/** Adds what this session earned to the store, read fresh so other sessions' XP counts too. */
async function flush($: EngineInterface) {
  if (pendingXp === 0 && Object.values(pending).every(v => v === 0)) return
  const xp = Number((await $.store.get('xp')) ?? 0) + pendingXp
  const saved = { ...NO_STATS, ...((await $.store.get('stats')) as Partial<Stats> | undefined) }
  const stats: Stats = { ...saved }
  for (const key of Object.keys(pending) as (keyof Stats)[]) stats[key] = saved[key] + pending[key]
  pendingXp = 0
  pending = { ...NO_STATS }
  await $.store.set('xp', xp)
  await $.store.set('stats', stats)
  await update($, pet, p => ({ ...p, xp }))
}

/** Loads who the pet is from the store: at start, and again after /clear wipes $.state. */
async function loadPet($: EngineInterface) {
  const name = (await $.store.get('name')) as string | undefined
  const species = (await $.store.get('species')) as string | undefined
  const xp = Number((await $.store.get('xp')) ?? 0) + pendingXp
  const loaded: Pet = {
    name: name ?? defaults.name,
    species: species !== undefined && isSpecies(species) ? species : defaults.species,
    xp,
  }
  const hidden = (await $.store.get('hidden')) === true
  await update($, pet, () => loaded)
  await update($, isHidden, () => hidden)
}

export const register: Register = (on, options) => {
  const species = String(options.species ?? 'cat')
  defaults = { name: String(options.name ?? 'Byte').trim() || 'Byte', species: isSpecies(species) ? species : 'cat' }
  sleepAfterMs = Math.max(10, Number(options.sleepAfterSeconds ?? 120)) * 1000

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'buddy',
      description: 'Your pet: stats, or /buddy name <name> · species <kind> · hide · show',
      argumentHint: '[name <name> | species <kind> | hide | show]',
    })
    await loadPet($)
    napLater($)
    return next(e)
  })

  on('classic.SessionStart', async ($, e, next) => {
    if (e.source === 'clear') await loadPet($)
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    isTurnRunning = true
    wake()
    if (settling === undefined) await show($, 'think', '')
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    wake()
    const input = e as unknown as Record<string, unknown>
    if (settling === undefined) await show($, 'work', toolLine(e.tool, input))
    const ran = await next(e)
    const outcome = outcomeOf(e.tool, input, ran)
    await award($, outcome.xp, {
      toolCalls: 1,
      commits: outcome.commits,
      greenTests: outcome.greenTests,
      errors: outcome.errors,
    })
    if (isFleeting(outcome.mood)) await flash($, outcome.mood, outcome.line)
    else if (settling === undefined && isTurnRunning) await show($, 'think', '')
    return ran
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    isTurnRunning = false
    await award($, XP.turn, { turns: 1 })
    await flush($)
    if (settling === undefined) {
      await show($, 'idle', '')
      napLater($)
    }
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    await flush($)
    return next(e)
  })

  on('command.run', { command: 'buddy' }, async ($, e) => {
    const [verb = '', ...rest] = e.args.trim().split(/\s+/)
    const value = rest.join(' ').trim()
    const current = await read($, pet)

    if (verb === 'name') {
      if (value === '') {
        await $.store.delete('name')
        await update($, pet, p => ({ ...p, name: defaults.name }))
        return { text: `Your ${current.species} is called ${defaults.name} again.` }
      }
      const name = value.slice(0, 24)
      await $.store.set('name', name)
      await update($, pet, p => ({ ...p, name }))
      await flash($, 'happy', `💖 I'm ${name} now!`)
      return { text: `Your ${current.species} is now called ${name}.` }
    }
    if (verb === 'species') {
      if (!isSpecies(value)) return { text: `Pick one of: ${SPECIES.join(', ')}.` }
      await $.store.set('species', value)
      await update($, pet, p => ({ ...p, species: value }))
      await flash($, 'happy', `✨ ta-da!`)
      return { text: `${current.name} is a ${value} now.` }
    }
    if (verb === 'hide' || verb === 'show') {
      const hide = verb === 'hide'
      await $.store.set('hidden', hide)
      await update($, isHidden, () => hide)
      return { text: hide ? `${current.name} is hiding. /buddy show brings them back.` : `${current.name} is back!` }
    }
    if (verb !== '') return { text: 'Usage: /buddy · /buddy name <name> · /buddy species <kind> · /buddy hide · /buddy show' }

    await flush($)
    const now = await read($, pet)
    const stats = { ...NO_STATS, ...((await $.store.get('stats')) as Partial<Stats> | undefined) }
    const level = levelOf(now.xp)
    const need = xpForLevel(level + 1)
    const art = drawPet(now.species, 'happy', 0)
    const lines = [
      `${xpBar(now.xp, 16)} ${now.xp}/${need} XP to level ${level + 1}`,
      `${count(stats.toolCalls, 'tool call')} · ${count(stats.turns, 'turn')} · ${count(stats.commits, 'commit')}`,
      `${count(stats.greenTests, 'green test run')} · ${count(stats.errors, 'oopsie')}`,
    ]
    const title = `${now.name} the ${now.species} · level ${level}`
    return { text: [title, ...art.map((row, i) => `${row}  ${lines[i] ?? ''}`)].join('\n') }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, isHidden))) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const now = await read($, pet)
    const seen = await read($, look)
    const mood: Mood = seen.mood === 'idle' && e.props.isWorking ? 'think' : seen.mood
    const line = seen.line || moodWord(mood)
    const level = levelOf(now.xp)
    const color = COLORS[now.species]
    // The band is shared: draw the mods beneath this one under the pet.
    const below = await next(e)

    if (e.props.bodyColumns < 44) {
      return (
        <Box flexDirection="column">
          <Box flexDirection="row" gap={1}>
            <Text color={color}>{drawFace(now.species, mood)}</Text>
            <Text bold>{now.name}</Text>
            <Text dimColor wrap="truncate-end">
              {line}
            </Text>
          </Box>
          {below}
        </Box>
      )
    }

    const rows = drawPet(now.species, mood, await read($, frame))
    const barWidth = Math.min(20, Math.max(8, e.props.bodyColumns - 48))
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Box flexDirection="column">
            {rows.map(row => (
              <Text color={color}>{row}</Text>
            ))}
          </Box>
          <Box flexDirection="column" flexShrink={1}>
            <Box flexDirection="row" gap={1}>
              <Text bold>{now.name}</Text>
              <Text dimColor>
                Lv {level} {now.species}
              </Text>
            </Box>
            <Box flexDirection="row" gap={1}>
              <Text color="#ffd54f">{xpBar(now.xp, barWidth)}</Text>
              <Text dimColor>
                {now.xp}/{xpForLevel(level + 1)} XP
              </Text>
            </Box>
            <Text wrap="truncate-end">{line}</Text>
          </Box>
        </Box>
        {below}
      </Box>
    )
  })
}
