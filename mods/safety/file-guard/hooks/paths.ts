// POSIX path helpers and a small glob matcher. Pure: no `$`.

/** Folds `.`, `..` and repeated slashes; keeps a path absolute if it was. */
export function normalize(path: string): string {
  const isAbsolute = path.startsWith('/')
  const out: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (out.length > 0 && out[out.length - 1] !== '..') out.pop()
      else if (!isAbsolute) out.push('..')
      continue
    }
    out.push(part)
  }
  const joined = out.join('/')
  return isAbsolute ? `/${joined}` : joined || '.'
}

export function join(...parts: string[]): string {
  return normalize(parts.filter(p => p !== '').join('/'))
}

export function dirname(path: string): string {
  const p = normalize(path)
  if (p === '/') return '/'
  const cut = p.lastIndexOf('/')
  if (cut < 0) return '.'
  return cut === 0 ? '/' : p.slice(0, cut)
}

export function basename(path: string): string {
  const p = normalize(path)
  return p === '/' ? '' : p.slice(p.lastIndexOf('/') + 1)
}

/** Whether `child` is `parent` or lies beneath it (both normalized, absolute). */
export function isInside(child: string, parent: string): boolean {
  if (parent === '/') return child.startsWith('/')
  return child === parent || child.startsWith(`${parent}/`)
}

/** `child` relative to `parent`, which must contain it. */
export function relative(child: string, parent: string): string {
  if (child === parent) return ''
  return parent === '/' ? child.slice(1) : child.slice(parent.length + 1)
}

/** `~` and `~/x` under `home`; an absolute path as is; anything else under `cwd`. */
export function resolveSpelling(path: string, home: string | undefined, cwd: string): string {
  const trimmed = path.trim()
  if ((trimmed === '~' || trimmed.startsWith('~/')) && home !== undefined) return join(home, trimmed.slice(1))
  return trimmed.startsWith('/') ? normalize(trimmed) : join(cwd, trimmed)
}

/** Splits a comma-separated option into trimmed, non-empty entries. */
export function parseList(value: string): string[] {
  return value
    .split(',')
    .map(item => item.trim())
    .filter(item => item !== '')
}

/** Whether any segment of the path is a `.git` directory (not `.github` or `.gitignore`). */
export function isGitInternal(path: string): boolean {
  return normalize(path).split('/').includes('.git')
}

/**
 * Turns a glob into an anchored regular expression: `**` crosses folders,
 * `*` and `?` stay inside one. A pattern without a slash matches the file name
 * at any depth, as in .gitignore.
 */
export function globToRegExp(glob: string): RegExp {
  let source = ''
  for (let i = 0; i < glob.length; ) {
    if (glob.startsWith('**/', i)) {
      source += '(?:.*/)?'
      i += 3
    } else if (glob.startsWith('/**', i) && i + 3 === glob.length) {
      source += '(?:/.*)?'
      i += 3
    } else if (glob.startsWith('**', i)) {
      source += '.*'
      i += 2
    } else {
      const ch = glob[i]!
      source += ch === '*' ? '[^/]*' : ch === '?' ? '[^/]' : ch.replace(/[.+^${}()|[\]\\]/g, '\\$&')
      i += 1
    }
  }
  return new RegExp(`^${source}$`)
}

export function matchesGlob(relativePath: string, glob: string): boolean {
  const pattern = glob.replace(/^\.\//, '')
  const target = pattern.includes('/') ? relativePath : basename(relativePath)
  return globToRegExp(pattern).test(target)
}

/**
 * The first positive pattern that matches, unless a `!pattern` also does.
 * Undefined when the path is not protected.
 */
export function protectedBy(relativePath: string, patterns: readonly string[]): string | undefined {
  const isExcluded = patterns.some(p => p.startsWith('!') && matchesGlob(relativePath, p.slice(1)))
  if (isExcluded) return undefined
  return patterns.find(p => !p.startsWith('!') && matchesGlob(relativePath, p))
}
