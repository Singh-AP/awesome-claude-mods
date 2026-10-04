export type RadarStatus = 'running' | 'done' | 'failed' | 'denied'

export type RadarCall = {
  /** The tool_use id, or one the mod made up for a call that carried none. */
  id: string
  /** The tool's name as the model called it (`Bash`, `mcp__github__search`). */
  tool: string
  /** A short look at the arguments: the command, the file, the pattern. */
  preview: string
  /** The subagent's id when a subagent made the call; absent on the main loop. */
  agent?: string
  status: RadarStatus
  startedAt: number
  /** How long the call took, permission prompts included; absent while it runs. */
  ms?: number
  /** Why it failed or was denied, cut short. */
  error?: string
}

export type RadarTotals = {
  /** Calls that have finished, whatever the outcome. */
  calls: number
  failed: number
  denied: number
  /** Total milliseconds over the finished calls, for the average. */
  totalMs: number
  /** Finished calls per tool label (`Bash`, `mcp:github`). */
  byTool: Record<string, number>
}

declare module 'claude-code' {
  interface PluginState {
    'tool-radar': {
      calls: RadarCall[]
      totals: RadarTotals
      errorsOnly: boolean
    }
  }
}
