import { describe, expect, test } from 'claude-code/testing'

import { PACKS, hash, parseCustom, pastFor, presentFor, samples } from '../hooks/packs'

describe('every pack', () => {
  for (const pack of PACKS) {
    test(`${pack.id} has 25+ distinct, short words, each with a past form`, () => {
      expect(pack.words.length >= 25).toBe(true)
      const presents = pack.words.map(([present]) => present)
      expect(new Set(presents).size).toBe(presents.length)
      for (const [present, past] of pack.words) {
        expect(present.length > 0 && present.length <= 32).toBe(true)
        expect(typeof past === 'string' && past.length > 0 && past.length <= 32).toBe(true)
      }
    })
  }
})

test('pack ids are unique, lowercase and match the option list', () => {
  const ids = PACKS.map(p => p.id)
  expect(new Set(ids).size).toBe(ids.length)
  expect(ids).toEqual(['pirate', 'shakespeare', 'corporate', 'wizard', 'chef', 'space', 'noir', 'genz', 'zen', 'retro'])
})

test('the same seed always picks the same word, and seeds spread across the pack', () => {
  const pack = PACKS[0]!
  expect(presentFor(pack, '3:main')).toBe(presentFor(pack, '3:main'))
  const seen = new Set(Array.from({ length: 60 }, (_, i) => presentFor(pack, `${i}:main`)))
  expect(seen.size >= 15).toBe(true)
  expect(hash('a')).not.toBe(hash('b'))
})

test('parseCustom reads words and optional past forms', () => {
  const pack = parseCustom(' Frobbing|Frobbed , Yak shaving ,, ')!
  expect(pack.words).toEqual([['Frobbing', 'Frobbed'], ['Yak shaving', null]])
  expect(pastFor(pack, 'x')).toBe('Frobbed')
  expect(parseCustom(' , ')).toBeUndefined()
  expect(pastFor(parseCustom('Only present')!, 'x')).toBeUndefined()
})

test('samples gives three words for the listing', () => {
  expect(samples(PACKS[0]!).length).toBe(3)
})
