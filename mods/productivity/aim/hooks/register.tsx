import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AimDone, AimGoal } from '../types'
import { clip, focusPrompt, formatDuration, HISTORY_LIMIT, parseFocus } from './format'

const goal = atom({ plugin: 'aim', key: 'goal' } as const, null)

const SECTION = 'aim:goal'
const USAGE = 'Usage: /aim <goal> · /aim done · /aim clear · /aim history'

async function goalKey($: EngineInterface): Promise<string> {
  return `goal:${await $.session.root()}`
}

/** Copies this project's saved goal from $.store into $.state. */
async function loadGoal($: EngineInterface): Promise<void> {
  const saved = (await $.store.get(await goalKey($))) as AimGoal | undefined
  await update($, goal, () => saved ?? null)
}

/** Writes the goal to $.state (which redraws the band) and keeps it in $.store. */
async function saveGoal($: EngineInterface, next: AimGoal | null): Promise<void> {
  await update($, goal, () => next)
  const key = await goalKey($)
  if (next === null) await $.store.delete(key)
  else await $.store.set(key, next)
}

/** Ends the goal, records it, and says how long it took. */
async function finishGoal($: EngineInterface): Promise<string> {
  const current = await read($, goal)
  if (current === null) return `No aim is set. ${USAGE}`
  const now = await $.clock.now()
  const took = formatDuration(now - current.startedAt)
  const history = ((await $.store.get('history')) as AimDone[] | undefined) ?? []
  const done: AimDone = { ...current, endedAt: now, root: await $.session.root() }
  await $.store.set('history', [...history, done].slice(-HISTORY_LIMIT))
  await saveGoal($, null)
  $.ui.toast(`Aim done in ${took} 🎉`)
  return `Done: "${current.text}" in ${took}.`
}

async function clearGoal($: EngineInterface): Promise<string> {
  const current = await read($, goal)
  await saveGoal($, null)
  return current === null ? 'No aim was set.' : `Cleared the aim "${current.text}".`
}

async function listHistory($: EngineInterface): Promise<string> {
  const list = ((await $.store.get('history')) as AimDone[] | undefined) ?? []
  if (list.length === 0) return 'No finished goals yet. Finish one with /aim done.'
  const lines = list
    .slice(-10)
    .reverse()
    .map(one => {
      const day = new Date(one.endedAt).toISOString().slice(0, 10)
      return `  ${day}  ${formatDuration(one.endedAt - one.startedAt).padStart(7)}  ${clip(one.text, 70)}`
    })
  return `Recent goals (newest first):\n${lines.join('\n')}`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await loadGoal($)
    try {
      await $.command.register({
        name: 'aim',
        description: 'Pin one goal for this session (/aim <goal>), or: done, clear, history',
        argumentHint: '<goal> | done | clear | history',
      })
    } catch (error) {
      $.ui.log(`aim: could not add /aim: ${String(error)}`, { to: 'debug' })
    }
    // The band shows minutes, so a redraw a minute keeps it right.
    if (e.isInteractive) $.clock.every(60_000, () => $.ui.invalidate('ui.render'))
    return next(e)
  })

  // /clear, /resume and /branch reset $.state without a new session.start.
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    await loadGoal($)
    return next(e)
  })

  on('command.run', { command: 'aim' }, async ($, e) => {
    const command = parseFocus(e.args)
    switch (command.kind) {
      case 'done':
        return { text: await finishGoal($) }
      case 'clear':
        return { text: await clearGoal($) }
      case 'history':
        return { text: await listHistory($) }
      case 'show': {
        const current = await read($, goal)
        if (current === null) return { text: `No aim is set. ${USAGE}` }
        const elapsed = formatDuration((await $.clock.now()) - current.startedAt)
        return { text: `Aim: "${current.text}" (${elapsed} so far). ${USAGE}` }
      }
      case 'set': {
        const before = await read($, goal)
        await saveGoal($, { text: command.goal, startedAt: await $.clock.now() })
        const replaced = before === null ? '' : ` (replaces "${before.text}")`
        return { text: `Aim set: "${command.goal}"${replaced}. Claude will stay on it and flag unrelated work.` }
      }
    }
  })

  // The goal rides in the system prompt, after the cached shared sections.
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    const current = await read($, goal)
    if (current === null || e.traits.includes('bare')) return composed
    const sections = composed.sections.filter(section => section.id !== SECTION)
    return { sections: [...sections, { id: SECTION, text: focusPrompt(current.text), scope: 'session' as const }] }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const current = await read($, goal)
    if (current === null || e.props.hasSurvey) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const elapsed = formatDuration((await $.clock.now()) - current.startedAt)
    const room = Math.max(12, e.props.bodyColumns - elapsed.length - 26)
    // Keep what the mods after this one draw in the band.
    const below = await next(e)

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Text dimColor wrap="truncate-end">
            🎯 {clip(current.text, room)} · {elapsed}
          </Text>
          <Button key="done" label="Done" onPress={() => finishGoal($)} />
          <Button key="clear" label="Clear" onPress={() => clearGoal($)} />
        </Box>
        {below}
      </Box>
    )
  })
}
