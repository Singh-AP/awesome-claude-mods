import type { EngineInterface, Register } from 'claude-code'

import { chimeBase64 } from './chime'
import { baseName, donePing, waitingPing, type Ping } from './text'

// Two pings closer together than this are one too many.
const COOLDOWN_MS = 60_000

type Push = { server: string; topic: string }

let chime = ''
let isMuted = false
let isInteractive = true
let lastPingAt = Number.NEGATIVE_INFINITY
let project: string | undefined
// Which desktop notifier this machine has, once a ping has found out.
let notifier: 'osascript' | 'notify-send' | 'none' | undefined

async function projectName($: EngineInterface): Promise<string> {
  if (project !== undefined) return project
  try {
    const repo = await $.session.repo()
    project = baseName(repo?.root ?? (await $.session.root()))
  } catch {
    project = ''
  }
  return project
}

/** Shows a desktop notification; says which notifier took it, or `none`. */
async function desktop($: EngineInterface, ping: Ping): Promise<'osascript' | 'notify-send' | 'none'> {
  if (notifier === undefined || notifier === 'osascript') {
    try {
      const shown = await $.process.run(
        [
          'osascript',
          '-e', 'on run argv',
          '-e', 'display notification (item 1 of argv) with title (item 2 of argv) subtitle (item 3 of argv)',
          '-e', 'end run',
          ping.body, ping.title, ping.subtitle,
        ],
        { timeoutMs: 5000 },
      )
      notifier = 'osascript'
      return shown.exitCode === 0 ? 'osascript' : 'none'
    } catch {
      // No osascript: not a Mac. Try the next one.
      if (notifier === 'osascript') return 'none'
    }
  }
  if (notifier === undefined || notifier === 'notify-send') {
    try {
      const summary = ping.subtitle === '' ? ping.title : `${ping.title} · ${ping.subtitle}`
      const shown = await $.process.run(['notify-send', '--app-name=Claude Code', summary, ping.body], { timeoutMs: 5000 })
      notifier = 'notify-send'
      return shown.exitCode === 0 ? 'notify-send' : 'none'
    } catch {
      // Nothing to notify with on this machine.
    }
  }
  notifier = 'none'
  return 'none'
}

/** Pushes the ping to a phone through an ntfy server; says whether it took. */
async function pushToPhone($: EngineInterface, ping: Ping, push: Push): Promise<boolean> {
  if (push.topic === '') return false
  try {
    // JSON publishing (POST to the server root) keeps non-ASCII titles out of headers.
    const sent = await $.http.fetch(push.server, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topic: push.topic,
        title: ping.subtitle === '' ? ping.title : `${ping.title} · ${ping.subtitle}`,
        message: ping.body,
        tags: ['robot'],
      }),
    })
    return sent.ok
  } catch {
    return false
  }
}

async function playSound($: EngineInterface, sound: string, phrase: string): Promise<void> {
  try {
    if (sound === 'chime') {
      if (chime === '') chime = chimeBase64()
      await $.audio.play({ base64: chime, mime: 'audio/wav' })
    } else if (sound === 'say') {
      await $.audio.speak(phrase)
    }
  } catch {
    // No player or voice here: the notification is enough.
  }
}

/** Notifies on every channel the person turned on; says where it showed. */
async function announce($: EngineInterface, message: Ping, sound: string, shouldNotify: boolean, push: Push): Promise<string> {
  const [where, isPushed] = await Promise.all([
    shouldNotify ? desktop($, message) : Promise.resolve('none' as const),
    pushToPhone($, message, push),
  ])
  if (where === 'none') $.ui.toast(message.body)
  void playSound($, sound, message.phrase)
  const shown = where === 'none' ? 'a toast' : `a desktop notification (${where})`
  return isPushed ? `${shown} and a phone push` : shown
}

export const register: Register = (on, options) => {
  const minMs = Math.max(0, Number(options.minSeconds ?? 30)) * 1000
  const sound = String(options.sound ?? 'chime')
  const shouldNotify = options.desktop !== false
  const notifyOnWaiting = options.notifyOnWaiting !== false
  const inHeadless = options.inHeadless === true
  const topic = String(options.ntfyTopic ?? '').trim()
  const push: Push = {
    server: String(options.ntfyServer ?? 'https://ntfy.sh').trim().replace(/\/+$/, ''),
    // A topic is the only secret on a public ntfy server; anything odd is ignored.
    topic: /^[A-Za-z0-9_-]{1,64}$/.test(topic) ? topic : '',
  }

  const isListening = () => !isMuted && (isInteractive || inHeadless)

  on('session.start', async ($, e, next) => {
    isInteractive = e.isInteractive
    await $.command.register({
      name: 'ding',
      description: 'done-ding: test the notification, or mute it for this session',
      argumentHint: '[test|mute|unmute]',
    })
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const out = await next(e)
    if (e.agentId !== undefined || e.isAborted || e.reason === 'aborted') return out
    if (!isListening() || e.durationMs < minMs) return out

    const message = donePing(e, await projectName($))
    lastPingAt = await $.clock.now()
    $.clock.after(0, () => void announce($, message, sound, shouldNotify, push))
    return out
  })

  on('classic.Notification', async ($, e, next) => {
    const out = await next(e)
    if (!notifyOnWaiting || !isListening()) return out

    const message = waitingPing(e, await projectName($))
    if (message === undefined) return out
    const now = await $.clock.now()
    if (now - lastPingAt < COOLDOWN_MS) return out
    lastPingAt = now
    $.clock.after(0, () => void announce($, message, sound, shouldNotify, push))
    return out
  })

  on('command.run', { command: 'ding' }, async ($, e) => {
    const verb = e.args.trim().toLowerCase()
    if (verb === 'mute') {
      isMuted = true
      return { text: 'Muted for this session. /ding unmute turns it back on.' }
    }
    if (verb === 'unmute') {
      isMuted = false
      return { text: 'On again.' }
    }
    if (verb === 'test') {
      const message = donePing({ durationMs: 134_000, answer: 'This is what a finished turn looks like.', reason: 'answer' }, await projectName($))
      const where = await announce($, message, sound, shouldNotify, push)
      return { text: `Sent a test as ${where}${sound === 'none' ? '' : `, with sound: ${sound}`}.` }
    }
    const state = isMuted ? 'Muted for this session' : 'On'
    const waiting = notifyOnWaiting ? ', and when Claude is waiting on you' : ''
    const phone = push.topic === '' ? '' : ` Phone pushes go to ntfy topic "${push.topic}".`
    return {
      text:
        `${state}: it pings after turns of ${minMs / 1000}s or longer${waiting}. ` +
        `Sound: ${sound}.${phone} Try /ding test, /ding mute or /ding unmute.`,
    }
  })
}
