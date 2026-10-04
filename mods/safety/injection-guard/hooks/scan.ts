// Finds hidden text and instruction-shaped text in tool output: no `$`, pure.

export type HiddenKind = 'tag characters' | 'variation selectors' | 'zero-width characters' | 'bidi controls' | 'filler characters'

export type Hidden = { kinds: HiddenKind[]; count: number; decoded: string }

export type Hit = { rule: string; weight: number; match: string }

export type Verdict = { score: number; hits: Hit[]; isTripped: boolean }

/** How much evidence it takes to warn: one strong signal, or two weaker ones. */
export const THRESHOLD = 3

const PICTO = /\p{Extended_Pictographic}/u
const JOINING_SCRIPT = /[\p{Script=Arabic}\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Gurmukhi}\p{Script=Gujarati}\p{Script=Oriya}\p{Script=Tamil}\p{Script=Telugu}\p{Script=Kannada}\p{Script=Malayalam}\p{Script=Sinhala}\p{Script=Syriac}\p{Script=Mongolian}\p{Script=Khmer}\p{Script=Myanmar}]/u
const IDEOGRAPH = /\p{Script=Han}/u

function kindOf(cp: number): HiddenKind | 'silent' | undefined {
  if (cp >= 0xe0000 && cp <= 0xe007f) return 'tag characters'
  if ((cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xe0100 && cp <= 0xe01ef)) return 'variation selectors'
  if ((cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069)) return 'bidi controls'
  if (cp === 0x200b || cp === 0x200c || cp === 0x200d || (cp >= 0x2060 && cp <= 0x2064) || cp === 0xfeff || cp === 0x180e) return 'zero-width characters'
  if (cp === 0x3164 || cp === 0xffa0 || cp === 0x115f || cp === 0x1160) return 'filler characters'
  // Direction marks and soft hyphens can't hide words; dropped without a marker.
  if (cp === 0x200e || cp === 0x200f || cp === 0x061c || cp === 0x00ad) return 'silent'
  return undefined
}

/** Whether the invisible character at `i` is doing its legitimate job (an emoji join, a script's joiner). */
function isLegit(chars: readonly string[], i: number): boolean {
  const cp = chars[i]!.codePointAt(0)!
  const prev = chars[i - 1] ?? ''
  const next = chars[i + 1] ?? ''
  const prevCp = prev.codePointAt(0) ?? 0
  if (cp === 0x200d) return (PICTO.test(prev) || (prevCp >= 0xfe00 && prevCp <= 0xfe0f) || (prevCp >= 0x1f3fb && prevCp <= 0x1f3ff)) && PICTO.test(next)
  if (cp === 0x200c || cp === 0x200d) return JOINING_SCRIPT.test(prev) && JOINING_SCRIPT.test(next)
  const nextCp = next.codePointAt(0) ?? 0
  const isSelector = (n: number) => (n >= 0xfe00 && n <= 0xfe0f) || (n >= 0xe0100 && n <= 0xe01ef)
  // One selector after an emoji, a symbol or an ideograph is how emoji and CJK variants are written.
  if (cp >= 0xfe00 && cp <= 0xfe0f) return !isSelector(prevCp) && !isSelector(nextCp) && (prevCp > 0x7f || nextCp === 0x20e3)
  if (cp >= 0xe0100 && cp <= 0xe01ef) return !isSelector(prevCp) && !isSelector(nextCp) && IDEOGRAPH.test(prev)
  return false
}

/** Turns a run of hidden characters back into the text it smuggles, where it encodes any. */
function decodeRun(cps: readonly number[]): string {
  // Tag characters mirror ASCII: U+E0041 is "A".
  const tags = cps.filter(cp => cp >= 0xe0020 && cp <= 0xe007e).map(cp => String.fromCharCode(cp - 0xe0000)).join('')
  if (tags.trim() !== '') return tags
  // "Emoji smuggling": one byte per selector, U+FE00-FE0F as 0-15, U+E0100-E01EF as 16-255.
  const bytes = cps
    .map(cp => (cp >= 0xfe00 && cp <= 0xfe0f ? cp - 0xfe00 : cp >= 0xe0100 && cp <= 0xe01ef ? cp - 0xe0100 + 16 : -1))
    .filter(b => b >= 0)
  const text = bytes.filter(b => b >= 0x20 && b < 0x7f).map(b => String.fromCharCode(b)).join('')
  return bytes.length >= 4 && text.length >= bytes.length * 0.8 ? text : ''
}

const escapeMarker = (text: string) => text.replace(/[⟦⟧"\n\r]/g, ' ').replace(/\s+/g, ' ').trim()

/**
 * Removes invisible characters that can hide text from people but not from
 * models, leaving a visible marker (with the decoded text, when it decodes)
 * wherever a run of them hid something.
 */
export function stripHidden(text: string): { text: string; found: Hidden[] } {
  if (!/[\u00ad\u061c\u115f\u1160\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\u3164\ufe00-\ufe0f\ufeff\uffa0]|\udb40[\udc00-\udc7f\udd00-\uddef]/.test(text)) {
    return { text, found: [] }
  }
  const chars = Array.from(text)
  const found: Hidden[] = []
  let out = ''
  let run: number[] = []
  let runKinds = new Set<HiddenKind>()

  const flush = () => {
    if (run.length === 0) return
    const kinds = [...runKinds]
    const isLoud = run.length >= 3 || kinds.some(k => k !== 'zero-width characters')
    if (isLoud) {
      const decoded = decodeRun(run)
      found.push({ kinds, count: run.length, decoded })
      const preview = escapeMarker(decoded).slice(0, 120)
      out += `⟦injection-guard removed ${run.length} hidden character${run.length === 1 ? '' : 's'}${preview === '' ? '' : `: "${preview}${decoded.length > 120 ? '…' : ''}"`}⟧`
    }
    run = []
    runKinds = new Set()
  }

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!
    const cp = ch.codePointAt(0)!
    // A byte-order mark opening the text is an encoding detail, not a hiding place.
    if (cp === 0xfeff && i === 0) continue
    const kind = kindOf(cp)
    if (kind === undefined || isLegit(chars, i)) {
      flush()
      out += ch
      continue
    }
    if (kind === 'silent') continue
    run.push(cp)
    runKinds.add(kind)
  }
  flush()

  return { text: out, found }
}

type Rule = { rule: string; weight: number; pattern: RegExp }

const RULES: readonly Rule[] = [
  {
    rule: 'override previous instructions',
    weight: 3,
    pattern: /\b(ignore|disregard|forget|override|bypass)\b[^.\n]{0,30}?\b(previous|prior|above|earlier|preceding|former|original|system|developer)\b[^.\n]{0,24}?\b(instructions?|prompts?|rules|directions|guidelines|messages?)\b/i,
  },
  {
    rule: 'keep it from the user',
    weight: 3,
    pattern: /\b(do not|don't|never)\s+(tell|inform|alert|notify|warn|mention (this|it) to|reveal (this|it) to|let)\s+(the\s+)?(user|human|operator|developer)\b|\bwithout (telling|informing|alerting|notifying|asking) the (user|human)\b|\bkeep (this|it) (a )?secret from the (user|human)\b/i,
  },
  {
    rule: 'new instructions',
    weight: 2,
    pattern: /\b(new|updated|revised|real|actual|true|hidden)\s+(system\s+)?instructions?\s*(:|are\b|follow\b)|\bfrom now on,?\s+you\s+(will|must|are|should)\b/i,
  },
  {
    rule: 'role switch',
    weight: 2,
    pattern: /\byou are now (a|an|in|the|my|DAN|free|unrestricted|jailbroken|developer mode)\b|\byou are no longer (an?|bound|restricted|claude|an assistant)\b|\bact as (an? )?(unrestricted|jailbroken|evil)\b/i,
  },
  {
    rule: 'talks to the AI',
    weight: 2,
    pattern: /\b(attention|note|message|important|instructions?)\s*(for|to)\s*(the\s+|any\s+|all\s+)?(ai|assistant|agent|llm|language model|claude|chatgpt|gpt|copilot|model)s?\b|\b(dear|hey|hi)\s+(ai|assistant|claude|agent|llm)\b|\bif you are an? (ai|llm|language model|assistant|agent)\b/i,
  },
  {
    rule: 'asks for the system prompt',
    weight: 2,
    pattern: /\b(reveal|print|show|output|repeat|leak|dump)\b[^.\n]{0,20}\b(your|the)\s+(system prompt|hidden prompt|initial instructions|instructions above|original instructions)/i,
  },
  {
    rule: 'chat markup',
    weight: 2,
    pattern: /<\/?\s*(system|assistant|im_start|im_end|system-reminder|user_instructions)\s*>|<\|im_(start|end)\|>|\[\/?(INST|SYS)\]|<<\/?SYS>>/i,
  },
  { rule: 'exfiltration', weight: 2, pattern: /\b(exfiltrat\w*)\b/i },
  {
    rule: 'image that leaks data',
    weight: 2,
    pattern: /!\[[^\]]*\]\(\s*https?:\/\/[^)\s]+\?[^)\s]*(\b(data|d|q|secret|token|key|content|msg|payload|leak|info|chat|history)=|=[^)&\s]*(\{|\$|%7B|<)|=[A-Za-z0-9+/_-]{24,})[^)\s]*\)|<img\b[^>]*\bsrc=["']https?:\/\/[^"']+\?[^"']*=(\{|\$|%7B|[A-Za-z0-9+/_-]{24,})/i,
  },
  {
    rule: 'reach for secrets',
    weight: 1,
    pattern: /\b(read|cat|print|send|include|copy|upload|paste)\b[^.\n]{0,40}?(\.env\b|id_rsa|\.ssh\/|\.aws\/credentials|\bapi[_ -]?keys?\b|\bprivate key\b|\bcredentials\b)/i,
  },
  {
    rule: 'send it somewhere',
    weight: 1,
    pattern: /\b(send|post|upload|forward|transmit|submit|exfiltrate)\b[^.\n]{0,80}?\b(to|at)\s+(https?:\/\/|[a-z0-9-]+\.(com|net|org|io|sh|site|app|dev|xyz)\b)/i,
  },
  { rule: 'run this command', weight: 1, pattern: /\b(run|execute)\s+(the following|this)\s+(command|code|script)\b|\bcurl\b[^\n|]{0,100}\|\s*(sudo\s+)?(ba)?sh\b/i },
]

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function fromBase64(text: string): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const ch of text.replace(/=+$/, '')) {
    const n = B64.indexOf(ch === '-' ? '+' : ch === '_' ? '/' : ch)
    if (n < 0) return ''
    value = (value << 6) | n
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out += String.fromCharCode((value >> bits) & 0xff)
    }
  }
  return out
}

function rulesIn(text: string): Hit[] {
  const hits: Hit[] = []
  for (const { rule, weight, pattern } of RULES) {
    const m = pattern.exec(text)
    if (m !== null) hits.push({ rule, weight, match: m[0].slice(0, 120) })
  }
  return hits
}

/**
 * How strongly `text` reads like instructions planted for a model: each
 * rule counts once, base64 blobs that decode to such text count too.
 */
export function score(text: string, hidden: readonly Hidden[] = []): Verdict {
  const sample = text.length > 500_000 ? text.slice(0, 500_000) : text
  const hits = rulesIn(sample)

  for (const blob of (sample.match(/[A-Za-z0-9+/_-]{40,}={0,2}/g) ?? []).slice(0, 50)) {
    const decoded = fromBase64(blob)
    const printable = decoded.replace(/[^\x20-\x7e\n\t]/g, '').length
    if (decoded.length < 20 || printable < decoded.length * 0.9) continue
    const inner = rulesIn(decoded)
    if (inner.reduce((n, h) => n + h.weight, 0) >= 2) {
      hits.push({ rule: 'instructions hidden in base64', weight: 3, match: decoded.slice(0, 120) })
      break
    }
  }

  if (hidden.length > 0) {
    const smuggled = hidden.map(h => h.decoded).join('\n')
    const inner = smuggled.trim() === '' ? [] : rulesIn(smuggled)
    const total = hidden.reduce((n, h) => n + h.count, 0)
    hits.push({ rule: inner.length > 0 ? 'instructions in hidden characters' : 'hidden characters', weight: 3, match: `${total} hidden characters` })
  }

  const score = hits.reduce((n, h) => n + h.weight, 0)
  return { score, hits, isTripped: score >= THRESHOLD }
}

/** Replaces the spans the strong rules (weight 2+) match with a marker. */
export function stripInstructions(text: string): { text: string; removed: number } {
  let removed = 0
  let out = text
  for (const { weight, pattern } of RULES) {
    if (weight < 2) continue
    const global = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`)
    out = out.replace(global, () => {
      removed += 1
      return '⟦instruction removed by injection-guard⟧'
    })
  }
  return { text: out, removed }
}
