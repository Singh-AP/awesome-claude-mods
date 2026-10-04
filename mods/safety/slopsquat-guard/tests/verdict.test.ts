import { expect, test } from 'claude-code/testing'

import { distance, judge, lookalike, urlsFor, weeklyFrom } from '../hooks/verdict'

const NOW = Date.parse('2026-10-04T00:00:00Z')
const LIMITS = { minAgeDays: 14, minWeeklyDownloads: 50 }
const ok = (body: unknown) => ({ status: 200, text: JSON.stringify(body) })
const HEAD = { status: 200, text: '' }
const NOT_FOUND = { status: 404, text: '{"error":"Not found"}' }

test('a 404 means the package does not exist', () => {
  const v = judge('npm', 'react-super-utils-acm', { exists: NOT_FOUND }, NOW, LIMITS)
  expect(v.status).toBe('missing')
  expect(v.reasons[0]).toBe('no package named "react-super-utils-acm" exists on npm')
})

test('no answer or a server error is unknown, never missing', () => {
  expect(judge('pypi', 'x', { exists: undefined }, NOW, LIMITS).status).toBe('unknown')
  expect(judge('pypi', 'x', { exists: { status: 503, text: '' } }, NOW, LIMITS).status).toBe('unknown')
  expect(judge('crates', 'x', { exists: { status: 429, text: '' } }, NOW, LIMITS).status).toBe('unknown')
})

test('a popular npm package is fine on downloads alone', () => {
  const v = judge('npm', 'react', { exists: HEAD, downloads: ok({ downloads: 222767611 }) }, NOW, LIMITS)
  expect(v).toEqual({ status: 'ok', reasons: [], createdAt: undefined, weeklyDownloads: 222767611 })
})

test('a brand-new, unused npm package is suspicious', () => {
  const meta = ok({ name: 'fresh', versions: { '1.0.0': {} }, time: { created: '2026-10-01T10:00:00Z' } })
  const v = judge('npm', 'fresh-thing', { exists: HEAD, meta, downloads: ok({ downloads: 3 }) }, NOW, LIMITS)
  expect(v.status).toBe('suspicious')
  expect(v.reasons).toEqual(['it was first published 2 days ago', 'it has only 3 downloads a week'])
})

test('an unpublished npm name counts as missing', () => {
  const meta = ok({ name: 'gone', time: { created: '2020-01-01T00:00:00Z', unpublished: { time: '2021-01-01' } } })
  expect(judge('npm', 'gone', { exists: HEAD, meta }, NOW, LIMITS).status).toBe('missing')
})

test('PyPI age is the earliest upload of any release', () => {
  const meta = ok({
    info: { name: 'oldpkg' },
    releases: {
      '0.1': [{ upload_time_iso_8601: '2015-03-01T00:00:00Z' }],
      '2.0': [{ upload_time_iso_8601: '2026-09-30T00:00:00Z' }],
    },
  })
  const v = judge('pypi', 'oldpkg', { exists: HEAD, meta, downloads: ok({ data: { last_week: 900 } }) }, NOW, LIMITS)
  expect(v).toEqual({ status: 'ok', reasons: [], createdAt: '2015-03-01T00:00:00Z', weeklyDownloads: 900 })
})

test('crates.io reports age and recent downloads in one answer', () => {
  const meta = ok({ crate: { created_at: '2026-10-03T12:00:00Z', recent_downloads: 130 } })
  const v = judge('crates', 'newcrate', { exists: meta, meta }, NOW, LIMITS)
  expect(v.status).toBe('suspicious')
  expect(v.reasons).toEqual(['it was first published today', 'it has only 10 downloads a week'])
})

test('RubyGems lifetime downloads stand in for weekly ones', () => {
  const meta = ok({ name: 'tiny', downloads: 520 })
  expect(judge('rubygems', 'tiny', { exists: meta, meta }, NOW, LIMITS).reasons).toEqual(['it has only 10 downloads a week'])
})

test('a lookalike of a popular name is suspicious unless it is popular itself', () => {
  const quiet = judge('pypi', 'reqests', { exists: HEAD, downloads: ok({ data: { last_week: 5000 } }) }, NOW, LIMITS)
  expect(quiet.reasons).toEqual(['its name is one letter away from the popular "requests"'])
  const busy = judge('npm', 'preact', { exists: HEAD, downloads: ok({ downloads: 9_000_000 }) }, NOW, LIMITS)
  expect(busy.status).toBe('ok')
})

test('lookalike catches swaps, drops and additions, not the popular name itself', () => {
  expect(lookalike('npm', 'lodahs')).toBe('lodash')
  expect(lookalike('npm', 'expres')).toBe('express')
  expect(lookalike('npm', 'axioss')).toBe('axios')
  expect(lookalike('pypi', 'nunpy')).toBe('numpy')
  expect(lookalike('npm', 'lodash')).toBeUndefined()
  expect(lookalike('npm', 'zzz')).toBeUndefined()
  expect(lookalike('npm', 'totally-different')).toBeUndefined()
})

test('distance is Levenshtein with adjacent swaps', () => {
  expect(distance('lodash', 'lodahs')).toBe(1)
  expect(distance('kitten', 'sitting')).toBe(3)
  expect(distance('', 'abc')).toBe(3)
})

test('urls per registry, scoped npm names escaped', () => {
  expect(urlsFor('npm', '@types/node').meta).toBe('https://registry.npmjs.org/@types%2Fnode')
  expect(urlsFor('pypi', 'requests').downloads).toBe('https://pypistats.org/api/packages/requests/recent')
  expect(urlsFor('crates', 'serde').downloads).toBeUndefined()
})

test('weeklyFrom reads npm and pypistats shapes', () => {
  expect(weeklyFrom('npm', ok({ downloads: 7 }))).toBe(7)
  expect(weeklyFrom('pypi', ok({ data: { last_week: 9 } }))).toBe(9)
  expect(weeklyFrom('npm', NOT_FOUND)).toBeUndefined()
  expect(weeklyFrom('npm', undefined)).toBeUndefined()
})
