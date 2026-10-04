export type Mood = 'idle' | 'sleep' | 'think' | 'work' | 'startled' | 'wary' | 'happy' | 'party'

export type Species = 'cat' | 'dog' | 'blob' | 'robot' | 'ghost' | 'duck'

/** What the band shows right now: the pet's mood and the line beside it. */
export type Look = { mood: Mood; line: string }

/** Who the pet is: the name and species the person picked, and its XP. */
export type Pet = { name: string; species: Species; xp: number }

declare module 'claude-code' {
  interface PluginState {
    buddy: {
      look: Look
      frame: number
      pet: Pet
      isHidden: boolean
    }
  }
}
