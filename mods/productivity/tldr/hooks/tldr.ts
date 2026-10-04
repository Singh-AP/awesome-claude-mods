// Pure helpers: no `$`, so tests import them directly.

export const SYSTEM =
  "You write TL;DR lines. Given an AI coding assistant's answer, reply with ONE plain sentence of at most 25 words " +
  'that tells a developer skimming a terminal the outcome: what was found, done, decided or recommended. ' +
  'No markdown, no preamble, no quotes, no "TL;DR" label.'

const FENCE = /```[\s\S]*?(```|$)/g

/** Words of prose: fenced code blocks don't count. */
export function wordCount(text: string): number {
  return text.replace(FENCE, ' ').split(/\s+/).filter(word => /[\p{L}\p{N}]/u.test(word)).length
}

/** The answer as the summarizer reads it: long ones keep their head and their end. */
export function promptFor(answer: string): string {
  const body = answer.length > 16_000 ? `${answer.slice(0, 12_000)}\n[…]\n${answer.slice(-4_000)}` : answer
  return `Write the TL;DR of this answer.\n\n<answer>\n${body}\n</answer>`
}

/** One clean line from whatever the model wrote, or '' when nothing usable came back. */
export function clean(reply: string): string {
  const line = reply
    .replace(/^\s*(\*\*)?\s*(tl;?dr|summary)\s*[:\-–—]\s*(\*\*)?/i, '')
    .replace(/[*_`#>]/g, '')
    .split('\n')
    .map(part => part.trim())
    .find(part => part !== '') ?? ''
  const flat = line.replace(/\s+/g, ' ').replace(/^["“']|["”']$/g, '').trim()
  return flat.length > 280 ? `${flat.slice(0, 279).trimEnd()}…` : flat
}
