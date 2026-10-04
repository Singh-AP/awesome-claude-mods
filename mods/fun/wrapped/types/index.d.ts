export type Persona = { emoji: string; title: string; blurb: string }

/** What the card shows: a year's (or a lifetime's) stats, worked out once. */
export type Summary = {
  label: string
  isEmpty: boolean
  prompts: number
  sessions: number
  turns: number
  turnMs: number
  toolCalls: number
  failed: number
  files: number
  lines: number
  commits: number
  cost: number
  activeDays: number
  streak: { current: number; longest: number }
  topTools: { name: string; count: number }[]
  topProject: string
  busiestHour: number
  longestTurnMs: number
  firstSeen: number
  persona: Persona
}

declare module 'claude-code' {
  interface PluginState {
    wrapped: {
      summary: Summary | null
    }
  }
}
