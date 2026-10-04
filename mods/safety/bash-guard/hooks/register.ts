import type { EngineInterface, Register } from 'claude-code'

import { analyze, matchesCustom, type Finding } from './analyze'

const RUN = 'Run it'
const STOP = 'Block it'

// This session's tally; a reload starts it over, the all-time count is in $.store.
let blocked = 0
let confirmed = 0
let lastBlocked = ''

async function refuse($: EngineInterface, command: string, why: string) {
  blocked += 1
  lastBlocked = command
  const total = Number((await $.store.get('blockedTotal')) ?? 0) + 1
  await $.store.set('blockedTotal', total)
  $.ui.toast(`bash-guard blocked: ${why}`)

  return {
    deny:
      `bash-guard blocked this command because it ${why}. ` +
      'Do not retry it or work around the guard; tell the user what you wanted to do and let them run it themselves if they mean it.',
  }
}

export const register: Register = (on, options) => {
  const risky = String(options.risky ?? 'confirm')
  const customBlock = String(options.customBlock ?? '')
  const customConfirm = String(options.customConfirm ?? '')

  const findingsFor = (command: string): Finding[] => {
    const found = analyze(command)
    if (matchesCustom(command, customBlock)) found.unshift({ rule: 'custom-block', level: 'block', why: 'matches your customBlock pattern' })
    if (matchesCustom(command, customConfirm)) found.push({ rule: 'custom-confirm', level: 'confirm', why: 'matches your customConfirm pattern' })
    return found
  }

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'bash-guard',
      description: 'Show what bash-guard has blocked, or test a command: /bash-guard <command>',
      argumentHint: '[command to test]',
    })
    return next(e)
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const findings = findingsFor(e.command)
    const hard = findings.find(f => f.level === 'block')
    if (hard !== undefined) return refuse($, e.command, hard.why)

    const soft = findings.filter(f => f.level === 'confirm')
    if (soft.length === 0 || risky === 'allow') return next(e)
    if (risky === 'block') return refuse($, e.command, soft[0]!.why)

    const reasons = soft.map(f => f.why).join('; ')
    const shown = e.command.length > 300 ? `${e.command.slice(0, 300)}…` : e.command
    let answer = STOP
    try {
      answer = await $.ui.ask(`bash-guard: this command ${reasons}.\n\n  $ ${shown}\n\nRun it?`, {
        header: 'bash-guard',
        options: [RUN, STOP],
      })
    } catch {
      // Nobody to ask (a -p run) or the dialog was dismissed: stay safe.
    }
    if (answer === RUN) {
      confirmed += 1
      return next(e)
    }
    return refuse($, e.command, reasons)
  })

  on('command.run', { command: 'bash-guard' }, async ($, e) => {
    const probe = e.args.trim()
    if (probe !== '') {
      const findings = findingsFor(probe)
      if (findings.length === 0) return { text: `allowed: no rule matches \`${probe}\`.` }
      const lines = findings.map(f => `  ${f.level === 'block' ? 'BLOCK  ' : 'CONFIRM'} ${f.rule}: ${f.why}`)
      return { text: `would stop \`${probe}\`:\n${lines.join('\n')}` }
    }
    const total = Number((await $.store.get('blockedTotal')) ?? 0)
    const parts = [
      `on (risky commands: ${risky}).`,
      `This session: ${blocked} blocked, ${confirmed} run after you confirmed.`,
      `All time: ${total} blocked.`,
    ]
    if (lastBlocked !== '') parts.push(`Last blocked: ${lastBlocked.slice(0, 120)}`)
    return { text: parts.join('\n') }
  })
}
