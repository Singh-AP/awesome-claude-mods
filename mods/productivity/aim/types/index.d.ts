/** The goal the person is working on, and when they set it (ms since the epoch). */
export type AimGoal = { text: string; startedAt: number }

/** A finished goal, as `/aim history` lists it. */
export type AimDone = { text: string; startedAt: number; endedAt: number; root: string }

declare module 'claude-code' {
  interface PluginState {
    aim: { goal: AimGoal | null }
  }
}
