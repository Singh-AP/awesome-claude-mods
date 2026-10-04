// Just enough shell to find the commands in a command line: no `$`, pure.

/** Splits one shell segment into words, honouring quotes and backslashes. */
export function words(segment: string): string[] {
  const out: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let hasWord = false

  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i] ?? ''
    if (quote !== null) {
      if (ch === quote) quote = null
      else if (ch === '\\' && quote === '"' && i + 1 < segment.length) current += segment[++i]
      else current += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      hasWord = true
    } else if (ch === '\\' && i + 1 < segment.length) {
      current += segment[++i]
      hasWord = true
    } else if (/\s/.test(ch)) {
      if (hasWord) out.push(current)
      current = ''
      hasWord = false
    } else {
      current += ch
      hasWord = true
    }
  }
  if (hasWord) out.push(current)

  return out
}

/**
 * Splits a command line at `;`, `&&`, `||`, `|`, `&` and newlines outside
 * quotes, and lifts out `$(...)` and backtick substitutions, which run too.
 */
export function segments(command: string): { parts: string[]; inner: string[] } {
  const parts: string[] = []
  const inner: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null

  for (let i = 0; i < command.length; i++) {
    const ch = command[i] ?? ''
    const next = command[i + 1] ?? ''
    if (ch === '\\' && quote !== "'") {
      current += ch + next
      i++
      continue
    }
    if (quote === "'") {
      if (ch === "'") quote = null
      current += ch
      continue
    }
    if (ch === '$' && next === '(' && command[i + 2] !== '(') {
      let depth = 1
      let j = i + 2
      for (; j < command.length && depth > 0; j++) {
        if (command[j] === '(') depth++
        else if (command[j] === ')') depth--
      }
      inner.push(command.slice(i + 2, j - 1))
      current += command.slice(i, j)
      i = j - 1
      continue
    }
    if (ch === '`') {
      const end = command.indexOf('`', i + 1)
      const stop = end < 0 ? command.length : end
      inner.push(command.slice(i + 1, stop))
      current += command.slice(i, stop + 1)
      i = stop
      continue
    }
    if (quote === '"') {
      if (ch === '"') quote = null
      current += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      current += ch
      continue
    }
    const isAmp = ch === '&' && next !== '>' && command[i - 1] !== '>' && command[i - 1] !== '<'
    if (ch === ';' || ch === '\n' || ch === '|' || isAmp) {
      parts.push(current)
      current = ''
      if ((ch === '|' && next === '|') || (ch === '&' && next === '&')) i++
      continue
    }
    current += ch
  }
  parts.push(current)

  return { parts: parts.map(p => p.trim()).filter(p => p !== ''), inner }
}

// Commands that run the rest of their words as a command.
const WRAPPERS = new Set(['sudo', 'doas', 'command', 'exec', 'nohup', 'time', 'nice', 'env', 'xargs', 'builtin', 'timeout', 'stdbuf', 'caffeinate', 'proxychains', 'proxychains4', 'torsocks'])

/** Drops leading `VAR=value` words and wrapper commands, so argv[0] is the real command. */
export function unwrap(argv: readonly string[]): string[] {
  let rest = [...argv]
  for (;;) {
    const head = rest[0]
    if (head === undefined) break
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(head)) {
      rest = rest.slice(1)
      continue
    }
    const name = head.split('/').pop() ?? head
    if (!WRAPPERS.has(name)) break
    rest = rest.slice(1)
    while (rest[0] !== undefined && (rest[0].startsWith('-') || /^\d+[smhd]?$/.test(rest[0]))) {
      const flag = rest[0]
      rest = rest.slice(1)
      if (['-u', '-n', '-g', '-I', '-s'].includes(flag) && rest[0] !== undefined) rest = rest.slice(1)
    }
  }
  return rest
}

/** Every command a command line runs, as argv lists, substitutions included. */
export function commandsIn(line: string, depth = 0): string[][] {
  const { parts, inner } = segments(line)
  const out: string[][] = []
  for (const part of parts) {
    const argv = unwrap(words(part.replace(/^[({\s!]+|[)}\s]+$/g, '')))
    if (argv.length === 0) continue
    out.push(argv)
    // `bash -c "..."` and `eval "..."` run their argument as a command line.
    const name = argv[0]!.split('/').pop() ?? ''
    if (depth < 3 && ['bash', 'sh', 'zsh', 'dash', 'ksh'].includes(name)) {
      const at = argv.indexOf('-c')
      const script = at >= 0 ? argv[at + 1] : undefined
      if (script !== undefined) out.push(...commandsIn(script, depth + 1))
    }
    if (depth < 3 && name === 'eval' && argv.length > 1) out.push(...commandsIn(argv.slice(1).join(' '), depth + 1))
  }
  if (depth < 3) for (const sub of inner) out.push(...commandsIn(sub, depth + 1))
  return out
}
