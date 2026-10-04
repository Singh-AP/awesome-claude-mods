// Pure parsing of `git status --porcelain=v2 --branch`: no `$`, so tests drive it directly.

export type GitState = {
  /** The commit HEAD points at; null before the first commit. */
  oid: string | null
  /** The branch; null when HEAD is detached. */
  branch: string | null
  upstream: string | null
  ahead: number
  behind: number
  staged: number
  modified: number
  untracked: number
  conflicts: number
}

export function parseStatus(text: string): GitState {
  const state: GitState = {
    oid: null,
    branch: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    staged: 0,
    modified: 0,
    untracked: 0,
    conflicts: 0,
  }

  for (const line of text.split('\n')) {
    if (line.startsWith('# branch.oid ')) {
      const oid = line.slice('# branch.oid '.length).trim()
      state.oid = oid === '(initial)' ? null : oid
    } else if (line.startsWith('# branch.head ')) {
      const head = line.slice('# branch.head '.length).trim()
      state.branch = head === '(detached)' ? null : head
    } else if (line.startsWith('# branch.upstream ')) {
      state.upstream = line.slice('# branch.upstream '.length).trim()
    } else if (line.startsWith('# branch.ab ')) {
      const match = /\+(\d+) -(\d+)/.exec(line)
      if (match !== null) {
        state.ahead = Number(match[1])
        state.behind = Number(match[2])
      }
    } else if (line.startsWith('1 ') || line.startsWith('2 ')) {
      const xy = line.slice(2, 4)
      if (xy[0] !== '.') state.staged++
      if (xy[1] !== '.') state.modified++
    } else if (line.startsWith('u ')) {
      state.conflicts++
    } else if (line.startsWith('? ')) {
      state.untracked++
    }
  }

  return state
}

export function isClean(state: GitState): boolean {
  return state.staged + state.modified + state.untracked + state.conflicts === 0
}

/** `main`, `@a1b2c3d` when detached, `main (no commits)` before the first. */
export function headName(state: GitState): string {
  if (state.branch !== null) return state.oid === null ? `${state.branch} (no commits)` : state.branch
  return state.oid === null ? '(no HEAD)' : `@${state.oid.slice(0, 7)}`
}

/** `⎇ main ↑2 ↓1 ●3 +1 ?2`, or `⎇ main ✓` when clean and in sync. */
export function statusLine(state: GitState): string {
  const parts = [`⎇ ${headName(state)}`]
  if (state.ahead > 0) parts.push(`↑${state.ahead}`)
  if (state.behind > 0) parts.push(`↓${state.behind}`)
  if (state.conflicts > 0) parts.push(`✖${state.conflicts}`)
  if (state.modified > 0) parts.push(`●${state.modified}`)
  if (state.staged > 0) parts.push(`+${state.staged}`)
  if (state.untracked > 0) parts.push(`?${state.untracked}`)
  if (parts.length === 1 && isClean(state)) parts.push('✓')
  return parts.join(' ')
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

/** The `/git-pulse` report. */
export function summary(state: GitState, log: string, stashes: number): string {
  const lines = [`Branch: ${headName(state)}`]
  if (state.upstream !== null) {
    const sync = state.ahead === 0 && state.behind === 0 ? 'in sync' : `${state.ahead} ahead, ${state.behind} behind`
    lines.push(`Upstream: ${state.upstream} (${sync})`)
  } else if (state.branch !== null) {
    lines.push('Upstream: none (not pushed yet)')
  }
  if (isClean(state)) {
    lines.push('Working tree: clean')
  } else {
    const counts = [
      state.conflicts > 0 ? plural(state.conflicts, 'conflict') : '',
      state.staged > 0 ? `${state.staged} staged` : '',
      state.modified > 0 ? `${state.modified} modified` : '',
      state.untracked > 0 ? `${state.untracked} untracked` : '',
    ].filter(Boolean)
    lines.push(`Working tree: ${counts.join(', ')}`)
  }
  if (stashes > 0) lines.push(`Stash: ${stashes} ${stashes === 1 ? 'entry' : 'entries'}`)
  const commits = log.trim()
  if (commits !== '') {
    lines.push('', 'Last commits:')
    for (const line of commits.split('\n')) lines.push(`  ${line}`)
  }
  return lines.join('\n')
}

export function commitsToast(count: number, state: GitState): string {
  return `${plural(count, 'new commit')} on ${headName(state)} this turn`
}
