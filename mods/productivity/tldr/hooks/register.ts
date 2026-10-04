import type { EngineInterface, Register } from 'claude-code'

import { clean, promptFor, SYSTEM, wordCount } from './tldr'

// Whether long answers get a TL;DR on their own; /tldr on|off keeps it in $.store.
let isAuto = true
// A -p run prints the answer alone, so a TL;DR there would cost a call nobody sees.
let isHeadless = false

/** One `TL;DR: …` line for `answer`, or undefined when the model gave none. */
async function summarize($: EngineInterface, answer: string, model: string): Promise<string | undefined> {
  const reply = await $.model
    .complete({ model, system: SYSTEM, prompt: promptFor(answer), maxTokens: 120, effort: 'low', timeoutMs: 15_000 })
    .catch(() => undefined)
  if (reply === undefined || !reply.isAnswered) return undefined
  const line = clean(reply.text)
  return line === '' ? undefined : `TL;DR: ${line}`
}

async function setAuto($: EngineInterface, value: boolean): Promise<void> {
  isAuto = value
  await $.store.set('auto', value)
}

/** The last answer Claude gave in this conversation, or '' before the first. */
async function lastAnswer($: EngineInterface): Promise<string> {
  const messages = await $.session.messages()
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message?.role === 'assistant' && message.text.trim() !== '') return message.text
  }
  return ''
}

export const register: Register = (on, options) => {
  const minWords = Math.max(1, Number(options.minWords ?? 200))
  const model = String(options.model ?? 'haiku')

  on('session.start', async ($, e, next) => {
    isAuto = (await $.store.get('auto')) !== false
    isHeadless = !e.isInteractive
    try {
      await $.command.register({
        name: 'tldr',
        description: 'TL;DR of the last answer, or turn the automatic one on/off',
        argumentHint: '[on | off | status]',
      })
    } catch (error) {
      $.ui.log(`tldr: could not add /tldr: ${String(error)}`, { to: 'debug' })
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const isEligible = isAuto && !isHeadless && e.agentId === undefined && e.reason === 'answer' && !e.isAborted
    if (!isEligible || wordCount(e.answer) < minWords) return result

    const line = await summarize($, e.answer, model)
    if (line === undefined) return result
    // A text other than the answer is shown beneath it; keep another mod's line too.
    return { ...result, text: result.text === e.answer ? line : `${result.text}\n${line}` }
  })

  on('command.run', { command: 'tldr' }, async ($, e) => {
    const word = e.args.trim().toLowerCase()
    if (word === 'on' || word === 'off') {
      await setAuto($, word === 'on')
      return { text: word === 'on' ? `tldr is on: answers of ${minWords}+ words get a one-line TL;DR.` : 'tldr is off. /tldr still summarizes the last answer on demand.' }
    }
    if (word === 'status') {
      return { text: `tldr is ${isAuto ? 'on' : 'off'}: answers of ${minWords}+ words get a TL;DR from ${model}.` }
    }
    if (word !== '') return { text: 'Usage: /tldr (summarize the last answer) · /tldr on · /tldr off · /tldr status' }

    const answer = await lastAnswer($)
    if (answer === '') return { text: 'Nothing to summarize yet.' }
    return { text: (await summarize($, answer, model)) ?? `tldr: ${model} gave no summary; try again.` }
  })
}
