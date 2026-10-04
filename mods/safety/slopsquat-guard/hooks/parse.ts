// Pure parsing of package-install commands: no `$`, so tests can import it.

export type Ecosystem = 'npm' | 'pypi' | 'crates' | 'rubygems'

export type Install = {
  ecosystem: Ecosystem
  /** The package's registry name, versions and extras stripped. */
  name: string
  /** As written in the command. */
  spec: string
  /** Run straight away (`npx`, `uvx`, `pipx run`) rather than installed. */
  isRun: boolean
}

export type Parsed = {
  installs: Install[]
  /** The command names its own registry or index, which this guard cannot vouch for. */
  hasCustomRegistry: boolean
}

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

/** Splits a command line at `;`, `&&`, `||`, `|`, `&` and newlines outside quotes. */
export function segments(command: string): string[] {
  const parts: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  for (let i = 0; i < command.length; i++) {
    const ch = command[i] ?? ''
    if (quote !== null) {
      if (ch === quote) quote = null
      current += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      current += ch
      continue
    }
    if (ch === '\\') {
      current += ch + (command[i + 1] ?? '')
      i++
      continue
    }
    const isAmp = ch === '&' && command[i + 1] !== '>' && command[i - 1] !== '>'
    if (ch === ';' || ch === '\n' || ch === '|' || isAmp) {
      parts.push(current)
      current = ''
      if (command[i + 1] === ch) i++
      continue
    }
    current += ch
  }
  parts.push(current)
  return parts.map(p => p.trim()).filter(p => p !== '')
}

const ENV_WORD = /^[A-Za-z_][A-Za-z0-9_]*=/
const WRAPPERS = new Set(['sudo', 'env', 'command', 'exec', 'nohup', 'time'])

/** Drops `VAR=value` words and wrappers such as `sudo`. */
function unwrap(argv: string[]): string[] {
  let rest = argv
  while (rest[0] !== undefined && (ENV_WORD.test(rest[0]) || WRAPPERS.has(rest[0]))) {
    rest = rest.slice(1)
    while (rest[0] !== undefined && rest[0].startsWith('-') && !ENV_WORD.test(rest[0])) rest = rest.slice(1)
  }
  return rest
}

const base = (word: string | undefined) => (word ?? '').split('/').pop() ?? ''

/**
 * The operands of an install subcommand: every word that is not a flag or a
 * flag's value. `takesValue` names the flags whose next word is their value.
 */
function operands(args: string[], takesValue: Set<string>): string[] {
  const out: string[] = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? ''
    if (arg === '--') {
      out.push(...args.slice(i + 1))
      break
    }
    if (arg.startsWith('-')) {
      if (!arg.includes('=') && takesValue.has(arg)) i++
      continue
    }
    out.push(arg)
  }
  return out
}

const hasFlag = (args: string[], ...flags: string[]) => args.some(a => flags.some(f => a === f || a.startsWith(`${f}=`)))

// ---------------------------------------------------------------- npm

const NPM_VALUE_FLAGS = new Set(['-w', '--workspace', '--prefix', '--tag', '--omit', '--include', '--cache', '--filter', '-C', '--dir', '--save-prefix', '--userconfig', '--package', '-p', '--registry', '--scope', '--cwd'])
const NPM_NAME = /^(@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/i

/** `@scope/name@^1.2` → `@scope/name`; undefined for a path, URL, alias to one, or tag-only spec. */
export function npmName(spec: string): string | undefined {
  // Paths, URLs and protocol specs (`file:`, `git+`, `github:`, `workspace:`).
  if (/^(\.{0,2}\/|~\/|[a-z]+:|git\+)/i.test(spec)) return undefined
  if (/\.(tgz|tar\.gz|tar)$/i.test(spec)) return undefined
  // An alias names the real package: `alias@npm:real@1`.
  const alias = spec.match(/^[^@]+@npm:(.+)$/) ?? spec.match(/^(@[^/]+\/[^@]+)@npm:(.+)$/)
  if (alias) return npmName(alias.at(-1) ?? '')
  let name = spec
  if (name.startsWith('@')) {
    const at = name.indexOf('@', 1)
    if (at > 0) name = name.slice(0, at)
  } else {
    const at = name.indexOf('@')
    if (at === 0) return undefined
    if (at > 0) name = name.slice(0, at)
    // `user/repo` is GitHub shorthand, not a registry package.
    if (name.includes('/')) return undefined
  }
  return NPM_NAME.test(name) ? name.toLowerCase() : undefined
}

function npmInstalls(argv: string[]): Install[] | undefined {
  const tool = base(argv[0])
  const args = argv.slice(1)
  const sub = args[0]
  const rest = args.slice(1)
  let specs: string[] | undefined
  let isRun = false

  if (tool === 'npm' && sub !== undefined && ['install', 'i', 'add', 'in', 'ins', 'isntall'].includes(sub)) specs = operands(rest, NPM_VALUE_FLAGS)
  else if ((tool === 'npm' && sub === 'exec') || tool === 'npx' || tool === 'bunx') {
    // `npx [-p pkg] cmd args`: the package is `-p`'s value, else the first operand.
    const list = tool === 'npm' ? rest : args
    const pkg: string[] = []
    for (let i = 0; i < list.length; i++) if ((list[i] === '-p' || list[i] === '--package') && list[i + 1] !== undefined) pkg.push(list[i + 1]!)
    const first = operands(list, NPM_VALUE_FLAGS)[0]
    specs = pkg.length > 0 ? pkg : first === undefined ? [] : [first]
    isRun = true
  } else if (tool === 'pnpm' && (sub === 'add' || sub === 'i' || sub === 'install')) specs = operands(rest, NPM_VALUE_FLAGS)
  else if ((tool === 'pnpm' || tool === 'yarn') && sub === 'dlx') {
    const first = operands(rest, NPM_VALUE_FLAGS)[0]
    specs = first === undefined ? [] : [first]
    isRun = true
  } else if (tool === 'yarn' && (sub === 'add' || (sub === 'global' && rest[0] === 'add'))) specs = operands(sub === 'global' ? rest.slice(1) : rest, NPM_VALUE_FLAGS)
  else if (tool === 'bun' && (sub === 'add' || sub === 'a' || sub === 'install' || sub === 'i')) specs = operands(rest, NPM_VALUE_FLAGS)
  else if (tool === 'bun' && sub === 'x') {
    const first = operands(rest, NPM_VALUE_FLAGS)[0]
    specs = first === undefined ? [] : [first]
    isRun = true
  }
  if (specs === undefined) return undefined

  return specs.flatMap(spec => {
    const name = npmName(spec)
    return name === undefined ? [] : [{ ecosystem: 'npm' as const, name, spec, isRun }]
  })
}

// ---------------------------------------------------------------- PyPI

const PIP_VALUE_FLAGS = new Set(['-r', '--requirement', '-c', '--constraint', '-e', '--editable', '-t', '--target', '--prefix', '--root', '-f', '--find-links', '--trusted-host', '--python', '-p', '--group', '-G', '--extra', '--src', '--platform', '--python-version', '--implementation', '--abi', '--upgrade-strategy', '--progress-bar', '--log', '--cache-dir', '--report', '--source', '--optional', '--with', '--spec', '--from'])
const PYPI_NAME = /^[A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?$/

/** `Requests[socks]>=2.0; python_version>"3"` → `requests`; undefined for a path, URL or archive. */
export function pypiName(spec: string): string | undefined {
  if (/^(\.{0,2}\/|~\/|[a-z+]+:\/\/|git\+|file:)/i.test(spec) || spec === '.' || spec === '..') return undefined
  if (/\.(whl|tar\.gz|zip|tgz)$/i.test(spec)) return undefined
  if (/\s@\s|@\s*[a-z+]+:\/\//i.test(spec)) return undefined
  const name = spec.split(/[[;<>=!~ @]/)[0] ?? ''
  if (!PYPI_NAME.test(name)) return undefined
  return name.toLowerCase().replace(/[-_.]+/g, '-')
}

function pypiInstalls(argv: string[]): Install[] | undefined {
  let rest = argv
  let tool = base(rest[0])
  // `python -m pip install`, `python3.12 -m pip install`, `uv pip install`, `pipx run`.
  if (/^python(\d(\.\d+)?)?$/.test(tool) && rest[1] === '-m') {
    rest = rest.slice(2)
    tool = base(rest[0])
  }
  const sub = rest[1]
  let specs: string[] | undefined
  let isRun = false

  if (/^pip(\d(\.\d+)?)?$/.test(tool) && sub === 'install') specs = operands(rest.slice(2), PIP_VALUE_FLAGS)
  else if (tool === 'uv' && sub === 'pip' && rest[2] === 'install') specs = operands(rest.slice(3), PIP_VALUE_FLAGS)
  else if (tool === 'uv' && sub === 'add') specs = operands(rest.slice(2), PIP_VALUE_FLAGS)
  else if (tool === 'uv' && sub === 'tool' && (rest[2] === 'install' || rest[2] === 'run')) {
    specs = operands(rest.slice(3), PIP_VALUE_FLAGS).slice(0, 1)
    isRun = rest[2] === 'run'
  } else if (tool === 'uvx') {
    const from = rest.findIndex(w => w === '--from')
    specs = from >= 0 && rest[from + 1] !== undefined ? [rest[from + 1]!] : operands(rest.slice(1), PIP_VALUE_FLAGS).slice(0, 1)
    isRun = true
  } else if ((tool === 'poetry' || tool === 'pdm' || tool === 'rye' || tool === 'hatch') && sub === 'add') specs = operands(rest.slice(2), PIP_VALUE_FLAGS)
  else if (tool === 'pipenv' && sub === 'install') specs = operands(rest.slice(2), PIP_VALUE_FLAGS)
  else if (tool === 'pipx' && (sub === 'install' || sub === 'run')) {
    specs = operands(rest.slice(2), PIP_VALUE_FLAGS).slice(0, sub === 'run' ? 1 : undefined)
    isRun = sub === 'run'
  }
  if (specs === undefined) return undefined

  return specs.flatMap(spec => {
    const name = pypiName(spec)
    return name === undefined ? [] : [{ ecosystem: 'pypi' as const, name, spec, isRun }]
  })
}

// ---------------------------------------------------------------- crates.io, RubyGems

const CARGO_VALUE_FLAGS = new Set(['--features', '-F', '--rename', '--package', '-p', '--target', '--branch', '--tag', '--rev', '--version', '--vers', '--root', '--bin', '--example', '--manifest-path', '--profile', '-j', '--jobs', '--target-dir'])
const GEM_VALUE_FLAGS = new Set(['-v', '--version', '-i', '--install-dir', '-n', '--bindir', '--platform', '-g', '--file', '--group', '--require'])
const CRATE_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/
const GEM_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

function cargoInstalls(argv: string[]): Install[] | undefined {
  if (base(argv[0]) !== 'cargo') return undefined
  const sub = argv[1]
  if (sub !== 'add' && sub !== 'install') return undefined
  const args = argv.slice(2)
  if (hasFlag(args, '--path', '--git')) return []
  return operands(args, CARGO_VALUE_FLAGS).flatMap(spec => {
    const name = spec.split('@')[0] ?? ''
    return CRATE_NAME.test(name) ? [{ ecosystem: 'crates' as const, name: name.toLowerCase(), spec, isRun: false }] : []
  })
}

function gemInstalls(argv: string[]): Install[] | undefined {
  const tool = base(argv[0])
  const isGem = tool === 'gem' && argv[1] === 'install'
  const isBundle = tool === 'bundle' && argv[1] === 'add'
  if (!isGem && !isBundle) return undefined
  const args = argv.slice(2)
  if (hasFlag(args, '--local', '--path', '--git', '--github')) return []
  const specs = isBundle ? operands(args, GEM_VALUE_FLAGS).slice(0, 1) : operands(args, GEM_VALUE_FLAGS)
  return specs.flatMap(spec => {
    if (/\.gem$/.test(spec) || spec.includes('/')) return []
    const name = spec.split(':')[0] ?? ''
    return GEM_NAME.test(name) ? [{ ecosystem: 'rubygems' as const, name, spec, isRun: false }] : []
  })
}

// ---------------------------------------------------------------- all

// Flags that point an installer at another registry or index.
const REGISTRY_FLAGS: Record<Ecosystem, string[]> = {
  npm: ['--registry'],
  pypi: ['-i', '--index-url', '--extra-index-url', '--index', '--default-index'],
  crates: ['--registry', '--index'],
  rubygems: ['--source', '-s'],
}

/** Every registry package `command` installs or runs, and whether it names its own registry. */
export function parseInstalls(command: string): Parsed {
  const installs: Install[] = []
  let hasCustomRegistry = false
  for (const segment of segments(command)) {
    const argv = unwrap(words(segment.replace(/^[({\s!]+|[)}\s]+$/g, '')))
    if (argv.length === 0) continue
    const found = npmInstalls(argv) ?? pypiInstalls(argv) ?? cargoInstalls(argv) ?? gemInstalls(argv)
    if (found === undefined) continue
    const ecosystem: Ecosystem = npmInstalls(argv) !== undefined ? 'npm' : pypiInstalls(argv) !== undefined ? 'pypi' : cargoInstalls(argv) !== undefined ? 'crates' : 'rubygems'
    if (hasFlag(argv, ...REGISTRY_FLAGS[ecosystem])) {
      hasCustomRegistry = true
      continue
    }
    installs.push(...found)
  }
  // One check per package, even when a command names it twice.
  const seen = new Set<string>()
  return {
    installs: installs.filter(i => (seen.has(`${i.ecosystem}:${i.name}`) ? false : (seen.add(`${i.ecosystem}:${i.name}`), true))),
    hasCustomRegistry,
  }
}
