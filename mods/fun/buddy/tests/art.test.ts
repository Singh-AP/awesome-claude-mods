import { describe, expect, test } from 'claude-code/testing'

import { drawFace, drawPet, isSpecies, SPECIES } from '../hooks/art'
import type { Mood } from '../types'

const MOODS: readonly Mood[] = ['idle', 'sleep', 'think', 'work', 'startled', 'wary', 'happy', 'party']

describe('every species draws every mood', () => {
  for (const species of SPECIES) {
    test(`${species}: three rows of one width, the same width in every mood`, () => {
      const widths = new Set<number>()
      for (const mood of MOODS) {
        for (const frame of [0, 1]) {
          const rows = drawPet(species, mood, frame)
          expect(rows.length).toBe(3)
          for (const row of rows) widths.add(row.length)
        }
      }
      // A steady width keeps the text beside the pet from jumping around.
      expect(widths.size).toBe(1)
    })

    test(`${species}: moods show different faces`, () => {
      const faces = new Set(MOODS.map(mood => drawFace(species, mood)))
      expect(faces.size).toBeGreaterThan(4)
    })
  }
})

test('the cat looks like a cat', () => {
  expect(drawPet('cat', 'idle', 0).map(r => r.trimEnd())).toEqual([' /\\_/\\', '( o.o )', ' > ^ <'])
  expect(drawFace('cat', 'happy')).toBe('( ^w^ )')
})

test('a sleeping pet snores, a startled one shouts', () => {
  expect(drawPet('cat', 'sleep', 0)[0]).toMatch(/zZ/)
  expect(drawPet('robot', 'startled', 0)[0]).toMatch(/!/)
  expect(drawFace('ghost', 'sleep')).toBe('( -.- )')
})

test('only working and partying pets animate their feet', () => {
  expect(drawPet('cat', 'work', 0)[2]).not.toBe(drawPet('cat', 'work', 1)[2])
  expect(drawPet('dog', 'party', 0)[2]).not.toBe(drawPet('dog', 'party', 1)[2])
  expect(drawPet('cat', 'idle', 0)[2]).toBe(drawPet('cat', 'idle', 1)[2])
  expect(drawPet('blob', 'sleep', 0)[2]).toBe(drawPet('blob', 'sleep', 1)[2])
})

test('isSpecies knows the six pets', () => {
  expect(SPECIES.length).toBe(6)
  expect(isSpecies('duck')).toBe(true)
  expect(isSpecies('dragon')).toBe(false)
})
