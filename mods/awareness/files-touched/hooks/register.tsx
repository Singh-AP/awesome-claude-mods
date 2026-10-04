import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import {
  MAX_PATHS,
  buildSnapshot,
  compareSnapshots,
  countLines,
  hashablePaths,
  lineDelta,
  parseHashes,
  parseNumstat,
  parseRepo,
  parseStatus,
  shownPath,
  type Snapshot,
} from './bash'
import { TRACKED, bandLine, byRecent, changeOf, delta, listText, mention, merge, relativeTo, tableText, totals, type Change } from './changes'

const PANE = 'files-touched'
const TITLE = 'Files touched'

// $.state, so /clear, /resume and /branch start the list over.
const files = atom({ plugin: 'files-touched', key: 'files' } as const, [])

// What a Bash command changed is read off git: the dirty tree before and after it.
type Repo = { root: string; top: string; prefix: string }
let repoFor: { root: string; repo: Repo | null } | undefined
// The tree as of the last look; dropped when a file tool or the person may have changed it since.
let lastTree: Snapshot | undefined
// Line counts of untracked files as last seen, for the delta of the next change to them.
const untrackedLines = new Map<string, number>()
const GIT_TIMEOUT_MS = 3000

async function remember($: EngineInterface, tool: string, input: Record<string, unknown>, result: unknown) {
  const change = changeOf(tool, input, result)
  if (change === undefined) return
  const root = await $.session.root()
  const now = await $.clock.now()
  await update($, files, list => merge(list, { ...change, path: relativeTo(change.path, root) }, now))
  if (tool === 'Write' && typeof input.content === 'string' && repoFor?.repo) {
    const top = repoFor.repo.top.replace(/\/+$/, '')
    if (change.path.startsWith(`${top}/`)) untrackedLines.set(change.path.slice(top.length + 1), countLines(input.content))
  }
}

/** Runs one git command in the repo's top folder; undefined when it fails, times out or isn't there. */
async function runGit($: EngineInterface, cwd: string, argv: readonly string[], stdin?: string): Promise<string | undefined> {
  try {
    const out = await $.process.run(['git', '--no-optional-locks', ...argv], {
      cwd,
      timeoutMs: GIT_TIMEOUT_MS,
      ...(stdin === undefined ? {} : { stdin }),
    })
    return out.exitCode === 0 && !out.isStdoutTruncated ? out.stdout : undefined
  } catch {
    return undefined
  }
}

/** The git repo the session's root is in, looked up once per root; null outside one. */
async function findRepo($: EngineInterface): Promise<Repo | null> {
  const root = await $.session.root()
  if (repoFor?.root === root) return repoFor.repo
  const out = await runGit($, root, ['rev-parse', '--show-toplevel', '--show-prefix'])
  const found = out === undefined ? null : parseRepo(out)
  repoFor = { root, repo: found === null ? null : { root, ...found } }
  return repoFor.repo
}

async function takeSnapshot($: EngineInterface, where: Repo): Promise<Snapshot | undefined> {
  const raw = await runGit($, where.top, ['status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all'])
  if (raw === undefined) return undefined
  const status = parseStatus(raw)
  const paths = hashablePaths(status)
  const hashed = paths.length === 0 ? '' : await runGit($, where.top, ['hash-object', '--stdin-paths'], `${paths.join('\n')}\n`)
  const numstat = status.head === null || status.entries.size === 0 ? '' : await runGit($, where.top, ['diff', '--numstat', '-z', 'HEAD', '--'])
  return buildSnapshot(status, hashed === undefined ? undefined : parseHashes(paths, hashed), parseNumstat(numstat ?? ''))
}

/** Lines of an untracked file now, read from disk; 0 when it can't be read. */
async function linesNow($: EngineInterface, where: Repo, path: string): Promise<number> {
  try {
    const text = await $.fs.read(`${where.top.replace(/\/+$/, '')}/${path}`)
    return countLines(typeof text === 'string' ? text : '')
  } catch {
    return 0
  }
}

/** What the Bash command between `before` and `after` changed, as ledger changes. */
async function bashChanges($: EngineInterface, where: Repo, before: Snapshot, after: Snapshot): Promise<Change[]> {
  const differences = compareSnapshots(before, after)
  const out: Change[] = []
  const isHeadMoved = before.head !== after.head

  // A path that went clean was either committed or staged as it was (same content: not this
  // command's edit), reverted (different content), or, untracked, deleted.
  const cleaned = differences.filter(d => d.kind === 'cleaned').map(d => d.path)
  const stillThere: string[] = []
  for (const path of cleaned) {
    const then = before.entries.get(path)!
    if (then.untracked && !(await $.fs.exists(`${where.top.replace(/\/+$/, '')}/${path}`))) {
      out.push({ path, added: 0, removed: untrackedLines.get(path) ?? 0, created: false, bash: true, deleted: true })
      untrackedLines.delete(path)
    } else if (!then.untracked) {
      stillThere.push(path)
    }
  }
  if (stillThere.length > 0) {
    const hashed = await runGit($, where.top, ['hash-object', '--stdin-paths'], `${stillThere.join('\n')}\n`)
    const now = hashed === undefined ? undefined : parseHashes(stillThere, hashed)
    for (const path of stillThere) {
      const then = before.entries.get(path)!
      if (now === undefined || now.get(path) === then.hash) continue
      // Back to HEAD's content: the lines it had added are gone, the ones it had removed are back.
      out.push({ path, added: isHeadMoved ? 0 : then.removed, removed: isHeadMoved ? 0 : then.added, created: false, bash: true })
    }
  }

  for (const { path, kind } of differences) {
    if (kind === 'cleaned') continue
    const now = after.entries.get(path)!
    const then = before.entries.get(path)
    if (now.untracked) {
      const lines = await linesNow($, where, path)
      // New: every line is added. Seen before: the change in length, when its old length is known.
      const known = then === undefined ? 0 : untrackedLines.get(path)
      untrackedLines.set(path, lines)
      const added = known === undefined ? 0 : Math.max(0, lines - known)
      const removed = known === undefined ? 0 : Math.max(0, known - lines)
      out.push({ path, added, removed, created: then === undefined, bash: true })
      continue
    }
    // Line counts against HEAD mean nothing across a checkout or reset.
    const counts = isHeadMoved ? { added: 0, removed: 0 } : lineDelta(then, now)
    out.push({ path, ...counts, created: false, bash: true, deleted: now.deleted })
  }

  return out.slice(0, MAX_PATHS)
}

/** The tree before a Bash command: the last look when nothing has touched it since, else a new one. */
async function treeBefore($: EngineInterface): Promise<{ where: Repo; tree: Snapshot } | undefined> {
  const where = await findRepo($)
  if (where === null) return undefined
  if (lastTree === undefined) lastTree = await takeSnapshot($, where)
  return lastTree === undefined ? undefined : { where, tree: lastTree }
}

async function afterBash($: EngineInterface, before: { where: Repo; tree: Snapshot }) {
  const after = await takeSnapshot($, before.where)
  lastTree = after
  if (after === undefined) return
  const changes = await bashChanges($, before.where, before.tree, after)
  if (changes.length === 0) return
  const now = await $.clock.now()
  await update($, files, list =>
    changes.reduce((acc, change) => merge(acc, { ...change, path: shownPath(change.path, before.where.top, before.where.prefix) }, now), list),
  )
}

async function copyList($: EngineInterface, surface?: Parameters<EngineInterface['ui']['copy']>[0]['surface']) {
  const list = await read($, files)
  if (list.length === 0) return 'No files changed yet this session.'
  const copied = await $.ui.copy(surface === undefined ? { text: listText(list) } : { text: listText(list), surface })
  return copied.isCopied
    ? `Copied ${list.length} path${list.length === 1 ? '' : 's'} to the clipboard.`
    : `Could not copy: ${copied.reason}.`
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'touched',
      description: 'Files Claude changed this session: /touched [pane|copy|clear]',
      argumentHint: '[pane|copy|clear]',
      immediate: true,
    })
    return next(e)
  })

  // Between turns the person may have edited files themselves: look again before the next command.
  on('turn.start', ($, e, next) => {
    lastTree = undefined
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    if (tool === 'Bash') {
      const before = await treeBefore($).catch(() => undefined)
      const ran = await next(e)
      // A command Bash ran read-only changed nothing: the last look still stands.
      if (before === undefined || ran.deny !== undefined || ran.isReadOnly === true) return ran
      await afterBash($, before).catch(() => {
        lastTree = undefined
      })
      return ran
    }

    const ran = await next(e)
    if (TRACKED.has(tool) && ran.deny === undefined && ran.isError !== true) {
      lastTree = undefined
      await remember($, tool, e as unknown as Record<string, unknown>, ran.result)
    }
    return ran
  })

  on('command.run', { command: 'touched' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'clear' || arg === 'reset') {
      await update($, files, () => [])
      return { text: 'Cleared the list of touched files.' }
    }
    if (arg === 'copy') return { text: await copyList($) }
    if (arg === 'pane' || arg === 'open') {
      const opened = await $.ui.open({ id: PANE, title: TITLE })
      return opened.isPlaced ? {} : { text: `The pane is waiting for room: ${opened.reason}.` }
    }
    if (arg === 'close') {
      await $.ui.close({ id: PANE })
      return {}
    }
    return { text: tableText(await read($, files)) }
  })

  if (options.band !== false) {
    on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
      if (e.props.hasSurvey) return next(e)
      const list = await read($, files)
      if (list.length === 0) return next(e)

      const { Box, Text } = $.ui.resolve(e)
      const theirs = await next(e)
      return (
        <Box flexDirection="column">
          <Text dimColor wrap="truncate-end">
            {bandLine(list, Math.max(10, e.props.bodyColumns))}
          </Text>
          {theirs}
        </Box>
      )
    })
  }

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const list = byRecent(await read($, files))
    const sum = totals(list)
    const width = Math.max(20, e.props.bodyColumns)

    return (
      <Box flexDirection="column">
        <Text bold wrap="truncate-end">
          {list.length === 0
            ? 'No files changed yet.'
            : `${list.length} file${list.length === 1 ? '' : 's'} · +${sum.added} −${sum.removed} · press one to @mention it`}
        </Text>
        <Box flexDirection="row" columnGap={1}>
          <Button key="copy" label="Copy paths" hotkey="y" onPress={press => copyList($, press.surface).then(text => $.ui.toast(text))} />
          <Button key="clear" label="Clear" hotkey="c" onPress={() => update($, files, () => [])} />
          <Button key="close" label="Close" hotkey="x" role="dismiss" onPress={() => $.ui.close({ id: PANE })} />
        </Box>
        {list.map((file, i) => {
          const tag = `${file.created ? 'new ' : ''}${delta(file)}`
          const room = Math.max(4, width - tag.length - 6)
          const shown = file.path.length > room ? `…${file.path.slice(-(room - 1))}` : file.path
          return (
            <Box key={`row:${file.path}`} flexDirection="row" columnGap={1}>
              <Button
                key={`file:${file.path}`}
                label={shown}
                plain
                {...(i < 9 ? { hotkey: String(i + 1) } : {})}
                onPress={() => $.prompt.fill({ text: mention(file.path), mode: 'insert' })}
              />
              <Text color={file.created ? 'green' : undefined} dimColor={!file.created}>
                {tag}
              </Text>
            </Box>
          )
        })}
      </Box>
    )
  })
}
