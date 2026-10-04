// A two-note chime synthesized as a 16-bit mono PCM WAV, so the mod ships no
// audio files. Pure: no `$`.

type Note = { hz: number; at: number; seconds: number }

// A5 then E6: a rising fifth, bright and short.
const NOTES: readonly Note[] = [
  { hz: 880, at: 0, seconds: 0.18 },
  { hz: 1318.51, at: 0.12, seconds: 0.33 },
]

/** The chime's samples in -1..1, `seconds` long at `sampleRate`. */
export function chimeSamples(sampleRate = 22050, seconds = 0.46): Float32Array {
  const samples = new Float32Array(Math.ceil(sampleRate * seconds))
  for (const note of NOTES) {
    const start = Math.floor(note.at * sampleRate)
    const length = Math.min(Math.floor(note.seconds * sampleRate), samples.length - start)
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate
      // A 5 ms attack, then an exponential decay to silence by the note's end.
      const envelope = Math.min(1, t / 0.005) * Math.exp(-t * 9) * (1 - i / length)
      const tone = Math.sin(2 * Math.PI * note.hz * t) + 0.25 * Math.sin(4 * Math.PI * note.hz * t)
      samples[start + i] = (samples[start + i] ?? 0) + 0.3 * envelope * tone
    }
  }
  return samples
}

/** Encodes samples as a 16-bit mono PCM WAV file. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const dataBytes = samples.length * 2
  const bytes = new Uint8Array(44 + dataBytes)
  const view = new DataView(bytes.buffer)
  const ascii = (at: number, text: string) => {
    for (let i = 0; i < text.length; i++) bytes[at + i] = text.charCodeAt(i)
  }

  ascii(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true) // fmt chunk size
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // byte rate
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  ascii(36, 'data')
  view.setUint32(40, dataBytes, true)
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i] ?? 0))
    view.setInt16(44 + i * 2, Math.round(clamped * 32767), true)
  }
  return bytes
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Standard base64 with padding. */
export function toBase64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0
    const b = bytes[i + 1] ?? 0
    const c = bytes[i + 2] ?? 0
    const n = (a << 16) | (b << 8) | c
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]!
    out += i + 1 < bytes.length ? ALPHABET[(n >> 6) & 63]! : '='
    out += i + 2 < bytes.length ? ALPHABET[n & 63]! : '='
  }
  return out
}

/** The chime as a base64 WAV, ready for `$.audio.play({ base64, mime })`. */
export function chimeBase64(): string {
  const rate = 22050
  return toBase64(encodeWav(chimeSamples(rate), rate))
}
