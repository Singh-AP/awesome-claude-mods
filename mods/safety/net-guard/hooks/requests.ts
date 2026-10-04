// Finds the network requests a command line or a fetch would make: no `$`, pure.

import { parseTarget, type Target } from './hosts'
import { commandsIn } from './shell'

export type Request = {
  /** What makes the request: `curl`, `ssh`, `git push`, `WebFetch`... */
  tool: string
  /** Where it goes; `null` when only known at run time. */
  target: Target | null
  /** Whether it sends data (a body, a file, a push, a remote shell). */
  isUpload: boolean
  /** The word it came from, for messages. */
  raw: string
}

const UPLOAD_METHODS = /^(POST|PUT|PATCH|DELETE)$/i

/** Reads one command's flags: which take a value, and which of those mean "sends data". */
function scan(args: readonly string[], valueLong: ReadonlySet<string>, valueShort: string) {
  const operands: string[] = []
  const values: Array<[flag: string, value: string]> = []
  const flags: string[] = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (arg === '--') {
      operands.push(...args.slice(i + 1))
      break
    }
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=')
      if (eq > 0) values.push([arg.slice(0, eq), arg.slice(eq + 1)])
      else if (valueLong.has(arg) && i + 1 < args.length) values.push([arg, args[++i]!])
      else flags.push(arg)
      continue
    }
    if (arg.startsWith('-') && arg.length > 1) {
      // A cluster like -sSLX POST or -d@body.json: a value flag takes the rest, or the next word.
      for (let j = 1; j < arg.length; j++) {
        const letter = arg[j]!
        if (valueShort.includes(letter)) {
          const rest = arg.slice(j + 1)
          if (rest !== '') values.push([`-${letter}`, rest])
          else if (i + 1 < args.length) values.push([`-${letter}`, args[++i]!])
          break
        }
        flags.push(`-${letter}`)
      }
      continue
    }
    operands.push(arg)
  }
  const valueOf = (...names: string[]) => values.filter(([flag]) => names.includes(flag)).map(([, value]) => value)
  const has = (...names: string[]) => flags.some(f => names.includes(f)) || values.some(([f]) => names.includes(f))
  return { operands, valueOf, has }
}

const request = (tool: string, raw: string, isUpload: boolean): Request | undefined => {
  const target = parseTarget(raw)
  return target === undefined ? undefined : { tool, target, isUpload, raw }
}

const CURL_LONG = new Set([
  '--request', '--header', '--data', '--data-ascii', '--data-binary', '--data-raw', '--data-urlencode', '--json',
  '--form', '--form-string', '--output', '--user', '--user-agent', '--referer', '--cookie', '--cookie-jar',
  '--upload-file', '--connect-timeout', '--max-time', '--write-out', '--proxy', '--resolve', '--connect-to',
  '--config', '--cacert', '--capath', '--cert', '--key', '--range', '--continue-at', '--retry', '--retry-delay',
  '--retry-max-time', '--limit-rate', '--time-cond', '--proxy-user', '--quote', '--url', '--max-filesize',
  '--interface', '--dns-servers', '--output-dir', '--max-redirs', '--noproxy', '--oauth2-bearer', '--pass',
  '--proxy-header', '--socks5', '--socks5-hostname', '--socks4', '--socks4a', '--preproxy', '--trace',
  '--trace-ascii', '--stderr', '--variable', '--aws-sigv4', '--unix-socket', '--abstract-unix-socket',
  '--mail-from', '--mail-rcpt', '--local-port', '--keepalive-time', '--expect100-timeout', '--ciphers',
])

function curl(args: readonly string[]): Request[] {
  const { operands, valueOf, has } = scan(args, CURL_LONG, 'XHdFouAebcTmwxKErCYyzUQtPD')
  if (has('--unix-socket', '--abstract-unix-socket')) return []
  const isUpload =
    has('-d', '--data', '--data-ascii', '--data-binary', '--data-raw', '--data-urlencode', '--json', '-F', '--form', '--form-string', '-T', '--upload-file') ||
    valueOf('-X', '--request').some(method => UPLOAD_METHODS.test(method))
  const urls = [...operands, ...valueOf('--url')]
  const out = urls.map(url => request('curl', url, isUpload))
  // A proxy sees everything the request carries.
  for (const proxy of valueOf('-x', '--proxy', '--socks5', '--socks5-hostname', '--socks4', '--socks4a', '--preproxy')) out.push(request('curl proxy', proxy, isUpload))
  return out.filter((r): r is Request => r !== undefined)
}

const WGET_LONG = new Set([
  '--output-document', '--output-file', '--append-output', '--directory-prefix', '--user-agent', '--header',
  '--post-data', '--post-file', '--body-data', '--body-file', '--method', '--user', '--password', '--http-user',
  '--http-password', '--tries', '--timeout', '--wait', '--execute', '--input-file', '--base', '--load-cookies',
  '--save-cookies', '--quota', '--limit-rate', '--level', '--accept', '--reject', '--domains', '--exclude-domains',
  '--referer', '--ca-certificate', '--certificate', '--private-key', '--proxy-user', '--proxy-password',
])

function wget(args: readonly string[]): Request[] {
  const { operands, valueOf, has } = scan(args, WGET_LONG, 'OoaPUtTweiBQlARDXI')
  const isUpload = has('--post-data', '--post-file', '--body-data', '--body-file') || valueOf('--method').some(m => UPLOAD_METHODS.test(m))
  const out = operands.map(url => request('wget', url, isUpload)).filter((r): r is Request => r !== undefined)
  if (has('-i', '--input-file')) out.push({ tool: 'wget', target: null, isUpload, raw: 'URLs read from a file' })
  return out
}

const HTTPIE_LONG = new Set(['--auth', '--auth-type', '--session', '--session-read-only', '--output', '--verify', '--cert', '--cert-key', '--timeout', '--proxy', '--pretty', '--style', '--print', '--format-options', '--boundary', '--raw', '--default-scheme', '--max-redirects', '--max-headers', '--response-charset', '--response-mime'])

function httpie(name: string, args: readonly string[]): Request[] {
  const { operands, has } = scan(args, HTTPIE_LONG, 'aospA')
  let rest = operands
  let method = ''
  if (rest[0] !== undefined && /^[A-Z]+$/.test(rest[0])) {
    method = rest[0]
    rest = rest.slice(1)
  }
  const url = rest[0]
  if (url === undefined) return []
  const items = rest.slice(1)
  // `name=value`, `name:=json` and `field@file` are a body; `Header:value` and `param==value` aren't.
  const hasBody = has('--raw') || items.some(item => /^[^=:@\s]*(:=|=(?!=)|@)/.test(item) && !/^[^=:@\s]*==/.test(item))
  const isUpload = UPLOAD_METHODS.test(method) || hasBody
  // `http :3000/api` is localhost shorthand.
  const raw = url.startsWith(':') ? `localhost${url}` : url
  const r = request(name, raw, isUpload)
  return r === undefined ? [] : [r]
}

function netcat(name: string, args: readonly string[]): Request[] {
  const { operands, has } = scan(args, new Set(['--source', '--wait', '--exec', '--sh-exec', '--proxy', '--proxy-type']), 'pswxXeciqIOTVgGPo')
  if (has('-l', '--listen')) return []
  const host = operands[0]
  if (host === undefined) return []
  const r = request(name, host, !has('-z'))
  return r === undefined ? [] : [r]
}

function ssh(args: readonly string[]): Request[] {
  const { operands, valueOf } = scan(args, new Set(), 'bcDEeFIiJLlmOopQRSWwB')
  const out: Request[] = []
  const host = operands[0]
  if (host !== undefined) {
    const r = request('ssh', host.includes('://') ? host : `ssh://${host}`, true)
    if (r !== undefined) out.push(r)
  }
  for (const jump of valueOf('-J').flatMap(v => v.split(','))) {
    const r = request('ssh jump host', `ssh://${jump}`, true)
    if (r !== undefined) out.push(r)
  }
  return out
}

/** `user@host:path`, `host:path` (with a dot or user, so `C:` and `a:b` files stay files) or `rsync://`. */
function remoteSpec(word: string): string | undefined {
  if (/^(rsync|sftp|scp|ssh):\/\//i.test(word)) return word
  const m = word.match(/^(?:([^@/\s:]+)@)?([^:/\s@]+)::?(.*)$/)
  if (m === null || word.startsWith('/') || word.startsWith('.')) return undefined
  const [, user, host] = m
  if (user === undefined && !host!.includes('.') && host !== 'localhost') return undefined
  return `ssh://${user === undefined ? '' : `${user}@`}${host}`
}

const RSYNC_LONG = new Set(['--rsh', '--exclude', '--include', '--filter', '--files-from', '--password-file', '--port', '--temp-dir', '--chmod', '--chown', '--backup-dir', '--suffix', '--log-file', '--partial-dir', '--compare-dest', '--link-dest', '--copy-dest', '--timeout', '--contimeout', '--bwlimit', '--max-size', '--min-size', '--modify-window', '--out-format', '--iconv'])

function copy(name: 'scp' | 'rsync', args: readonly string[]): Request[] {
  const { operands } = name === 'scp' ? scan(args, new Set(), 'cFiJloPSX') : scan(args, RSYNC_LONG, 'efT')
  const out: Request[] = []
  operands.forEach((word, i) => {
    const spec = remoteSpec(word)
    if (spec === undefined) return
    // The last operand is the destination: a remote one receives your files.
    const r = request(name, spec, i === operands.length - 1 && operands.length > 1)
    if (r !== undefined) out.push({ ...r, raw: word })
  })
  return out
}

/** A git remote URL (https, ssh, git or scp-like); a path or a remote's name isn't one. */
function gitUrl(word: string): string | undefined {
  if (/^(https?|ssh|git|git\+ssh):\/\//i.test(word)) return word
  return remoteSpec(word)
}

function git(args: readonly string[]): Request[] {
  let i = 0
  while (args[i] !== undefined && args[i]!.startsWith('-')) i += args[i] === '-C' || args[i] === '-c' ? 2 : 1
  const sub = args[i]
  const rest = args.slice(i + 1).filter(a => !a.startsWith('-'))
  const make = (word: string | undefined, tool: string, isUpload: boolean): Request[] => {
    const url = word === undefined ? undefined : gitUrl(word)
    const r = url === undefined ? undefined : request(tool, url, isUpload)
    return r === undefined ? [] : [{ ...r, raw: word! }]
  }
  switch (sub) {
    case 'clone':
      return make(rest[0], 'git clone', false)
    case 'fetch':
    case 'pull':
    case 'ls-remote':
      return make(rest[0], `git ${sub}`, false)
    case 'push':
      return make(rest[0], 'git push', true)
    case 'remote':
      // A remote added now is pushed to later by name, which this can't follow, so check it here.
      if (rest[0] === 'add') return make(rest[2], 'git remote add', true)
      if (rest[0] === 'set-url') return make(rest[rest.length - 1], 'git remote set-url', true)
      return []
    case 'submodule':
      return rest[0] === 'add' ? make(rest[1], 'git submodule add', false) : []
    default:
      return []
  }
}

const INLINE_CODE: Record<string, readonly string[]> = {
  python: ['-c'], python3: ['-c'], node: ['-e', '--eval', '-p', '--print'], bun: ['-e', '--eval'],
  ruby: ['-e'], perl: ['-e', '-E'], php: ['-r'], deno: ['eval'],
}

/** Best effort: URL literals in `python -c`, `node -e` and friends. */
function inlineCode(name: string, args: readonly string[]): Request[] {
  const flags = INLINE_CODE[name.replace(/\d+(\.\d+)*$/, '') === 'python' ? 'python' : name]
  if (flags === undefined) return []
  const at = args.findIndex(a => flags.includes(a))
  const code = at >= 0 ? args[at + 1] : undefined
  if (code === undefined) return []
  const isUpload = /\.(post|put|patch)\s*\(|method\s*[:=]\s*['"](POST|PUT|PATCH|DELETE)|\bdata\s*=|\bbody\s*:|urlopen\([^)]*,\s*\w/i.test(code)
  const urls = code.match(/\b(?:https?|wss?):\/\/[^\s'"`)\]}>,]+/gi) ?? []
  const out = urls.map(url => request(`${name} code`, url, isUpload)).filter((r): r is Request => r !== undefined)
  if (out.length === 0 && /\b(requests|urllib|httpx|aiohttp|fetch|axios|http\.request|socket)\b/.test(code) && /\b(get|post|put|urlopen|fetch|request|connect)\s*\(/.test(code)) {
    out.push({ tool: `${name} code`, target: null, isUpload, raw: 'a URL the code builds' })
  }
  return out
}

/** Every network request one Bash command line would make, as far as its words say. */
export function requestsIn(line: string): Request[] {
  const out: Request[] = []
  for (const argv of commandsIn(line)) {
    const name = argv[0]!.split('/').pop() ?? ''
    const args = argv.slice(1)
    if (name === 'curl') out.push(...curl(args))
    else if (name === 'wget' || name === 'wget2') out.push(...wget(args))
    else if (['http', 'https', 'xh', 'xhs'].includes(name)) out.push(...httpie(name, args))
    else if (['nc', 'ncat', 'netcat', 'telnet'].includes(name)) out.push(...netcat(name, args))
    else if (name === 'ssh' || name === 'mosh') out.push(...ssh(args))
    else if (name === 'sftp' || name === 'ftp') {
      const host = args.filter(a => !a.startsWith('-')).pop()
      const r = host === undefined ? undefined : request(name, host.includes('://') ? host : `ssh://${host}`, true)
      if (r !== undefined) out.push(r)
    } else if (name === 'scp' || name === 'rsync') out.push(...copy(name, args))
    else if (name === 'git') out.push(...git(args))
    else out.push(...inlineCode(name, args))
  }
  return out
}

/** The request a WebFetch makes. */
export function fetchRequest(url: string): Request[] {
  const target = parseTarget(url)
  return target === undefined ? [] : [{ tool: 'WebFetch', target, isUpload: false, raw: url }]
}

/**
 * Whether a URL's path or query looks like it carries data out: a long
 * opaque token (base64 with upper, lower and digits, or 40+ hex), not a slug.
 */
export function carriesData(target: Target): boolean {
  return target.path.split(/[/?&=#;,]/).some(chunk => {
    if (chunk.length < 32) return false
    if (/^[0-9a-f]{40,}$/i.test(chunk)) return true
    const classes = [/[a-z]/, /[A-Z]/, /\d/].filter(re => re.test(chunk)).length
    return /^[A-Za-z0-9+/=_%.~-]+$/.test(chunk) && classes === 3 && !/^([A-Za-z]+-){3,}/.test(chunk)
  })
}
