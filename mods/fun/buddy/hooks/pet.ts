// What the pet makes of each event: no `$`, so tests import it directly.

import type { Mood } from '../types'

export const XP = { toolCall: 1, turn: 5, greenTests: 10, commit: 20 } as const

/** Total XP needed to reach `level` (level 1 is free): 0, 50, 150, 300, 500... */
export function xpForLevel(level: number): number {
  return 25 * level * (level - 1)
}

export function levelOf(xp: number): number {
  let level = 1
  while (xpForLevel(level + 1) <= xp) level++
  return level
}

/** How far into the current level, from 0 to 1. */
export function progress(xp: number): number {
  const level = levelOf(xp)
  const from = xpForLevel(level)
  const to = xpForLevel(level + 1)
  return (xp - from) / (to - from)
}

export function xpBar(xp: number, width: number): string {
  const filled = Math.round(progress(xp) * width)
  return '█'.repeat(filled) + '░'.repeat(Math.max(0, width - filled))
}

function basename(path: unknown): string {
  const text = typeof path === 'string' ? path : ''
  return text.split(/[\\/]/).filter(Boolean).pop() ?? text
}

function clip(text: string, max: number): string {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length > max ? `${one.slice(0, max - 1)}…` : one
}

/** The line beside the pet while a tool runs. */
export function toolLine(tool: string, input: Record<string, unknown>): string {
  switch (tool) {
    case 'Read':
      return `📖 reading ${basename(input.file_path)}`
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return `✏️ editing ${basename(input.file_path ?? input.notebook_path)}`
    case 'Write':
      return `📝 writing ${basename(input.file_path)}`
    case 'Bash':
      return `⚙️ running ${clip(String(input.command ?? ''), 32)}`
    case 'Grep':
    case 'Glob':
      return `🔍 searching ${clip(String(input.pattern ?? ''), 24)}`
    case 'WebFetch':
    case 'WebSearch':
      return '🌐 browsing the web'
    case 'Agent':
    case 'Task':
      return `🤝 delegating ${clip(String(input.description ?? ''), 28)}`.trimEnd()
    case 'TodoWrite':
      return '📋 making a plan'
    case 'AskUserQuestion':
      return '🙋 has a question for you'
  }
  if (tool.startsWith('mcp__')) return `🔌 using ${tool.split('__')[1] ?? 'a tool'}`
  return `🛠 using ${tool}`
}

const TEST_COMMAND =
  /\b(test|tests|jest|vitest|pytest|mocha|ava|tap|rspec|phpunit|ctest|tox|nox|playwright)\b|\b(go|cargo|bun|deno|swift|mix|dotnet|gradle|mvn)\s+test\b|\bnpm\s+(t|test)\b|\bmake\s+(test|check)\b/
const TEST_PASSED = /\b(pass(ed|es|ing)?|ok)\b|✓|✔/i
const TEST_FAILED = /\b[1-9]\d*\s+(failed|failing|failures?|errors?)\b|^\s*FAIL\b|\bFAILED\b/m

/** A test command that exited 0 and says it passed. */
export function isGreenTestRun(command: string, output: string, isError: boolean): boolean {
  return !isError && TEST_COMMAND.test(command) && TEST_PASSED.test(output) && !TEST_FAILED.test(output)
}

/** A `git commit` that went through. */
export function isCommit(command: string, output: string, isError: boolean): boolean {
  if (isError) return false
  if (!/\bgit\b(\s+-[Cc]\s+\S+)*\s+commit\b/.test(command) || /--dry-run/.test(command)) return false
  return !/nothing to commit|no changes added to commit/i.test(output)
}

/** What happened when a tool finished, and the mood it puts the pet in. */
export type Outcome = { mood: Mood; line: string; xp: number; commits: number; greenTests: number; errors: number }

export function outcomeOf(
  tool: string,
  input: Record<string, unknown>,
  result: { deny?: string; isError?: boolean; text?: string },
): Outcome {
  const base = { xp: XP.toolCall, commits: 0, greenTests: 0, errors: 0 }
  if (result.deny !== undefined) return { ...base, mood: 'wary', line: `😬 ${tool} was blocked` }
  const isError = result.isError === true
  if (isError) return { ...base, errors: 1, mood: 'startled', line: `😵 ${tool} failed` }
  if (tool === 'Bash') {
    const command = String(input.command ?? '')
    const output = result.text ?? ''
    if (isCommit(command, output, isError)) {
      return { ...base, xp: base.xp + XP.commit, commits: 1, mood: 'party', line: '🎉 committed!' }
    }
    if (isGreenTestRun(command, output, isError)) {
      return { ...base, xp: base.xp + XP.greenTests, greenTests: 1, mood: 'happy', line: '✅ tests are green!' }
    }
  }
  return { ...base, mood: 'work', line: '' }
}

/** Moods that show for a moment and then give way to what is going on. */
export function isFleeting(mood: Mood): boolean {
  return mood === 'startled' || mood === 'wary' || mood === 'happy' || mood === 'party'
}

export function moodWord(mood: Mood): string {
  switch (mood) {
    case 'sleep':
      return 'zZ… napping'
    case 'think':
      return '💭 thinking'
    case 'work':
      return '💪 working'
    case 'idle':
      return '👀 waiting for you'
    default:
      return ''
  }
}
