// Hosts and host patterns: no `$`, pure.

export type Target = { host: string; path: string }

const NETWORK_SCHEMES = /^(https?|ftps?|wss?|ssh|git|git\+ssh|ssh\+git|rsync|sftp|scp|telnet|ldaps?|gopher|dict|smtps?|imaps?|pop3s?|mqtts?|redis|rediss)$/i

/**
 * Where a URL-ish target goes: its host (lowercased, no port, no brackets)
 * and path. `null` when the host is only known at run time (`$HOST`), and
 * `undefined` when it isn't a network target at all (a file path, `file://`).
 */
export function parseTarget(raw: string): Target | null | undefined {
  const target = raw.trim().replace(/^['"]|['"]$/g, '')
  if (target === '' || target.startsWith('-') || target.startsWith('@')) return undefined
  const scheme = target.match(/^([a-z][a-z0-9+.-]*):\/\//i)
  if (scheme !== null && !NETWORK_SCHEMES.test(scheme[1]!)) return undefined
  if (scheme === null && (target.startsWith('/') || target.startsWith('./') || target.startsWith('../') || target.startsWith('~'))) return undefined

  const rest = scheme === null ? target : target.slice(scheme[0].length)
  const cut = rest.search(/[/?#]/)
  const authority = cut < 0 ? rest : rest.slice(0, cut)
  const path = cut < 0 ? '/' : rest.slice(cut)
  const hostPort = authority.includes('@') ? authority.slice(authority.lastIndexOf('@') + 1) : authority

  if (/[$`]/.test(hostPort) || hostPort.includes('{{')) return null
  let host: string
  if (hostPort.startsWith('[')) {
    const end = hostPort.indexOf(']')
    host = end < 0 ? '' : hostPort.slice(1, end)
  } else {
    host = hostPort.replace(/:\d*$/, '')
  }
  host = host.toLowerCase().replace(/\.$/, '')
  if (host === '') return undefined
  const isName = /^[a-z0-9_]([a-z0-9_-]*[a-z0-9_])?(\.[a-z0-9_]([a-z0-9_-]*[a-z0-9_])?)*$/.test(host)
  const isIpv6 = host.includes(':') && /^[0-9a-f:.]+$/.test(host)
  if (!isName && !isIpv6) return undefined

  return { host, path }
}

function ipv4(host: string): number[] | undefined {
  const parts = host.split('.')
  if (parts.length !== 4 || !parts.every(p => /^\d{1,3}$/.test(p) && Number(p) <= 255)) return undefined
  return parts.map(Number)
}

/** This machine: never worth asking about. */
export function isLocal(host: string): boolean {
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1' || host === '0.0.0.0' || host === '::') return true
  if (host.startsWith('::ffff:')) return isLocal(host.slice(7))
  return ipv4(host)?.[0] === 127
}

/** A private network: LAN ranges and local-only names. Cloud metadata (169.254.x) is not one. */
export function isPrivate(host: string): boolean {
  const v4 = ipv4(host)
  if (v4 !== undefined) {
    const [a, b] = v4 as [number, number, number, number]
    return a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 100 && b >= 64 && b <= 127)
  }
  if (host.includes(':')) return /^f[cd][0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host)
  return /\.(local|internal|lan|home\.arpa)$/.test(host) || host === 'host.docker.internal'
}

/**
 * Whether `target` matches `pattern`. `example.com` covers the domain and
 * every subdomain, `*.example.com` only the subdomains, `*` everything, and
 * `example.com/hooks` only paths under `/hooks` there.
 */
export function matches(target: Target, pattern: string): boolean {
  const slash = pattern.indexOf('/')
  const hostPattern = slash < 0 ? pattern : pattern.slice(0, slash)
  const pathPrefix = slash < 0 ? '' : pattern.slice(slash)
  if (pathPrefix !== '' && !target.path.toLowerCase().startsWith(pathPrefix)) return false
  if (hostPattern === '*') return true
  if (hostPattern.startsWith('*.')) return target.host.endsWith(hostPattern.slice(1))
  return target.host === hostPattern || target.host.endsWith(`.${hostPattern}`)
}

/** `a.com, *.b.com\nhttps://c.com/x` → normalised patterns. */
export function parseList(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map(item => item.trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/\/$/, ''))
    .filter(item => item !== '' && item !== '/')
}

/** Where the person's code and packages live: fetching from these is everyday work. */
export const DEFAULT_ALLOW = [
  'github.com', 'githubusercontent.com', 'githubassets.com', 'gitlab.com', 'bitbucket.org',
  'npmjs.org', 'npmjs.com', 'yarnpkg.com', 'pypi.org', 'pythonhosted.org', 'crates.io',
  'rubygems.org', 'proxy.golang.org', 'sum.golang.org', 'pkg.go.dev', 'go.dev',
  'docs.python.org', 'developer.mozilla.org', 'nodejs.org', 'stackoverflow.com',
  'stackexchange.com', 'docs.anthropic.com', 'code.claude.com', 'wikipedia.org',
]

/** Paste sites, request catchers and tunnels: where stolen data usually goes. */
export const DEFAULT_DENY = [
  'pastebin.com', 'paste.ee', 'hastebin.com', 'ghostbin.com', 'dpaste.com', 'dpaste.org',
  'transfer.sh', 'file.io', '0x0.st', 'termbin.com', 'bashupload.com', 'temp.sh', 'oshi.at',
  'anonfiles.com', 'gofile.io', 'webhook.site', 'requestbin.com', 'requestbin.net',
  'requestcatcher.com', 'm.pipedream.net', 'beeceptor.com', 'hookbin.com', 'postb.in',
  'ptsv2.com', 'ptsv3.com', 'ngrok.io', 'ngrok.app', 'ngrok-free.app', 'ngrok-free.dev',
  'trycloudflare.com', 'serveo.net', 'localtunnel.me', 'loca.lt', 'interact.sh', 'oast.fun',
  'oast.pro', 'oast.live', 'oast.site', 'oast.online', 'oast.me', 'burpcollaborator.net',
  'oastify.com', 'dnslog.cn', 'ceye.io', 'discord.com/api/webhooks', 'discordapp.com/api/webhooks',
  'api.telegram.org/bot',
]
