// Pure command analysis: no `$`, so tests and other mods can import it.

export type Level = 'block' | 'confirm'

export type Finding = {
  rule: string
  level: Level
  why: string
}

// Paths whose recursive removal (or chmod/chown) is never what anyone meant.
const SYSTEM_DIRS = new Set([
  '/', '/*', '/.', '/..',
  '~', '~/', '~/*', '~/.', '~/..',
  '$HOME', '$HOME/', '$HOME/*', '${HOME}', '${HOME}/', '${HOME}/*',
  '/Users', '/Users/', '/Users/*', '/home', '/home/', '/home/*',
  '/root', '/etc', '/usr', '/usr/local', '/bin', '/sbin', '/lib', '/var',
  '/opt', '/boot', '/dev', '/sys', '/proc', '/private', '/System',
  '/Library', '/Applications', '/Volumes', '/mnt',
])

// Commands that run the rest of their arguments as a command.
const PREFIXES = new Set([
  'sudo', 'doas', 'command', 'exec', 'nohup', 'time', 'nice', 'env',
  'xargs', 'builtin', 'caffeinate', 'timeout', 'stdbuf',
])

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

/** Drops leading `VAR=value` words and wrapper commands (`sudo`, `xargs`...). */
function unwrap(argv: string[]): { argv: string[]; isSudo: boolean } {
  let rest = argv
  let isSudo = false
  for (;;) {
    const head = rest[0]
    if (head === undefined) break
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(head)) {
      rest = rest.slice(1)
      continue
    }
    const base = head.split('/').pop() ?? head
    if (!PREFIXES.has(base)) break
    if (base === 'sudo' || base === 'doas') isSudo = true
    rest = rest.slice(1)
    // Skip the wrapper's own flags (`sudo -u root`, `timeout 5`, `nice -n 10`).
    while (rest[0] !== undefined && (rest[0].startsWith('-') || /^\d+[smhd]?$/.test(rest[0]))) {
      const flag = rest[0]
      rest = rest.slice(1)
      if ((flag === '-u' || flag === '-n' || flag === '-g') && rest[0] !== undefined) rest = rest.slice(1)
    }
  }
  return { argv: rest, isSudo }
}

function hasShortFlag(args: string[], letters: string): boolean {
  return args.some(a => /^-[A-Za-z]+$/.test(a) && [...letters].some(l => a.includes(l)))
}

function isSystemPath(target: string): boolean {
  const t = target.replace(/\/+$/, '') || '/'
  return SYSTEM_DIRS.has(target) || SYSTEM_DIRS.has(t)
}

function base(word: string | undefined): string {
  return (word ?? '').split('/').pop() ?? ''
}

function checkArgv(raw: string[], findings: Finding[], depth: number): void {
  const { argv, isSudo } = unwrap(raw)
  const cmd = base(argv[0])
  const args = argv.slice(1)
  const sub = args[0]
  const operands = args.filter(a => !a.startsWith('-'))

  if (isSudo) {
    findings.push({ rule: 'sudo', level: 'confirm', why: 'runs a command as root' })
  }

  // `bash -c "..."`, `sh -c`, `eval "..."`: look inside.
  if (depth < 3 && ['bash', 'sh', 'zsh', 'dash', 'ksh', 'fish'].includes(cmd)) {
    const at = args.indexOf('-c')
    const inner = at >= 0 ? args[at + 1] : undefined
    if (inner !== undefined) scan(inner, findings, depth + 1)
  }
  if (depth < 3 && cmd === 'eval' && args.length > 0) scan(args.join(' '), findings, depth + 1)

  switch (cmd) {
    case 'rm': {
      const isRecursive = hasShortFlag(args, 'rR') || args.includes('--recursive')
      if (args.includes('--no-preserve-root')) {
        findings.push({ rule: 'rm-no-preserve-root', level: 'block', why: 'rm --no-preserve-root can erase the whole disk' })
      }
      if (isRecursive && operands.some(isSystemPath)) {
        const target = operands.find(isSystemPath) ?? ''
        findings.push({ rule: 'rm-system', level: 'block', why: `recursively deletes ${target}` })
      } else if (isRecursive && operands.some(o => o === '*' || o === '.' || o === '..' || o === './*')) {
        findings.push({ rule: 'rm-wildcard', level: 'confirm', why: 'recursively deletes everything in the current directory' })
      } else if (isRecursive && operands.some(o => /(^|\/)\.git\/?$/.test(o))) {
        findings.push({ rule: 'rm-git', level: 'confirm', why: 'deletes the repository history (.git)' })
      } else if (isRecursive && operands.length === 0 && raw[0] !== undefined && base(raw[0]) === 'xargs') {
        findings.push({ rule: 'rm-xargs', level: 'confirm', why: 'recursively deletes whatever is piped in' })
      }
      break
    }
    case 'chmod':
    case 'chown':
    case 'chgrp': {
      const isRecursive = hasShortFlag(args, 'R') || args.includes('--recursive')
      if (isRecursive && operands.slice(1).some(isSystemPath)) {
        findings.push({ rule: `${cmd}-system`, level: 'block', why: `${cmd} -R on a system directory` })
      } else if (cmd === 'chmod' && operands.some(o => o === '777' || o === 'a+rwx')) {
        findings.push({ rule: 'chmod-777', level: 'confirm', why: 'makes files world-writable' })
      }
      break
    }
    case 'dd':
      if (args.some(a => /^of=\/dev\/(?!null$|zero$|stdout$|stderr$)/.test(a))) {
        findings.push({ rule: 'dd-device', level: 'block', why: 'dd writes straight onto a device' })
      }
      break
    case 'shred':
    case 'wipefs':
    case 'fdisk':
    case 'sfdisk':
    case 'parted':
      findings.push({ rule: cmd, level: 'block', why: `${cmd} destroys disk data` })
      break
    case 'diskutil':
      if (sub !== undefined && /^(erase|zero|partition|secureErase|reformat|apfs)/i.test(sub)) {
        findings.push({ rule: 'diskutil-erase', level: 'block', why: `diskutil ${sub} erases a disk` })
      }
      break
    case 'shutdown':
    case 'reboot':
    case 'halt':
    case 'poweroff':
      findings.push({ rule: 'power', level: 'block', why: `${cmd} turns the machine off` })
      break
    case 'kill':
      if (/(^| )-(9|KILL|SIGKILL|s KILL) -1( |$)/.test(args.join(' '))) {
        findings.push({ rule: 'kill-all', level: 'block', why: 'kill -9 -1 kills every process you own' })
      }
      break
    case 'find':
      if (args.includes('-delete') || args.some((a, i) => a === '-exec' && base(args[i + 1]) === 'rm')) {
        const root = operands[0] ?? '.'
        findings.push(isSystemPath(root)
          ? { rule: 'find-delete-system', level: 'block', why: `find ${root} -delete deletes system files` }
          : { rule: 'find-delete', level: 'confirm', why: 'find deletes every file it matches' })
      }
      break
    case 'git':
      checkGit(args, findings)
      break
    case 'crontab':
      if (args.includes('-r')) findings.push({ rule: 'crontab-remove', level: 'confirm', why: 'removes every cron job' })
      break
    case 'terraform':
    case 'tofu':
    case 'pulumi':
    case 'cdk':
      if (args.includes('destroy')) findings.push({ rule: 'iac-destroy', level: 'confirm', why: `${cmd} destroy tears down infrastructure` })
      break
    case 'kubectl':
      if (sub === 'delete' || sub === 'drain') findings.push({ rule: 'kubectl-delete', level: 'confirm', why: `kubectl ${sub} changes a live cluster` })
      break
    case 'helm':
      if (sub === 'uninstall' || sub === 'delete') findings.push({ rule: 'helm-uninstall', level: 'confirm', why: 'removes a Helm release' })
      break
    case 'aws':
      if (args.some(a => /^(delete|terminate|remove|deregister|purge)-/.test(a)) || (args[0] === 's3' && (args[1] === 'rb' || (args[1] === 'rm' && args.includes('--recursive'))))) {
        findings.push({ rule: 'cloud-delete', level: 'confirm', why: 'deletes cloud resources' })
      }
      break
    case 'gcloud':
    case 'az':
    case 'doctl':
    case 'flyctl':
    case 'fly':
    case 'heroku':
      if (args.some(a => /^(delete|destroy|remove|rm)$/.test(a) || /^apps:destroy$/.test(a))) {
        findings.push({ rule: 'cloud-delete', level: 'confirm', why: 'deletes cloud resources' })
      }
      break
    case 'docker':
    case 'podman':
      if ((sub === 'system' && args[1] === 'prune') || (sub === 'volume' && (args[1] === 'rm' || args[1] === 'prune'))) {
        findings.push({ rule: 'docker-prune', level: 'confirm', why: 'deletes containers, images or volumes' })
      }
      break
    case 'npm':
    case 'pnpm':
    case 'yarn':
    case 'cargo':
    case 'gem':
    case 'twine':
    case 'poetry':
    case 'flit':
      if (sub === 'publish' || (cmd === 'gem' && sub === 'push') || (cmd === 'twine' && sub === 'upload')) {
        findings.push({ rule: 'publish', level: 'confirm', why: `publishes a package to a public registry` })
      }
      break
    case 'gh':
      if (sub === 'repo' && args[1] === 'delete') findings.push({ rule: 'gh-repo-delete', level: 'block', why: 'deletes a GitHub repository' })
      else if (sub === 'release' && args[1] === 'delete') findings.push({ rule: 'gh-release-delete', level: 'confirm', why: 'deletes a GitHub release' })
      break
  }
}

function checkGit(args: string[], findings: Finding[]): void {
  // Skip global options: `git -C dir push`, `git -c k=v push`.
  let i = 0
  while (args[i] !== undefined && args[i]!.startsWith('-')) i += args[i] === '-C' || args[i] === '-c' ? 2 : 1
  const sub = args[i]
  const rest = args.slice(i + 1)
  const operands = rest.filter(a => !a.startsWith('-'))

  switch (sub) {
    case 'push': {
      const isForce = rest.some(a => a === '--force' || a === '-f' || a.startsWith('--force-with-lease') || a === '--mirror' || a === '--delete' || a === '-d') ||
        hasShortFlag(rest, 'f') || operands.slice(1).some(r => r.startsWith('+') || r.startsWith(':'))
      if (isForce) {
        const toMain = operands.some(r => /(^|[:+/])(main|master|trunk|prod|production|release)$/.test(r))
        findings.push({ rule: 'git-force-push', level: 'confirm', why: toMain ? 'force-pushes over a protected branch' : 'force-pushes, rewriting remote history' })
      }
      break
    }
    case 'reset':
      if (rest.includes('--hard') || rest.includes('--merge')) findings.push({ rule: 'git-reset-hard', level: 'confirm', why: 'git reset --hard throws away uncommitted work' })
      break
    case 'clean':
      if (hasShortFlag(rest, 'f') || rest.includes('--force')) findings.push({ rule: 'git-clean', level: 'confirm', why: 'git clean deletes untracked files' })
      break
    case 'checkout':
      if (rest.includes('--') && operands.some(o => o === '.' || o === '*') || operands.length === 1 && operands[0] === '.') {
        findings.push({ rule: 'git-discard', level: 'confirm', why: 'discards uncommitted changes' })
      }
      break
    case 'restore':
      if (!rest.includes('--staged') && operands.some(o => o === '.' || o === '*' || o === ':/')) {
        findings.push({ rule: 'git-discard', level: 'confirm', why: 'discards uncommitted changes' })
      }
      break
    case 'stash':
      if (rest[0] === 'clear' || rest[0] === 'drop') findings.push({ rule: 'git-stash-drop', level: 'confirm', why: 'deletes stashed work' })
      break
    case 'branch':
      if (rest.includes('-D') || (rest.includes('--delete') && rest.includes('--force'))) findings.push({ rule: 'git-branch-delete', level: 'confirm', why: 'force-deletes a branch' })
      break
    case 'filter-branch':
    case 'filter-repo':
      findings.push({ rule: 'git-rewrite', level: 'confirm', why: 'rewrites the whole history' })
      break
    case 'update-ref':
      if (rest.includes('-d')) findings.push({ rule: 'git-ref-delete', level: 'confirm', why: 'deletes a ref' })
      break
    case 'reflog':
      if (rest[0] === 'expire' || rest[0] === 'delete') findings.push({ rule: 'git-reflog', level: 'confirm', why: 'erases the reflog, the safety net for lost commits' })
      break
  }
}

/** Patterns no tokenizer is needed for. */
function checkRaw(command: string, findings: Finding[]): void {
  if (/:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;?\s*:/.test(command)) {
    findings.push({ rule: 'fork-bomb', level: 'block', why: 'a fork bomb freezes the machine' })
  }
  if (/>\s*\/dev\/(sd[a-z]|disk\d|nvme\d|hd[a-z]|mmcblk\d)/.test(command)) {
    findings.push({ rule: 'device-overwrite', level: 'block', why: 'writes straight onto a disk device' })
  }
  if (/\bmkfs(\.\w+)?\b/.test(command)) {
    findings.push({ rule: 'mkfs', level: 'block', why: 'mkfs formats a disk' })
  }
  if (/\b(curl|wget|fetch)\b[^|]*\|\s*(sudo\s+)?(ba|z|da|k)?sh\b/.test(command) || /\b(ba|z)?sh\s+(-c\s+)?["']?\$\(\s*(curl|wget)\b/.test(command) || /\b(ba|z)?sh\s+<\(\s*(curl|wget)\b/.test(command)) {
    findings.push({ rule: 'pipe-to-shell', level: 'confirm', why: 'runs a script straight from the internet' })
  }
  if (/\b(DROP\s+(DATABASE|SCHEMA|TABLE)|TRUNCATE\s+(TABLE\s+)?\w)/i.test(command)) {
    findings.push({ rule: 'sql-drop', level: 'confirm', why: 'drops or truncates database objects' })
  }
  if (/\bDELETE\s+FROM\s+[\w."`]+\s*(;|"|'|$)/i.test(command)) {
    findings.push({ rule: 'sql-delete-all', level: 'confirm', why: 'DELETE without WHERE empties a table' })
  }
  if (/\bFLUSHALL\b|\bFLUSHDB\b|dropDatabase\(\)/.test(command)) {
    findings.push({ rule: 'db-flush', level: 'confirm', why: 'wipes a database' })
  }
  if (/>\s*~?\/?(\.\w*)?\/?\.(bashrc|zshrc|profile|bash_profile|zprofile|ssh\/authorized_keys|gitconfig)\b/.test(command) && !/>>/.test(command)) {
    findings.push({ rule: 'dotfile-truncate', level: 'confirm', why: 'overwrites a shell or ssh config file' })
  }
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

function scan(command: string, findings: Finding[], depth: number): void {
  checkRaw(command, findings)
  const { parts, inner } = segments(command)
  for (const part of parts) {
    const argv = words(part.replace(/^[({\s!]+|[)}\s]+$/g, ''))
    if (argv.length > 0) checkArgv(argv, findings, depth)
  }
  if (depth < 3) for (const sub of inner) scan(sub, findings, depth + 1)
}

/** Every rule the command trips, most severe first, one finding per rule. */
export function analyze(command: string): Finding[] {
  const findings: Finding[] = []
  scan(command, findings, 0)
  const seen = new Set<string>()
  return findings
    .filter(f => (seen.has(f.rule) ? false : (seen.add(f.rule), true)))
    .sort((a, b) => (a.level === b.level ? 0 : a.level === 'block' ? -1 : 1))
}

/** Whether `command` matches the person's own pattern; a bad pattern never matches. */
export function matchesCustom(command: string, pattern: string): boolean {
  if (pattern.trim() === '') return false
  try {
    return new RegExp(pattern, 'i').test(command)
  } catch {
    return false
  }
}
