/** The explanation drawn under each Bash call's row, by tool_use_id (the latest few). */
export type ExplanationLines = Record<string, string>

declare module 'claude-code' {
  interface PluginState {
    'command-explainer': { lines: ExplanationLines }
  }
}
