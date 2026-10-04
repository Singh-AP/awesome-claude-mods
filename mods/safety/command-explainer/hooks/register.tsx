import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelCompleteResult, Register } from 'claude-code'

import { formatNotice, isPending, isPlain, keepLatest, linesForGroup, Lru, parseExplanation, promptFor, SYSTEM } from './explain'

// The line drawn under each Bash call's row while it waits or runs, by tool_use_id.
const lines = atom({ plugin: 'command-explainer', key: 'lines' } as const, {})

// Explanations by exact command, so a repeat costs nothing; a reload starts it over.
const explained = new Lru<string, string>(200)
// Set once the configured model was refused (an organization's allowlist):
// the session's own model answers from then on.
let isModelRefused = false
let shownCount = 0

async function askModel($: EngineInterface, model: string, command: string): Promise<ModelCompleteResult | undefined> {
  const request = { system: SYSTEM, prompt: promptFor(command), maxTokens: 80, effort: 'low' as const, timeoutMs: 15000 }
  if (!isModelRefused) {
    try {
      return await $.model.complete({ model, ...request })
    } catch {
      isModelRefused = true
    }
  }
  try {
    return await $.model.complete({ model: await $.session.model(), ...request })
  } catch {
    return undefined
  }
}

/** One line on what `command` does, from the cache or one small model call. */
async function explainCommand($: EngineInterface, model: string, command: string): Promise<string | undefined> {
  const cached = explained.get(command)
  if (cached !== undefined) return cached
  const reply = await askModel($, model, command)
  if (reply === undefined || !reply.isAnswered) return undefined
  const parsed = parseExplanation(reply.text)
  if (parsed === undefined) return undefined
  const line = formatNotice(parsed)
  explained.set(command, line)
  return line
}

/** Explains the call where it is approved, if the person is about to be asked. */
async function explainIfAsked($: EngineInterface, toolUseId: string, command: string, model: string, minLength: number): Promise<void> {
  if (command.trim().length < minLength || isPlain(command)) return
  const { decision } = await $.tool.check({ tool: 'Bash', input: { command } })
  if (decision !== 'ask') return
  const line = await explainCommand($, model, command)
  if (line === undefined) return
  shownCount += 1
  $.ui.notice(toolUseId, line)
  await update($, lines, prev => keepLatest({ ...prev, [toolUseId]: line }, 20))
}

export const register: Register = (on, options) => {
  const model = String(options.model ?? 'haiku')
  const minLength = Number(options.minLength ?? 0)

  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: 'explain',
        description: 'Explain a shell command in one plain sentence, with its risk',
        argumentHint: '<command>',
      })
    } catch {
      // Explanations at the permission prompt work without the command.
    }
    return next(e)
  })

  // The call goes on at once; the explanation lands when the model answers.
  on('tool.call', { tool: 'Bash' }, ($, e, next) => {
    if (e.tool_use_id !== undefined) {
      void explainIfAsked($, e.tool_use_id, e.command, model, minLength).catch(() => undefined)
    }
    return next(e)
  })

  // Under the call's row, right above its permission dialog, until the call
  // resolves. A pending call is usually drawn inside a collapsed group of calls.
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    const known = await read($, lines)
    const drawn = await next(e)
    const shown = e.props.isExpanded ? [] : linesForGroup(e.props.calls, known)
    if (shown.length === 0) return drawn
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {drawn}
        {shown.map(line => (
          <Text dimColor>{`  ⎿  ${line}`}</Text>
        ))}
      </Box>
    )
  })

  on('ui.render', { component: 'ToolUse', props: { tool: 'Bash' } }, async ($, e, next) => {
    const line = (await read($, lines))[e.props.tool_use_id]
    const drawn = await next(e)
    if (line === undefined || !isPending(e.props)) return drawn
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {drawn}
        <Text dimColor>{`  ⎿  ${line}`}</Text>
      </Box>
    )
  })

  on('command.run', { command: 'explain' }, async ($, e) => {
    const command = e.args.trim()
    if (command === '') {
      return { text: `Usage: /explain <command>. ${shownCount} explanation(s) shown at permission prompts this session, ${explained.size} cached.` }
    }
    const line = await explainCommand($, model, command)
    return { text: line ?? 'No explanation: the model did not answer. Try again in a moment.' }
  })
}
