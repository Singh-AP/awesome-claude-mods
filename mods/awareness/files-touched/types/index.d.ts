export type TouchedFile = {
  /** Relative to the session's project root when inside it, else absolute. */
  path: string
  /** Successful Edit, Write and NotebookEdit calls on it. */
  edits: number
  /** Lines added and removed over all of them. */
  added: number
  removed: number
  /** True when Claude created the file this session. */
  created: boolean
  firstAt: number
  lastAt: number
}

declare module 'claude-code' {
  interface PluginState {
    'files-touched': {
      files: TouchedFile[]
    }
  }
}
