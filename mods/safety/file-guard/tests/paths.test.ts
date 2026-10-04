import { describe, expect, test } from 'claude-code/testing'

import { basename, dirname, globToRegExp, isGitInternal, isInside, join, matchesGlob, normalize, parseList, protectedBy, relative, resolveSpelling } from '../hooks/paths'
import { DEFAULT_PROTECT } from '../hooks/register'
import { display, judge, type Fence } from '../hooks/verdict'

describe('paths', () => {
  test('normalize folds dots and slashes', () => {
    expect(normalize('/a//b/./c/../d/')).toBe('/a/b/d')
    expect(normalize('/../..')).toBe('/')
    expect(normalize('a/../../b')).toBe('../b')
  })
  test('join, dirname, basename', () => {
    expect(join('/a', 'b', '../c')).toBe('/a/c')
    expect(dirname('/a/b/c.ts')).toBe('/a/b')
    expect(dirname('/a')).toBe('/')
    expect(basename('/a/b/c.ts')).toBe('c.ts')
  })
  test('isInside never matches a sibling with a shared prefix', () => {
    expect(isInside('/work/app/x.ts', '/work/app')).toBe(true)
    expect(isInside('/work/app', '/work/app')).toBe(true)
    expect(isInside('/work/app-old/x.ts', '/work/app')).toBe(false)
    expect(relative('/work/app/src/x.ts', '/work/app')).toBe('src/x.ts')
  })
  test('resolveSpelling expands ~ and relative paths', () => {
    expect(resolveSpelling('~/notes', '/Users/me', '/work')).toBe('/Users/me/notes')
    expect(resolveSpelling('src/a.ts', '/Users/me', '/work')).toBe('/work/src/a.ts')
    expect(resolveSpelling('/etc/hosts', '/Users/me', '/work')).toBe('/etc/hosts')
  })
  test('parseList trims and drops empties', () => {
    expect(parseList(' a, b ,,c ')).toEqual(['a', 'b', 'c'])
  })
  test('isGitInternal spots .git but not .github or .gitignore', () => {
    expect(isGitInternal('/w/.git/config')).toBe(true)
    expect(isGitInternal('/w/sub/.git/hooks/pre-commit')).toBe(true)
    expect(isGitInternal('/w/.github/workflows/ci.yml')).toBe(false)
    expect(isGitInternal('/w/.gitignore')).toBe(false)
  })
})

describe('globs', () => {
  const cases: [string, string, boolean][] = [
    ['.github/workflows/ci.yml', '.github/workflows/**', true],
    ['.github/ISSUE_TEMPLATE/bug.yml', '.github/workflows/**', false],
    ['db/migrations/001_init.sql', '**/migrations/**', true],
    ['migrations/001.sql', '**/migrations/**', true],
    ['src/migrationsHelper.ts', '**/migrations/**', false],
    ['Cargo.lock', '**/*.lock', true],
    ['crates/x/Cargo.lock', '**/*.lock', true],
    ['web/package-lock.json', 'package-lock.json', true],
    ['package-lock.json.bak', 'package-lock.json', false],
    ['.env', '**/.env*', true],
    ['apps/api/.env.local', '**/.env*', true],
    ['src/environment.ts', '**/.env*', false],
    ['keys/server.pem', '**/*.pem', true],
    ['a/b/c.ts', 'a/*/c.ts', true],
    ['a/b/x/c.ts', 'a/*/c.ts', false],
    ['file1.txt', 'file?.txt', true],
    ['./src/a.ts', 'src/a.ts', false],
  ]
  for (const [path, glob, expected] of cases) {
    test(`${glob} ${expected ? 'matches' : 'skips'} ${path}`, () => expect(matchesGlob(path, glob)).toBe(expected))
  }
  test('special characters are literal', () => {
    expect(globToRegExp('a+b(1).txt').test('a+b(1).txt')).toBe(true)
    expect(globToRegExp('a.txt').test('abtxt')).toBe(false)
  })
  test('the defaults protect secrets but exempt .env.example', () => {
    const defaults = parseList(DEFAULT_PROTECT)
    expect(protectedBy('.env', defaults)).toBe('**/.env*')
    expect(protectedBy('config/.env.example', defaults)).toBeUndefined()
    expect(protectedBy('yarn.lock', defaults)).toBe('**/*.lock')
    expect(protectedBy('src/index.ts', defaults)).toBeUndefined()
  })
})

describe('judge', () => {
  const fence: Fence = { root: '/work', allowed: ['/private/tmp'], protect: ['**/*.lock'], fenceReads: false }
  test('inside the project: allowed, unless protected', () => {
    expect(judge('/work/src/a.ts', 'write', fence).kind).toBe('allow')
    expect(judge('/work/yarn.lock', 'write', fence)).toMatchObject({ kind: 'confirm', pattern: '**/*.lock' })
    expect(judge('/work/yarn.lock', 'read', fence).kind).toBe('allow')
  })
  test('outside: writes blocked, reads allowed unless fenced', () => {
    expect(judge('/etc/hosts', 'write', fence)).toMatchObject({ kind: 'block', rule: 'outside' })
    expect(judge('/etc/hosts', 'read', fence).kind).toBe('allow')
    expect(judge('/etc/hosts', 'read', { ...fence, fenceReads: true })).toMatchObject({ kind: 'block', rule: 'outside' })
  })
  test('allowed roots and .git', () => {
    expect(judge('/private/tmp/x', 'write', fence).kind).toBe('allow')
    expect(judge('/work/.git/HEAD', 'write', fence)).toMatchObject({ kind: 'block', rule: 'git' })
    expect(judge(undefined, 'write', fence)).toMatchObject({ kind: 'block', rule: 'unplaceable' })
    expect(judge(undefined, 'read', fence).kind).toBe('allow')
  })
  test('display shortens home', () => {
    expect(display('/Users/me/x', '/Users/me')).toBe('~/x')
    expect(display('/etc/x', '/Users/me')).toBe('/etc/x')
  })
})
