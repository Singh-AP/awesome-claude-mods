import type { EngineInterface, Register } from 'claude-code'

import { parseInstalls, type Ecosystem, type Install } from './parse'
import { isPopular, judge, REGISTRY_NAMES, urlsFor, weeklyFrom, type Answer, type Limits, type Verdict } from './verdict'

const INSTALL = 'Install anyway'
const STOP = 'Block it'
const HEADERS = { 'User-Agent': 'slopsquat-guard (https://github.com/Singh-AP/awesome-claude-mods)', Accept: 'application/json' }
const HOUR = 60 * 60 * 1000
const MAX_CHECKS = 12

type Cached = { verdict: Verdict; at: number }
type Cache = Record<string, Cached>

// Registries already reported unreachable this session, so the toast comes once.
const unreachable = new Set<string>()
let blocked = 0

/** One request, given up after `ms`: undefined for no answer, whatever the reason. */
async function ask($: EngineInterface, url: string, method: 'GET' | 'HEAD', ms: number): Promise<Answer> {
  try {
    const answer = await Promise.race([
      $.http.fetch(url, { method, headers: HEADERS }),
      $.clock.sleep(ms).then(() => undefined),
    ])
    return answer === undefined ? undefined : { status: answer.status, text: answer.text }
  } catch {
    return undefined
  }
}

/** Asks the package's registry about it: existence and downloads first, metadata only when they leave doubt. */
async function inspect($: EngineInterface, ecosystem: Ecosystem, name: string, limits: Limits, ms: number): Promise<Verdict> {
  const urls = urlsFor(ecosystem, name)
  const now = await $.clock.now()
  if (urls.downloads === undefined) {
    const meta = await ask($, urls.meta, 'GET', ms)
    return judge(ecosystem, name, { exists: meta, meta }, now, limits)
  }
  // npm's full metadata for a popular package runs to megabytes: HEAD it first.
  const [exists, downloads] = await Promise.all([ask($, urls.meta, 'HEAD', ms), ask($, urls.downloads, 'GET', ms)])
  if (exists === undefined || exists.status !== 200 || isPopular(weeklyFrom(ecosystem, downloads))) {
    return judge(ecosystem, name, { exists, downloads }, now, limits)
  }
  const meta = await ask($, urls.meta, 'GET', ms)
  return judge(ecosystem, name, { exists, meta, downloads }, now, limits)
}

/** Verdicts for every install, from the cache where it is fresh. */
async function verdicts($: EngineInterface, installs: Install[], limits: Limits, ms: number): Promise<Verdict[]> {
  const cache = ((await $.store.get('cache')) ?? {}) as Cache
  const now = await $.clock.now()
  const fresh = (hit: Cached | undefined) =>
    hit !== undefined && now - hit.at < (hit.verdict.status === 'missing' ? HOUR : 24 * HOUR)

  let isChanged = false
  const out = await Promise.all(
    installs.map(async install => {
      const key = `${install.ecosystem}:${install.name}`
      const hit = cache[key]
      if (hit !== undefined && fresh(hit)) return hit.verdict
      const verdict = await inspect($, install.ecosystem, install.name, limits, ms)
      if (verdict.status !== 'unknown') {
        cache[key] = { verdict, at: now }
        isChanged = true
      }
      return verdict
    }),
  )
  if (isChanged) {
    // Keep the newest 400 verdicts from the last week.
    const kept = Object.entries(cache)
      .filter(([, v]) => now - v.at < 7 * 24 * HOUR)
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, 400)
    await $.store.set('cache', Object.fromEntries(kept))
  }
  return out
}

async function refuse($: EngineInterface, text: string) {
  blocked += 1
  const total = Number((await $.store.get('blockedTotal')) ?? 0) + 1
  await $.store.set('blockedTotal', total)
  return { deny: text }
}

const describe = (install: Install, verdict: Verdict) =>
  `${install.name} (${REGISTRY_NAMES[install.ecosystem]}): ${verdict.reasons.join('; ')}`

const ECOSYSTEMS: Record<string, Ecosystem> = {
  npm: 'npm', node: 'npm', js: 'npm', yarn: 'npm', pnpm: 'npm', bun: 'npm',
  pypi: 'pypi', pip: 'pypi', python: 'pypi', py: 'pypi', uv: 'pypi',
  crates: 'crates', cargo: 'crates', rust: 'crates', crate: 'crates',
  gem: 'rubygems', gems: 'rubygems', rubygems: 'rubygems', ruby: 'rubygems',
}

export const register: Register = (on, options) => {
  const limits: Limits = {
    minAgeDays: Number(options.minAgeDays ?? 14),
    minWeeklyDownloads: Number(options.minWeeklyDownloads ?? 50),
  }
  const ms = Number(options.timeoutMs ?? 5000)
  const allowed = new Set(
    String(options.allowList ?? '')
      .split(/[\s,]+/)
      .map(name => name.trim().toLowerCase())
      .filter(name => name !== ''),
  )

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'slopsquat',
      description: 'Check a package before installing it: /slopsquat <npm|pypi|crates|gem> <name>',
      argumentHint: '<ecosystem> <name>',
    })
    return next(e)
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const { installs } = parseInstalls(e.command)
    const todo: Install[] = []
    for (const install of installs) {
      if (allowed.has(install.name)) continue
      // `npx tsc` runs the project's own binary when it has one.
      const bin = install.name.replace(/^@[^/]+\//, '')
      if (install.isRun && install.ecosystem === 'npm' && (await $.fs.exists(`node_modules/.bin/${bin}`))) continue
      todo.push(install)
    }
    if (todo.length === 0) return next(e)

    const checked = todo.slice(0, MAX_CHECKS)
    const results = await verdicts($, checked, limits, ms)
    const pairs = checked.map((install, i) => ({ install, verdict: results[i]! }))

    const missing = pairs.filter(p => p.verdict.status === 'missing')
    if (missing.length > 0) {
      const names = missing.map(p => `"${p.install.name}" (${REGISTRY_NAMES[p.install.ecosystem]})`).join(', ')
      $.ui.toast(`slopsquat-guard blocked ${names}: no such package`)
      return refuse(
        $,
        `slopsquat-guard blocked this install: ${missing.map(p => describe(p.install, p.verdict)).join('; ')}. ` +
          'The name may be hallucinated, and attackers register hallucinated names ("slopsquatting"). ' +
          'Do not guess another spelling: find the real package name in the project docs or the registry, or ask the user.',
      )
    }

    for (const { install, verdict } of pairs) {
      if (verdict.status !== 'unknown') continue
      const registry = REGISTRY_NAMES[install.ecosystem]
      if (unreachable.has(registry)) continue
      unreachable.add(registry)
      $.ui.toast(`slopsquat-guard could not reach ${registry}, so ${install.name} was not checked`)
    }

    const odd = pairs.filter(p => p.verdict.status === 'suspicious')
    if (odd.length === 0) return next(e)

    const lines = odd.map(p => `  • ${describe(p.install, p.verdict)}`).join('\n')
    let answer = STOP
    try {
      answer = await $.ui.ask(`slopsquat-guard: these packages look risky:\n${lines}\n\nInstall anyway?`, {
        header: 'slopsquat',
        options: [INSTALL, STOP],
      })
    } catch {
      // Nobody to ask (a -p run) or the dialog was dismissed: stay safe.
    }
    if (answer === INSTALL) return next(e)
    return refuse(
      $,
      `slopsquat-guard blocked this install after a risk check: ${odd.map(p => describe(p.install, p.verdict)).join('; ')}. ` +
        'Tell the user which package you meant and why, and let them decide.',
    )
  })

  on('command.run', { command: 'slopsquat' }, async ($, e) => {
    const [kind, name] = e.args.trim().split(/\s+/)
    const ecosystem = kind === undefined ? undefined : ECOSYSTEMS[kind.toLowerCase()]
    if (ecosystem === undefined || name === undefined || name === '') {
      const total = Number((await $.store.get('blockedTotal')) ?? 0)
      return {
        text:
          'Usage: /slopsquat <npm|pypi|crates|gem> <name>\n' +
          `slopsquat-guard has blocked ${blocked} install${blocked === 1 ? '' : 's'} this session, ${total} all time.`,
      }
    }
    const verdict = await inspect($, ecosystem, name.toLowerCase(), limits, ms)
    const registry = REGISTRY_NAMES[ecosystem]
    const facts = [
      verdict.createdAt === undefined ? undefined : `first published ${verdict.createdAt.slice(0, 10)}`,
      verdict.weeklyDownloads === undefined ? undefined : `${verdict.weeklyDownloads.toLocaleString('en-US')} downloads a week`,
    ].filter(Boolean).join(', ')
    const head = {
      ok: `OK: ${name} exists on ${registry}`,
      suspicious: `RISKY: ${name} on ${registry}: ${verdict.reasons.join('; ')}`,
      missing: `MISSING: ${verdict.reasons.join('; ')}`,
      unknown: `UNKNOWN: ${verdict.reasons.join('; ')}`,
    }[verdict.status]
    return { text: facts === '' ? head : `${head} (${facts})` }
  })
}
