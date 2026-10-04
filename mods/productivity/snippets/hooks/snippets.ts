// Pure snippet logic: no `$`, so tests import it directly.

/** Ship-with snippets; the person can override or remove each. */
export const STARTERS: Readonly<Record<string, string>> = {
  review: [
    'Review the changes on branch {{branch|the current branch}}: the uncommitted ones and the commits not yet on the main branch.',
    'Pay extra attention to: {{args}}',
    'Look for bugs first, then security problems, then needless complexity. List each finding with file:line, most severe first, and say how confident you are. Do not change any code yet.',
  ].join('\n'),
  explain: [
    'Explain {{args|this code}}:',
    '{{selection}}',
    'Start with a two-sentence summary, then walk through the flow step by step with file:line references, then call out anything non-obvious or surprising.',
  ].join('\n'),
  tests: [
    'Write tests for {{args|the code changed on this branch}}.',
    '{{selection}}',
    "Cover the happy path, edge cases and failure modes, in the project's existing test framework and style. Run them and fix any failures before you finish.",
  ].join('\n'),
  'commit-msg': [
    'Write a commit message for the staged changes (read them with git diff --staged).',
    'Context: {{args}}',
    'Use an imperative subject line under 72 characters, a blank line, then a short body saying why the change was made. Show it to me; do not commit.',
  ].join('\n'),
  plan: [
    'Before writing any code, make a plan for: {{args|the task we just discussed}}',
    'List the files you will touch, the approach, the risks and how you will check that it works. Then wait for my go-ahead.',
  ].join('\n'),
}

export const RESERVED = new Set(['save', 'rm', 'remove', 'delete', 'show', 'list', 'help', 'ls'])

const PLACEHOLDER = /\{\{\s*(\w+)\s*(?:\|([^}]*))?\}\}/g

export function isValidName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/.test(name) && !RESERVED.has(name.toLowerCase())
}

/** The placeholders a template names, so a caller fetches only those. */
export function placeholders(template: string): Set<string> {
  return new Set([...template.matchAll(PLACEHOLDER)].map(m => (m[1] ?? '').toLowerCase()))
}

/**
 * Fills `{{name}}` and `{{name|default}}`. A line whose placeholders all came
 * out empty (and had no default) is dropped, so a snippet reads well without
 * a selection or extra text. Extra text with no `{{args}}` to go to is appended.
 */
export function expand(template: string, values: Readonly<Record<string, string>>): string {
  const lines: string[] = []
  for (const line of template.split('\n')) {
    let named = 0
    let empty = 0
    const filled = line.replace(PLACEHOLDER, (_, rawName: string, fallback: string | undefined) => {
      const value = (values[rawName.toLowerCase()] ?? '').trim()
      named++
      if (value !== '') return value
      if (fallback !== undefined) return fallback.trim()
      empty++
      return ''
    })
    if (named > 0 && empty === named) continue
    lines.push(filled)
  }
  let text = lines.join('\n').trim()
  const extra = (values.args ?? '').trim()
  if (extra !== '' && !placeholders(template).has('args')) text = `${text}\n\n${extra}`
  return text
}

/** Starters the person has not removed, then their own (which win on a name). */
export function merged(own: Readonly<Record<string, string>>, hidden: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, text] of Object.entries(STARTERS)) if (!hidden.includes(name)) out[name] = text
  for (const [name, text] of Object.entries(own)) out[name] = text
  return out
}

export type SnipCommand =
  | { kind: 'list' }
  | { kind: 'save'; name: string; text: string }
  | { kind: 'rm'; name: string }
  | { kind: 'show'; name: string }
  | { kind: 'use'; name: string; extra: string }
  | { kind: 'error'; message: string }

export const USAGE =
  'Usage: /snip · /snip <name> [extra text] · /snip save <name> <text> · /snip show <name> · /snip rm <name>'

/** Reads what followed `/snip`. */
export function parseSnip(args: string): SnipCommand {
  const trimmed = args.trim()
  if (trimmed === '' || trimmed === 'list' || trimmed === 'ls') return { kind: 'list' }
  const [head = '', ...rest] = trimmed.split(/\s+/)
  const verb = head.toLowerCase()
  const afterVerb = trimmed.slice(head.length).trim()

  if (verb === 'help') return { kind: 'error', message: USAGE }
  if (verb === 'save') {
    const name = rest[0] ?? ''
    const text = afterVerb.slice(name.length).trim()
    if (!isValidName(name)) return { kind: 'error', message: `"${name}" is not a usable name: letters, digits, - and _, up to 40, not a /snip verb. ${USAGE}` }
    if (text === '') return { kind: 'error', message: `Nothing to save under "${name}". ${USAGE}` }
    return { kind: 'save', name, text }
  }
  if (verb === 'rm' || verb === 'remove' || verb === 'delete') {
    return rest[0] === undefined ? { kind: 'error', message: USAGE } : { kind: 'rm', name: rest[0] }
  }
  if (verb === 'show') {
    return rest[0] === undefined ? { kind: 'error', message: USAGE } : { kind: 'show', name: rest[0] }
  }
  return { kind: 'use', name: head, extra: afterVerb }
}

/** One line per snippet: its name and the start of its text. */
export function listing(all: Readonly<Record<string, string>>, ownNames: ReadonlySet<string>): string {
  const names = Object.keys(all).sort()
  if (names.length === 0) return `No snippets. ${USAGE}`
  const width = Math.max(...names.map(n => n.length))
  const rows = names.map(name => {
    const first = (all[name] ?? '').split('\n')[0] ?? ''
    const preview = first.length > 64 ? `${first.slice(0, 63)}…` : first
    return `  ${name.padEnd(width)}  ${preview}${ownNames.has(name) ? '' : '  (starter)'}`
  })
  return `Snippets:\n${rows.join('\n')}\n${USAGE}`
}
