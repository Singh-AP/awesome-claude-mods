import type { EngineInterface, Register } from 'claude-code'

import { parseTarget } from './hosts'
import { judge, policyFrom, type Decision, type Policy } from './policy'
import { fetchRequest, requestsIn, type Request } from './requests'

const ONCE = 'Allow once'
const BLOCK = 'Block'

// This session's hosts and tally; a reload starts them over, the all-time count is in $.store.
const sessionHosts = new Set<string>()
const tally = { checked: 0, asked: 0, blocked: 0 }
let lastBlocked = ''

async function refuseNetwork($: EngineInterface, tool: string, decision: Decision) {
  tally.blocked += 1
  lastBlocked = `${decision.host ?? '(run-time host)'}: ${decision.why}`
  $.ui.toast(`net-guard blocked ${decision.host ?? 'a network call'}`)
  const total = Number((await $.store.get('blockedTotal')) ?? 0) + 1
  await $.store.set('blockedTotal', total)

  return {
    deny:
      `net-guard blocked this ${tool === 'WebFetch' ? 'fetch' : 'command'}: it ${decision.why}. ` +
      "Don't retry through another host, tool or encoding. Tell the user what you wanted to fetch or send; they can allow the host with /net-guard allow <host>.",
  }
}

function verdictLines(requests: readonly Request[], policy: Policy): string {
  if (requests.length === 0) return 'no network requests found.'
  return judge(requests, policy, sessionHosts)
    .map(({ request, decision }) => {
      const label = decision.action === 'deny' ? 'BLOCK' : decision.action === 'ask' ? 'ASK  ' : 'ALLOW'
      const where = decision.host ?? request.raw
      return `  ${label} ${request.tool} → ${where}${request.isUpload ? ' (sends data)' : ''}${decision.action === 'allow' ? '' : `: ${decision.why}`}`
    })
    .join('\n')
}

export const register: Register = (on, options) => {
  const policy = policyFrom(options)

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'net-guard',
      description: "What net-guard has allowed and blocked; /net-guard check <url or command>, allow <host>, forget",
      argumentHint: '[check <url|command> | allow <host> | forget]',
    })
    return next(e)
  })

  on('tool.call', { tool: ['Bash', 'WebFetch'] }, async ($, e, next) => {
    const requests = e.tool === 'Bash' ? requestsIn(e.command) : fetchRequest(e.url)
    if (requests.length === 0) return next(e)
    tally.checked += 1

    const verdicts = judge(requests, policy, sessionHosts)
    const worst = verdicts[0]!
    if (worst.decision.action === 'deny') return refuseNetwork($, e.tool, worst.decision)
    if (worst.decision.action === 'allow') return next(e)

    const asks = verdicts.filter(v => v.decision.action === 'ask')
    const hosts = [...new Set(asks.map(v => v.decision.host).filter((h): h is string => h !== null))]
    const remember = hosts.length === 1 ? `Allow ${hosts[0]!.slice(0, 40)} this session` : hosts.length > 1 ? 'Allow these hosts this session' : undefined
    const reasons = [...new Set(asks.map(v => v.decision.why))].slice(0, 3).join('; ')
    const shown = e.tool === 'Bash' ? `$ ${e.command.length > 240 ? `${e.command.slice(0, 240)}…` : e.command}` : e.url
    tally.asked += 1

    let answer = BLOCK
    try {
      answer = await $.ui.ask(`net-guard: this ${e.tool === 'WebFetch' ? 'fetch' : 'command'} ${reasons}.\n\n  ${shown}\n\nLet it through?`, {
        header: 'net-guard',
        options: remember === undefined ? [ONCE, BLOCK] : [ONCE, remember, BLOCK],
      })
    } catch {
      // Nobody to ask (a -p run) or the dialog was dismissed: stay safe.
    }
    if (answer === ONCE) return next(e)
    if (remember !== undefined && answer === remember) {
      for (const host of hosts) sessionHosts.add(host)
      return next(e)
    }
    return refuseNetwork($, e.tool, { ...asks[0]!.decision, why: `${asks[0]!.decision.why}, and the user didn't allow it` })
  })

  on('command.run', { command: 'net-guard' }, async ($, e) => {
    const [verb = '', ...rest] = e.args.trim().split(/\s+/)
    const arg = rest.join(' ')

    if (verb === 'check') {
      if (arg === '') return { text: 'Usage: /net-guard check <url or shell command>' }
      const requests = /\s/.test(arg) ? requestsIn(arg) : arg.includes('://') ? fetchRequest(arg) : requestsIn(arg).length > 0 ? requestsIn(arg) : fetchRequest(arg)
      return { text: `${arg}:\n${verdictLines(requests, policy)}` }
    }
    if (verb === 'allow') {
      const target = parseTarget(arg)
      if (target === undefined || target === null) return { text: 'Usage: /net-guard allow <host>' }
      sessionHosts.add(target.host)
      return { text: `allowed ${target.host} for the rest of this session.` }
    }
    if (verb === 'forget') {
      const n = sessionHosts.size
      sessionHosts.clear()
      return { text: `forgot ${n} host${n === 1 ? '' : 's'} allowed this session.` }
    }

    const total = Number((await $.store.get('blockedTotal')) ?? 0)
    const lines = [
      `on: unknown hosts ${policy.unknown}, fetches of unknown hosts ${policy.fetchUnknown}, uploads ask when ${policy.askUploads === 'unlisted' ? 'the host is unlisted' : policy.askUploads}.`,
      `Lists: ${policy.allow.length + policy.userAllow.length} allowed, ${policy.deny.length + policy.userDeny.length} denied${policy.allowPrivate ? ', private networks allowed' : ''}.`,
      `This session: ${tally.checked} network calls checked, ${tally.asked} asked, ${tally.blocked} blocked. All time: ${total} blocked.`,
      sessionHosts.size === 0 ? 'No hosts allowed for this session.' : `Allowed this session: ${[...sessionHosts].join(', ')}`,
    ]
    if (lastBlocked !== '') lines.push(`Last blocked: ${lastBlocked.slice(0, 160)}`)
    return { text: lines.join('\n') }
  })
}
