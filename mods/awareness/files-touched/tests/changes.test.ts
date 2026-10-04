import { describe, expect, test } from 'claude-code/testing'

import type { TouchedFile } from '../types'
import {
  bandLine,
  changeOf,
  countPatch,
  countStrings,
  delta,
  displayNames,
  listText,
  mention,
  merge,
  relativeTo,
  tableText,
} from '../hooks/changes'

const file = (path: string, added: number, removed: number, lastAt: number, extra: Partial<TouchedFile> = {}): TouchedFile => ({
  path,
  edits: 1,
  added,
  removed,
  created: false,
  firstAt: lastAt,
  lastAt,
  ...extra,
})

describe('counting lines', () => {
  test('countPatch counts + and - lines and skips the file headers', () => {
    expect(countPatch([{ lines: ['--- a', '+++ b', ' same', '-old', '+new', '+more'] }, { lines: ['-x'] }])).toEqual({ added: 2, removed: 2 })
    expect(countPatch([{ lines: 'nope' }, {}])).toEqual({ added: 0, removed: 0 })
  })
  test('countStrings leaves out common lines at both ends', () => {
    expect(countStrings('a\nb\nc', 'a\nB\nc')).toEqual({ added: 1, removed: 1 })
    expect(countStrings('a\nc', 'a\nb\nc')).toEqual({ added: 1, removed: 0 })
    expect(countStrings('', 'one\ntwo\n')).toEqual({ added: 2, removed: 0 })
    expect(countStrings('x\ny', '')).toEqual({ added: 0, removed: 2 })
  })
})

describe('changeOf', () => {
  test('Edit prefers the structured patch', () => {
    const result = { structuredPatch: [{ lines: ['-a', '+b', '+c'] }] }
    expect(changeOf('Edit', { file_path: '/r/a.ts', old_string: 'a', new_string: 'b\nc' }, result)).toEqual({ path: '/r/a.ts', added: 2, removed: 1, created: false })
  })
  test('Edit falls back to the strings', () => {
    expect(changeOf('Edit', { file_path: '/r/a.ts', old_string: 'one', new_string: 'one\ntwo' }, 'ok')).toEqual({ path: '/r/a.ts', added: 1, removed: 0, created: false })
  })
  test('Write of a new file counts its lines as added', () => {
    expect(changeOf('Write', { file_path: '/r/new.md', content: '# T\n\nbody\n' }, { type: 'create' })).toEqual({ path: '/r/new.md', added: 3, removed: 0, created: true })
  })
  test('Write over a file uses the patch, then the original', () => {
    expect(changeOf('Write', { file_path: '/r/a', content: 'x' }, { type: 'update', structuredPatch: [{ lines: ['-y', '+x'] }] })).toEqual({ path: '/r/a', added: 1, removed: 1, created: false })
    expect(changeOf('Write', { file_path: '/r/a', content: 'a\nB' }, { type: 'update', structuredPatch: [], originalFile: 'a\nb' })).toEqual({ path: '/r/a', added: 1, removed: 1, created: false })
  })
  test('MultiEdit sums its edits', () => {
    const input = { file_path: '/r/m.ts', edits: [{ old_string: 'a', new_string: 'b' }, { old_string: 'c', new_string: 'c\nd' }] }
    expect(changeOf('MultiEdit', input, {})).toEqual({ path: '/r/m.ts', added: 2, removed: 1, created: false })
  })
  test('NotebookEdit counts the cell source', () => {
    expect(changeOf('NotebookEdit', { notebook_path: '/r/n.ipynb', new_source: 'a\nb' }, {})).toEqual({ path: '/r/n.ipynb', added: 2, removed: 0, created: false })
    expect(changeOf('NotebookEdit', { notebook_path: '/r/n.ipynb', new_source: 'a', edit_mode: 'delete' }, {})).toEqual({ path: '/r/n.ipynb', added: 0, removed: 1, created: false })
  })
  test('a staged write, another tool or a missing path change nothing', () => {
    expect(changeOf('Edit', { file_path: '/r/a', old_string: 'a', new_string: 'b' }, { staged: true })).toBeUndefined()
    expect(changeOf('Read', { file_path: '/r/a' }, {})).toBeUndefined()
    expect(changeOf('Write', { content: 'x' }, {})).toBeUndefined()
  })
})

test('relativeTo strips the project root only', () => {
  expect(relativeTo('/repo/src/a.ts', '/repo')).toBe('src/a.ts')
  expect(relativeTo('/repo/src/a.ts', '/repo/')).toBe('src/a.ts')
  expect(relativeTo('/repository/a.ts', '/repo')).toBe('/repository/a.ts')
  expect(relativeTo('/etc/hosts', undefined)).toBe('/etc/hosts')
})

test('merge adds up a file and moves it to the front', () => {
  let list = merge([], { path: 'a', added: 2, removed: 0, created: true }, 1)
  list = merge(list, { path: 'b', added: 1, removed: 1, created: false }, 2)
  list = merge(list, { path: 'a', added: 3, removed: 1, created: false }, 3)
  expect(list.map(f => f.path)).toEqual(['a', 'b'])
  expect(list[0]).toEqual({ path: 'a', edits: 2, added: 5, removed: 1, created: true, firstAt: 1, lastAt: 3 })
})

test('displayNames uses as much path as tells two files apart', () => {
  const names = displayNames([file('src/a/index.ts', 0, 0, 1), file('src/b/index.ts', 0, 0, 2), file('README.md', 0, 0, 3)])
  expect(names.get('src/a/index.ts')).toBe('a/index.ts')
  expect(names.get('src/b/index.ts')).toBe('b/index.ts')
  expect(names.get('README.md')).toBe('README.md')
})

test('delta', () => {
  expect(delta({ added: 12, removed: 3 })).toBe('+12 −3')
  expect(delta({ added: 0, removed: 3 })).toBe('−3')
  expect(delta({ added: 0, removed: 0 })).toBe('+0')
})

describe('bandLine', () => {
  const files = [file('hooks/register.ts', 12, 3, 4), file('README.md', 40, 0, 3), file('a.ts', 1, 0, 2), file('b.ts', 2, 0, 1)]
  test('lists the newest files that fit', () => {
    expect(bandLine(files, 200)).toBe('✎ 4 files · register.ts +12 −3 · README.md +40 · a.ts +1 · b.ts +2')
  })
  test('says how many more when it runs out of room', () => {
    const line = bandLine(files, 50)
    expect(line).toBe('✎ 4 files · register.ts +12 −3 · +3 more')
    expect(line.length).toBeLessThan(51)
  })
  test('never exceeds the width', () => {
    for (const width of [5, 10, 20, 33, 60]) expect(bandLine(files, width).length).toBeLessThan(width + 1)
  })
  test('one file reads as singular', () => {
    expect(bandLine([file('x.ts', 1, 0, 1)], 80)).toBe('✎ 1 file · x.ts +1')
  })
})

test('tableText is a markdown table, newest first', () => {
  const text = tableText([file('a.ts', 1, 0, 1), file('b.ts', 5, 2, 2, { created: true, edits: 3 })])
  expect(text).toMatch(/^\*\*2 files changed\*\* · \+6 −2 · 4 edits/)
  expect(text).toMatch(/\| `b\.ts` \| created \| 3 \| \+5 \| −2 \|/)
  expect(text.indexOf('b.ts')).toBeLessThan(text.indexOf('a.ts'))
  expect(tableText([])).toBe('No files changed yet this session.')
})

test('listText and mention', () => {
  expect(listText([file('a', 0, 0, 1), file('b', 0, 0, 2)])).toBe('b\na')
  expect(mention('src/a.ts')).toBe('@src/a.ts ')
  expect(mention('docs/my notes.md')).toBe('@"docs/my notes.md" ')
})
