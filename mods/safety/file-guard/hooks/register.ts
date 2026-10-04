import type { EngineInterface, Register } from 'claude-code'

import { basename, dirname, join, normalize, parseList, relative, resolveSpelling } from './paths'
import { denyText, display, judge, type Access, type Fence, type Verdict } from './verdict'

export const DEFAULT_PROTECT =
  '.github/workflows/**, **/migrations/**, **/*.lock, package-lock.json, pnpm-lock.yaml, yarn.lock, Cargo.lock, ' +
  'poetry.lock, **/.env*, !**/.env.example, !**/.env.sample, !**/.env.template, **/*.pem, **/id_rsa*, .git/**'

// Claude Code's own folders it writes on purpose: memory, plans, todos, mods made in a session.
const CLAUDE_DIRS = ['~/.claude/projects', '~/.claude/plans', '~/.claude/todos', '~/.claude/dev-mods']
const TEMP_DIRS = ['/tmp', '/private/tmp', '/var/tmp']

const ONCE = 'Allow once'
const SESSION = 'Allow this file for the session'
const BLOCK = 'Block it'

const ACCESS: Record<string, Access> = {
  Read: 'read',
  Edit: 'write',
  MultiEdit: 'write',
  Write: 'write',
  NotebookEdit: 'write',
}

type Config = {
  extraRoots: string[]
  allowTemp: boolean
  allowClaudeDirs: boolean
  protect: string[]
  fenceReads: boolean
}

// Session tallies and caches; a reload starts them over.
let blockedCount = 0
let confirmedCount = 0
const allowedThisSession = new Set<string>()
const placedCache = new Map<string, string | undefined>()

/** The path a tool argument names, if it names one. */
function targetOf(input: unknown): string | undefined {
  const record = input as Record<string, unknown>
  const path = record.file_path ?? record.notebook_path
  return typeof path === 'string' && path !== '' ? path : undefined
}

/**
 * Where an absolute path really lands, every link resolved, even when the file
 * (or its folders) does not exist yet: the nearest existing ancestor is
 * resolved and the rest appended. Undefined when it leads nowhere.
 */
async function placeReal($: EngineInterface, absolute: string): Promise<string | undefined> {
  let probe = normalize(absolute)
  const rest: string[] = []
  for (let depth = 0; depth < 128; depth++) {
    const stat = await $.fs.stat(probe, { resolve: true }).catch(() => undefined)
    if (stat !== undefined) {
      if (stat.realPath === undefined) return undefined
      return rest.length === 0 ? normalize(stat.realPath) : join(stat.realPath, ...rest.reverse())
    }
    if (probe === '/') return undefined
    rest.push(basename(probe))
    probe = dirname(probe)
  }
  return undefined
}

async function placeCached($: EngineInterface, spelling: string): Promise<string | undefined> {
  if (placedCache.has(spelling)) return placedCache.get(spelling)
  const real = await placeReal($, spelling)
  placedCache.set(spelling, real)
  return real
}

async function buildFence($: EngineInterface, config: Config, home: string | undefined): Promise<Fence> {
  const cwd = await $.session.cwd()
  const root = (await placeCached($, normalize(await $.session.root()))) ?? normalize(await $.session.root())
  const spellings = [...config.extraRoots]
  if (config.allowTemp) {
    spellings.push(...TEMP_DIRS)
    const tmp = await $.env.get('TMPDIR')
    if (tmp !== undefined && tmp !== '') spellings.push(tmp)
  }
  if (config.allowClaudeDirs) spellings.push(...CLAUDE_DIRS)
  const allowed: string[] = []
  for (const spelling of spellings) {
    if (spelling.startsWith('~') && home === undefined) continue
    const real = await placeCached($, resolveSpelling(spelling, home, cwd))
    if (real !== undefined && real !== '/') allowed.push(real)
  }
  return { root, allowed, protect: config.protect, fenceReads: config.fenceReads }
}

async function refuseFileCall($: EngineInterface, verdict: Exclude<Verdict, { kind: 'allow' }>, access: Access, tool: string) {
  blockedCount += 1
  const total = Number((await $.store.get('blockedTotal')) ?? 0) + 1
  await $.store.set('blockedTotal', total)
  $.ui.toast(`file-guard blocked ${tool}: ${verdict.why}`)
  return { deny: denyText(verdict, access) }
}

export const register: Register = (on, options) => {
  const config: Config = {
    extraRoots: parseList(String(options.extraRoots ?? '')),
    allowTemp: options.allowTemp !== false,
    allowClaudeDirs: options.allowClaudeDirs !== false,
    protect: parseList(String(options.protect ?? DEFAULT_PROTECT)),
    fenceReads: options.fenceReads === true,
  }

  on('session.start', async ($, e, next) => {
    placedCache.clear()
    try {
      await $.command.register({
        name: 'file-guard',
        description: 'Show the fence and what file-guard blocked, or test a path: /file-guard check <path>',
        argumentHint: '[check <path>]',
      })
    } catch {
      // The guard works without its command.
    }
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    const access = ACCESS[tool]
    const spelled = access === undefined ? undefined : targetOf(e)
    if (access === undefined || spelled === undefined) return next(e)

    const home = await $.env.get('HOME')
    const absolute = resolveSpelling(spelled, home, await $.session.cwd())
    const real = await placeReal($, absolute)
    const fence = await buildFence($, config, home)
    const verdict = judge(real, access, fence, home)

    if (verdict.kind === 'allow') return next(e)
    if (verdict.kind === 'block') return refuseFileCall($, verdict, access, tool)

    if (real !== undefined && allowedThisSession.has(real)) return next(e)
    let answer = BLOCK
    try {
      answer = await $.ui.ask(`file-guard: ${verdict.why}.\n\n  ${tool} ${relative(real ?? absolute, fence.root)}\n\nAllow this change?`, {
        header: 'file-guard',
        options: [ONCE, SESSION, BLOCK],
      })
    } catch {
      // Nobody to ask (a -p run) or the dialog was dismissed: stay safe.
    }
    if (answer === ONCE || answer === SESSION) {
      confirmedCount += 1
      if (answer === SESSION && real !== undefined) allowedThisSession.add(real)
      return next(e)
    }
    return refuseFileCall($, verdict, access, tool)
  })

  on('command.run', { command: 'file-guard' }, async ($, e) => {
    const home = await $.env.get('HOME')
    const fence = await buildFence($, config, home)
    const [sub, ...rest] = e.args.trim().split(/\s+/)

    if (sub === 'check') {
      const spelled = rest.join(' ')
      if (spelled === '') return { text: 'Usage: /file-guard check <path>' }
      const absolute = resolveSpelling(spelled, home, await $.session.cwd())
      const real = await placeReal($, absolute)
      const write = judge(real, 'write', fence, home)
      const read = judge(real, 'read', fence, home)
      const shown = (v: Verdict) => (v.kind === 'allow' ? 'allowed' : v.kind === 'block' ? `blocked: ${v.why}` : `asks first: ${v.why}`)
      return {
        text: [
          `${display(absolute, home)}${real !== undefined && real !== absolute ? ` → ${display(real, home)}` : ''}`,
          `  write: ${shown(write)}`,
          `  read:  ${shown(read)}`,
        ].join('\n'),
      }
    }

    const total = Number((await $.store.get('blockedTotal')) ?? 0)
    const allowed = fence.allowed.map(dir => display(dir, home))
    return {
      text: [
        `Project: ${display(fence.root, home)}`,
        `Also writable: ${allowed.length > 0 ? allowed.join(', ') : 'nothing else'}`,
        `Reads outside the project: ${fence.fenceReads ? 'blocked' : 'allowed'}`,
        `Asks before changing: ${fence.protect.join(', ') || 'nothing'}`,
        `This session: ${blockedCount} blocked, ${confirmedCount} allowed after you confirmed. All time: ${total} blocked.`,
      ].join('\n'),
    }
  })
}
