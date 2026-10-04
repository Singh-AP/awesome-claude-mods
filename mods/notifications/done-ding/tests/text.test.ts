import { describe, expect, test } from 'claude-code/testing'

import { chimeSamples, encodeWav, toBase64, chimeBase64 } from '../hooks/chime'
import { baseName, donePing, firstLine, formatDuration, waitingPing } from '../hooks/text'

describe('formatDuration', () => {
  test('seconds', () => expect(formatDuration(45_200)).toBe('45s'))
  test('minutes and seconds', () => expect(formatDuration(134_000)).toBe('2m 14s'))
  test('hours and minutes', () => expect(formatDuration(3_780_000)).toBe('1h 3m'))
  test('never negative', () => expect(formatDuration(-5)).toBe('0s'))
})

describe('firstLine', () => {
  test('drops markdown', () => {
    expect(firstLine('## Summary\n\n**Fixed** the `login` bug in [auth.ts](src/auth.ts).')).toBe('Summary')
    expect(firstLine('- **Fixed** the `login` bug in [auth.ts](src/auth.ts).')).toBe('Fixed the login bug in auth.ts.')
  })
  test('skips code fences', () => expect(firstLine('```ts\nconst x = 1\n```\nAll tests pass.')).toBe('All tests pass.'))
  test('cuts long lines with an ellipsis', () => {
    const line = firstLine('word '.repeat(50), 20)
    expect(line.length).toBe(20)
    expect(line.endsWith('…')).toBe(true)
  })
  test('empty stays empty', () => expect(firstLine('\n\n')).toBe(''))
})

describe('donePing', () => {
  test('a finished turn names its length and gist', () => {
    const ping = donePing({ durationMs: 134_000, answer: 'Refactored the parser.\nMore detail.', reason: 'answer' }, 'api')
    expect(ping).toEqual({ title: 'Claude Code', subtitle: 'api', body: 'Done in 2m 14s · Refactored the parser.', phrase: 'Claude is done' })
  })
  test('a thinking-only turn still says done', () => {
    expect(donePing({ durationMs: 31_000, answer: '', reason: 'answer' }, '').body).toBe('Done in 31s')
  })
  test('an error says so', () => {
    expect(donePing({ durationMs: 60_000, answer: '', reason: 'error' }, 'x').body).toBe('An error ended the turn after 1m 0s')
  })
  test('a refusal says so', () => {
    expect(donePing({ durationMs: 5_000, answer: '', reason: 'refusal' }, 'x').title).toBe('Claude Code stopped')
  })
})

describe('waitingPing', () => {
  test('a permission prompt pings', () => {
    const ping = waitingPing({ message: 'Claude needs your permission to use Bash', notification_type: 'permission_prompt' }, 'web')
    expect(ping?.body).toBe('Claude needs your permission to use Bash')
    expect(ping?.subtitle).toBe('web')
  })
  test('an idle prompt pings', () => {
    expect(waitingPing({ message: '', notification_type: 'idle_prompt' }, '')?.body).toBe('Claude needs your input')
  })
  test('other notifications do not', () => {
    expect(waitingPing({ message: 'Signed in', notification_type: 'auth_success' }, '')).toBeUndefined()
  })
})

test('baseName', () => {
  expect(baseName('/Users/me/code/api/')).toBe('api')
  expect(baseName('C:\\code\\web')).toBe('web')
})

describe('the chime', () => {
  test('is a valid 16-bit mono WAV', () => {
    const bytes = encodeWav(chimeSamples(22050), 22050)
    const text = (at: number, n: number) => String.fromCharCode(...bytes.slice(at, at + n))
    const view = new DataView(bytes.buffer)
    expect(text(0, 4)).toBe('RIFF')
    expect(text(8, 4)).toBe('WAVE')
    expect(text(36, 4)).toBe('data')
    expect(view.getUint32(4, true)).toBe(bytes.length - 8)
    expect(view.getUint16(22, true)).toBe(1)
    expect(view.getUint32(24, true)).toBe(22050)
    expect(view.getUint16(34, true)).toBe(16)
  })
  test('stays in range and fades to silence', () => {
    const samples = chimeSamples(22050)
    let peak = 0
    for (const s of samples) peak = Math.max(peak, Math.abs(s))
    expect(peak > 0.1 && peak <= 1).toBe(true)
    expect(Math.abs(samples[samples.length - 1] ?? 1) < 0.01).toBe(true)
  })
  test('is small', () => expect(chimeBase64().length < 30_000).toBe(true))
})

test('toBase64 matches the standard alphabet and padding', () => {
  const bytes = (s: string) => new Uint8Array([...s].map(c => c.charCodeAt(0)))
  expect(toBase64(bytes('Man'))).toBe('TWFu')
  expect(toBase64(bytes('Ma'))).toBe('TWE=')
  expect(toBase64(bytes('M'))).toBe('TQ==')
  expect(toBase64(bytes(''))).toBe('')
  expect(toBase64(new Uint8Array([255, 254, 253]))).toBe('//79')
})
