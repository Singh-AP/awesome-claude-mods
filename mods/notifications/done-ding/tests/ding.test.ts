import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const TYPED = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } } as const
const RAN = { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }

type World = {
  runs: (readonly string[])[]
  plays: string[]
  speech: string[]
  toasts: string[]
}

/** Stubs everything beneath the mod; `missing` names commands this machine lacks. */
function world(on: On, missing: readonly string[] = []): World {
  const w: World = { runs: [], plays: [], speech: [], toasts: [] }
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('turn.complete', () => ({ text: '' }))
  on('classic.Notification', () => ({}))
  on('session.repo', () => ({ value: { root: '/work/api', remote: null, internal: false, name: null } }))
  on('session.root', () => ({ value: '/work/api' }))
  on('process.run', ($, e) => {
    if (missing.includes(e.argv[0] ?? '')) return { deny: 'ENOENT' }
    w.runs.push(e.argv)
    return { value: RAN }
  })
  on('audio.play', ($, e) => {
    w.plays.push(e.clip.mime ?? '')
    return { value: undefined }
  })
  on('audio.speak', ($, e) => {
    w.speech.push(e.text)
    return { value: { via: 'system' } }
  })
  on('ui.toast', ($, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  return w
}

const turn = (durationMs: number, extra: Record<string, unknown> = {}) => ({
  turnId: 't1',
  answer: 'Fixed the flaky test.',
  durationMs,
  isAborted: false,
  reason: 'answer' as const,
  ...extra,
})

test('a long turn pings with a notification and a chime', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const w = world(on)

  await $.turn.complete(turn(134_000))
  await clock.settle()

  expect(w.runs.length).toBe(1)
  expect(w.runs[0]?.[0]).toBe('osascript')
  expect(w.runs[0]).toContain('Done in 2m 14s · Fixed the flaky test.')
  expect(w.runs[0]).toContain('api')
  expect(w.plays).toEqual(['audio/wav'])
  expect(w.toasts).toEqual([])
})

test('short, aborted and subagent turns stay quiet', async ($, on) => {
  const clock = mock.clock(on)
  const w = world(on)

  await $.turn.complete(turn(5_000))
  await $.turn.complete(turn(90_000, { isAborted: true, reason: 'aborted' }))
  await $.turn.complete(turn(90_000, { agentId: 'sub-1' }))
  await clock.settle()

  expect(w.runs).toEqual([])
  expect(w.plays).toEqual([])
})

test('falls back to notify-send, then to a toast', async ($, on) => {
  const clock = mock.clock(on)
  const w = world(on, ['osascript'])

  await $.turn.complete(turn(40_000))
  await clock.settle()
  expect(w.runs[0]?.[0]).toBe('notify-send')
  expect(w.runs[0]?.[2]).toBe('Claude Code · api')

  await clock.advance(120_000)
  await $.turn.complete(turn(40_000))
  await clock.settle()
  expect(w.runs.length).toBe(2)
})

test('no notifier at all shows a toast', async ($, on) => {
  const clock = mock.clock(on)
  const w = world(on, ['osascript', 'notify-send'])

  await $.turn.complete(turn(40_000))
  await clock.settle()

  expect(w.toasts).toEqual(['Done in 40s · Fixed the flaky test.'])
})

test('a permission prompt pings once a minute at most', async ($, on) => {
  const clock = mock.clock(on, { now: 10_000_000 })
  const w = world(on)
  const ask = { message: 'Claude needs your permission to use Bash', notification_type: 'permission_prompt' }

  await $.classic.Notification(ask)
  await clock.settle()
  await $.classic.Notification(ask)
  await clock.settle()
  expect(w.runs.length).toBe(1)
  expect(w.runs[0]).toContain('Claude needs your permission to use Bash')

  await clock.advance(61_000)
  await $.classic.Notification(ask)
  await clock.settle()
  expect(w.runs.length).toBe(2)
})

test('the idle reminder right after a done ping is skipped', async ($, on) => {
  const clock = mock.clock(on, { now: 10_000_000 })
  const w = world(on)

  await $.turn.complete(turn(45_000))
  await clock.settle()
  await clock.advance(30_000)
  await $.classic.Notification({ message: 'Claude is waiting for your input', notification_type: 'idle_prompt' })
  await clock.settle()

  expect(w.runs.length).toBe(1)
})

test('notifyOnWaiting: false ignores prompts', { options: { notifyOnWaiting: false } }, async ($, on) => {
  const clock = mock.clock(on)
  const w = world(on)

  await $.classic.Notification({ message: 'x', notification_type: 'permission_prompt' })
  await clock.settle()

  expect(w.runs).toEqual([])
})

test('headless sessions stay quiet unless asked', async ($, on) => {
  const clock = mock.clock(on)
  const w = world(on)

  await $.session.start({ cwd: '/work/api', surface: null, isInteractive: false })
  await $.turn.complete(turn(300_000))
  await clock.settle()

  expect(w.runs).toEqual([])
})

test('inHeadless: true pings headless sessions too', { options: { inHeadless: true } }, async ($, on) => {
  const clock = mock.clock(on)
  const w = world(on)

  await $.session.start({ cwd: '/work/api', surface: null, isInteractive: false })
  await $.turn.complete(turn(300_000))
  await clock.settle()

  expect(w.runs.length).toBe(1)
})

test('sound: say speaks instead of chiming', { options: { sound: 'say', desktop: false } }, async ($, on) => {
  const clock = mock.clock(on)
  const w = world(on)

  await $.turn.complete(turn(60_000))
  await clock.settle()

  expect(w.speech).toEqual(['Claude is done'])
  expect(w.plays).toEqual([])
  expect(w.runs).toEqual([])
  expect(w.toasts.length).toBe(1)
})

test('minSeconds and sound: none', { options: { minSeconds: 0, sound: 'none' } }, async ($, on) => {
  const clock = mock.clock(on)
  const w = world(on)

  await $.turn.complete(turn(1_000))
  await clock.settle()

  expect(w.runs.length).toBe(1)
  expect(w.plays).toEqual([])
})

test('/ding mute, unmute and test', async ($, on) => {
  const clock = mock.clock(on)
  const w = world(on)

  expect((await $.command.run({ command: 'ding', args: 'mute', ...TYPED })).text).toMatch(/Muted/)
  await $.turn.complete(turn(90_000))
  await clock.settle()
  expect(w.runs).toEqual([])

  expect((await $.command.run({ command: 'ding', args: 'unmute', ...TYPED })).text).toMatch(/On again/)
  const sent = await $.command.run({ command: 'ding', args: 'test', ...TYPED })
  expect(sent.text).toBe('Sent a test as a desktop notification (osascript), with sound: chime.')
  expect(w.runs.length).toBe(1)

  const status = await $.command.run({ command: 'ding', args: '', ...TYPED })
  expect(status.text).toMatch(/pings after turns of 30s or longer, and when Claude is waiting on you/)
})

test('with an ntfy topic, a long turn also pushes to the phone', { options: { ntfyTopic: 'my-claude-x7q' } }, async ($, on) => {
  const clock = mock.clock(on)
  const w = world(on)
  const pushes: { url: string; body: string }[] = []
  on('http.fetch', ($, e) => {
    pushes.push({ url: e.url, body: String(e.init?.body ?? '') })
    return { value: { status: 200, ok: true, headers: {}, text: '{}' } }
  })

  await $.turn.complete(turn(90_000))
  await clock.settle()

  expect(w.runs.length).toBe(1)
  expect(pushes.length).toBe(1)
  expect(pushes[0]!.url).toBe('https://ntfy.sh')
  const sent = JSON.parse(pushes[0]!.body)
  expect(sent.topic).toBe('my-claude-x7q')
  expect(sent.title).toMatch(/Claude Code/)
  expect(sent.message).toMatch(/Done in 1m 30s/)

  const test = await $.command.run({ command: 'ding', args: 'test', ...TYPED })
  expect(test.text).toMatch(/and a phone push/)
})

test('a topic that is not a plain name is ignored, and nothing is pushed', { options: { ntfyTopic: 'bad topic/../x' } }, async ($, on) => {
  const clock = mock.clock(on)
  world(on)
  let pushes = 0
  on('http.fetch', () => (pushes++, { value: { status: 200, ok: true, headers: {}, text: '' } }))

  await $.turn.complete(turn(90_000))
  await clock.settle()

  expect(pushes).toBe(0)
})

test('a failed push never breaks the desktop ping', { options: { ntfyTopic: 'my-claude-x7q' } }, async ($, on) => {
  const clock = mock.clock(on)
  const w = world(on)
  on('http.fetch', () => ({ deny: 'offline' }))

  await $.turn.complete(turn(90_000))
  await clock.settle()

  expect(w.runs.length).toBe(1)
})
