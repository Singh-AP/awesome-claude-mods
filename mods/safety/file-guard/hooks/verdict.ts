// What file-guard decides for one resolved path. Pure: no `$`.

import { isGitInternal, isInside, protectedBy, relative } from './paths'

export type Access = 'read' | 'write'

export type Fence = {
  /** The project root, every link resolved. */
  root: string
  /** Other places writes may go (extra roots, temp, Claude's own folders), resolved. */
  allowed: readonly string[]
  /** Globs inside the project that ask before a write; `!glob` exempts. */
  protect: readonly string[]
  /** Deny reads outside the fence too. */
  fenceReads: boolean
}

export type Verdict =
  | { kind: 'allow' }
  | { kind: 'block'; rule: 'unplaceable' | 'git' | 'outside'; why: string }
  | { kind: 'confirm'; rule: 'protected'; pattern: string; why: string }

/** `~/x` for a path under `home`, else the path. */
export function display(path: string, home: string | undefined): string {
  if (home !== undefined && home !== '/' && isInside(path, home)) return path === home ? '~' : `~/${relative(path, home)}`
  return path
}

export function judge(real: string | undefined, access: Access, fence: Fence, home?: string): Verdict {
  if (real === undefined) {
    if (access === 'read' && !fence.fenceReads) return { kind: 'allow' }
    return { kind: 'block', rule: 'unplaceable', why: 'file-guard cannot tell where this path really lands (a dangling link or an unusual spelling)' }
  }
  if (access === 'write' && isGitInternal(real)) {
    return { kind: 'block', rule: 'git', why: `${display(real, home)} is inside git's own .git folder, which file-guard never lets a tool write` }
  }
  if (isInside(real, fence.root)) {
    if (access === 'read') return { kind: 'allow' }
    const pattern = protectedBy(relative(real, fence.root), fence.protect)
    if (pattern === undefined) return { kind: 'allow' }
    return { kind: 'confirm', rule: 'protected', pattern, why: `${relative(real, fence.root)} is protected (matches ${pattern})` }
  }
  if (fence.allowed.some(dir => isInside(real, dir))) return { kind: 'allow' }
  if (access === 'read' && !fence.fenceReads) return { kind: 'allow' }
  return {
    kind: 'block',
    rule: 'outside',
    why: `${display(real, home)} is outside this project (${display(fence.root, home)})`,
  }
}

/** The text the model reads when a call is refused: what happened and what to do instead. */
export function denyText(verdict: Exclude<Verdict, { kind: 'allow' }>, access: Access): string {
  const verb = access === 'read' ? 'read' : 'change'
  switch (verdict.rule) {
    case 'outside':
      return (
        `file-guard refused to ${verb} this file: ${verdict.why}. ` +
        'Keep your work inside the project. If this file really has to be touched, tell the user why and let them do it, ' +
        "or ask them to add the folder to file-guard's extraRoots option."
      )
    case 'git':
      return `file-guard refused: ${verdict.why}. Use git commands instead of editing .git directly.`
    case 'unplaceable':
      return `file-guard refused to ${verb} this file: ${verdict.why}. Use a plain absolute path inside the project.`
    case 'protected':
      return `file-guard: changing this file needs the user's OK, because ${verdict.why}, and they didn't give it. Don't retry; ask the user how they want this file changed.`
  }
}
