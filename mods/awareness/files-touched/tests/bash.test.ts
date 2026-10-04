import { describe, expect, test } from 'claude-code/testing'

import {
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
} from '../hooks/bash'
import { merge, statusOf } from '../hooks/changes'

const H = (c: string) => c.repeat(40)
const OID = H('a')

describe('parseStatus', () => {
  test('reads the head, ordinary, renamed, untracked and deleted entries', () => {
    const out = parseStatus(
      [
        `# branch.oid ${OID}`,
        '# branch.head main',
        `1 .M N... 100644 100644 100644 ${H('1')} ${H('1')} src/a file.ts`,
        `2 R. N... 100644 100644 100644 ${H('2')} ${H('2')} R100 lib/new.ts`,
        'lib/old.ts',
        `1 .D N... 100644 100644 000000 ${H('3')} ${H('3')} gone.ts`,
        '? notes/todo.md',
        '? node_modules/x/index.js',
        '',
      ].join('\0'),
    )
    expect(out.head).toBe(OID)
    expect([...out.entries.keys()]).toEqual(['src/a file.ts', 'lib/new.ts', 'gone.ts', 'notes/todo.md'])
    expect(out.entries.get('src/a file.ts')).toEqual({ x: '.', y: 'M', untracked: false })
    expect(out.entries.get('notes/todo.md')).toEqual({ x: '?', y: '?', untracked: true })
  })

  test('a repo with no commits has no head', () => {
    expect(parseStatus('# branch.oid (initial)\0? a.txt\0').head).toBeNull()
  })
})

describe('parseNumstat', () => {
  test('reads counts, binary files and renames', () => {
    const out = parseNumstat(['3\t1\tsrc/a.ts', '-\t-\timg.png', '2\t0\t', 'old.ts', 'new.ts', ''].join('\0'))
    expect(out.get('src/a.ts')).toEqual({ added: 3, removed: 1 })
    expect(out.get('img.png')).toEqual({ added: 0, removed: 0 })
    expect(out.get('new.ts')).toEqual({ added: 2, removed: 0 })
    expect(out.has('old.ts')).toBe(false)
  })
})

test('parseHashes refuses output that does not line up', () => {
  expect(parseHashes(['a', 'b'], `${H('1')}\n${H('2')}\n`)?.get('b')).toBe(H('2'))
  expect(parseHashes(['a', 'b'], `${H('1')}\n`)).toBeUndefined()
  expect(parseHashes(['a'], 'fatal: could not open\n')).toBeUndefined()
})

test('hashablePaths leaves out deleted files', () => {
  const status = parseStatus(
    [`1 .M N... 100644 100644 100644 ${H('1')} ${H('1')} b.ts`, `1 .D N... 100644 100644 000000 ${H('1')} ${H('1')} a.ts`, '? c.md'].join('\0'),
  )
  expect(hashablePaths(status)).toEqual(['b.ts', 'c.md'])
})

const snap = (head: string | null, entries: Record<string, Partial<Snapshot['entries'] extends Map<string, infer E> ? E : never>>): Snapshot => ({
  head,
  entries: new Map(
    Object.entries(entries).map(([path, e]) => [
      path,
      { hash: 'h', untracked: false, deleted: false, isIndexOnly: false, added: 0, removed: 0, ...e },
    ]),
  ),
})

describe('compareSnapshots', () => {
  test('finds new, changed and cleaned paths, and ignores unchanged ones', () => {
    const before = snap(OID, { 'same.ts': { hash: 's' }, 'edited.ts': { hash: 'x' }, 'committed.ts': { hash: 'c' } })
    const after = snap(OID, { 'same.ts': { hash: 's' }, 'edited.ts': { hash: 'y' }, 'new.md': { untracked: true } })
    expect(compareSnapshots(before, after)).toEqual([
      { path: 'edited.ts', kind: 'changed' },
      { path: 'new.md', kind: 'new' },
      { path: 'committed.ts', kind: 'cleaned' },
    ])
  })

  test('a file only staged while HEAD moved (git reset --soft) is not a change', () => {
    const before = snap(OID, {})
    const after = snap(H('b'), { 'a.ts': { isIndexOnly: true }, 'b.ts': {} })
    expect(compareSnapshots(before, after)).toEqual([{ path: 'b.ts', kind: 'new' }])
  })

  test('a deletion is a change even when git could not hash the file', () => {
    const before = snap(OID, { 'a.ts': { hash: 'status:.M' } })
    const after = snap(OID, { 'a.ts': { hash: 'deleted', deleted: true } })
    expect(compareSnapshots(before, after)).toEqual([{ path: 'a.ts', kind: 'changed' }])
  })
})

test('buildSnapshot marks deleted and index-only entries and falls back without hashes', () => {
  const status = parseStatus(
    [
      `1 M. N... 100644 100644 100644 ${H('1')} ${H('2')} staged.ts`,
      `1 .D N... 100644 100644 000000 ${H('1')} ${H('1')} gone.ts`,
      `1 .M N... 100644 100644 100644 ${H('1')} ${H('1')} edited.ts`,
    ].join('\0'),
  )
  const built = buildSnapshot(status, undefined, new Map([['edited.ts', { added: 2, removed: 1 }]]))
  expect(built.entries.get('staged.ts')).toMatchObject({ isIndexOnly: true, hash: 'status:M.' })
  expect(built.entries.get('gone.ts')).toMatchObject({ deleted: true, hash: 'deleted' })
  expect(built.entries.get('edited.ts')).toMatchObject({ added: 2, removed: 1, isIndexOnly: false })
})

test('lineDelta, countLines, shownPath and parseRepo', () => {
  expect(lineDelta({ added: 2, removed: 1 }, { added: 5, removed: 1 })).toEqual({ added: 3, removed: 0 })
  expect(lineDelta(undefined, { added: 1, removed: 4 })).toEqual({ added: 1, removed: 4 })
  expect(countLines('a\nb\n')).toBe(2)
  expect(countLines('a')).toBe(1)
  expect(countLines('')).toBe(0)
  expect(shownPath('app/src/a.ts', '/repo', 'app/')).toBe('src/a.ts')
  expect(shownPath('lib/b.ts', '/repo', 'app/')).toBe('/repo/lib/b.ts')
  expect(shownPath('lib/b.ts', '/repo', '')).toBe('lib/b.ts')
  expect(parseRepo('/repo\napp/\n')).toEqual({ top: '/repo', prefix: 'app/' })
  expect(parseRepo('')).toBeNull()
})

test('a Bash change and a later Edit merge into one row', () => {
  const once = merge([], { path: 'a.ts', added: 1, removed: 0, created: false, bash: true }, 1)
  expect(statusOf(once[0]!)).toBe('modified (bash)')
  const twice = merge(once, { path: 'a.ts', added: 2, removed: 1, created: false }, 2)
  expect(twice).toHaveLength(1)
  expect(twice[0]).toMatchObject({ edits: 2, bash: 1, added: 3, removed: 1 })
  expect(statusOf(twice[0]!)).toBe('modified (+bash)')
  const gone = merge(twice, { path: 'a.ts', added: 0, removed: 3, created: false, bash: true, deleted: true }, 3)
  expect(statusOf(gone[0]!)).toBe('deleted (+bash)')
})
