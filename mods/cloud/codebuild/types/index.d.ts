export type Phase = { name: string; status: string; seconds?: number }

export type BuildView = {
  id: string
  number: number
  project: string
  status: string
  phase: string
  phases: Phase[]
  startedAt: number
  endedAt?: number
  logGroup?: string
  logStream?: string
  consoleUrl: string
  startedBy: 'you' | 'claude'
  failure?: string
}

export type Wizard = {
  profiles: string[]
  profile: string
  repo: string
  /** `✓ account 1234…5678 · us-east-1 · role/Dev`, or what's wrong. */
  identity: string
  isIdentityOk: boolean
  /** The other profiles, checked: `simian ✗ no credentials`. */
  others: string
  stack: string
  buildspec: string
  hasOwnBuildspec: boolean
  isConfigured: boolean
  showBuildspec: boolean
  message: string
  isBusy: boolean
}

declare module 'claude-code' {
  interface PluginState {
    codebuild: { wizard: Wizard | null; build: BuildView | null; log: string[]; mode: 'wizard' | 'build' }
  }
}
