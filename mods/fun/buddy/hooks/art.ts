// The pets, drawn in plain text: no `$`, so tests import it directly.

import type { Mood, Species } from '../types'

export const SPECIES: readonly Species[] = ['cat', 'dog', 'blob', 'robot', 'ghost', 'duck']

/** Eyes and mouth for each mood; every species draws its face from these. */
type Face = { left: string; right: string; mouth: string }

const FACES: Record<Mood, Face> = {
  idle: { left: 'o', right: 'o', mouth: '.' },
  sleep: { left: '-', right: '-', mouth: '.' },
  think: { left: 'o', right: 'O', mouth: '~' },
  work: { left: 'o', right: 'o', mouth: '_' },
  startled: { left: 'O', right: 'O', mouth: 'o' },
  wary: { left: '¬', right: '¬', mouth: '_' },
  happy: { left: '^', right: '^', mouth: 'w' },
  party: { left: '^', right: '^', mouth: 'o' },
}

/**
 * Three rows per species. `{L}`, `{M}` and `{R}` are the left eye, the mouth
 * and the right eye; the last row has two frames, swapped while the pet works.
 */
const ART: Record<Species, { top: string; face: string; feet: readonly [string, string] }> = {
  cat: { top: ' /\\_/\\ ', face: '( {L}{M}{R} )', feet: [' > ^ < ', ' < ^ > '] },
  dog: { top: ' /\\_ _/\\ ', face: ' ( {L}{M}{R} ) ', feet: ['  \\_U_/  ', '  \\_u_/  '] },
  blob: { top: '  .---.  ', face: ' ( {L}{M}{R} ) ', feet: ["  `---'  ", "  '---`  "] },
  robot: { top: '   _T_   ', face: ' [ {L}{M}{R} ] ', feet: ['  /|_|\\  ', '  \\|_|/  '] },
  ghost: { top: '  .-"-.  ', face: ' ( {L}{M}{R} ) ', feet: ['  ^v^v^  ', '  v^v^v  '] },
  duck: { top: '   __    ', face: ' <({L} )__ ', feet: ['  ( ._> / ', '  ( ._> \\ '] },
}

/** Extra glyphs drawn to the right of the face for some moods. */
const MARKS: Partial<Record<Mood, string>> = {
  sleep: 'zZ',
  think: '?',
  startled: '!',
  wary: '…',
  happy: '♪',
  party: '*',
}

export function isSpecies(value: string): value is Species {
  return (SPECIES as readonly string[]).includes(value)
}

/** The pet as three rows of equal width, for a mood and an animation frame. */
export function drawPet(species: Species, mood: Mood, frame: number): string[] {
  const art = ART[species]
  const face = FACES[mood]
  const feet = mood === 'work' || mood === 'party' ? art.feet[frame % 2]! : art.feet[0]
  const mark = MARKS[mood] ?? ''
  const rows = [
    art.top,
    art.face.replace('{L}', face.left).replace('{M}', face.mouth).replace('{R}', face.right),
    feet,
  ]
  const width = Math.max(...rows.map(r => r.length))
  // The mark sits beside the top row so the face itself never shifts.
  return rows.map((r, i) => (i === 0 ? `${r.padEnd(width)} ${mark.padEnd(2)}` : `${r.padEnd(width)}   `))
}

/** One-line form for narrow bands: just the face. */
export function drawFace(species: Species, mood: Mood): string {
  const face = FACES[mood]
  const art = ART[species]
  return art.face
    .replace('{L}', face.left)
    .replace('{M}', face.mouth)
    .replace('{R}', face.right)
    .trim()
}
