#!/usr/bin/env node
// Writes .types/claude-code.d.ts and .types/claude-code-tools.d.ts from the
// Claude Code binary on this machine, so the typecheck runs against the API
// of the version you (or CI) actually run. No sign-in needed: it loads a tiny
// mod headlessly and runs its slash command, which makes Claude Code lay down
// the declarations beside it.
//
//   node scripts/gen-types.mjs        (CLAUDE_BIN picks the binary; default: this repo's own, else `claude`)

import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(fileURLToPath(import.meta.url), '..', '..')
const bin = claudeBin(root)
const work = mkdtempSync(join(tmpdir(), 'acm-types-'))
const mod = join(work, 'typegen')

mkdirSync(join(mod, '.claude-plugin'), { recursive: true })
mkdirSync(join(mod, 'hooks'))
writeFileSync(join(mod, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'typegen', version: '0.0.0', description: 'types' }))
writeFileSync(join(mod, 'hooks', 'hooks.json'), JSON.stringify({ modules: ['./register.ts'] }))
writeFileSync(
  join(mod, 'hooks', 'register.ts'),
  `export function register(on) {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'typegen', description: 'types' })
    return next(e)
  })
  on('command.run', { command: 'typegen' }, () => ({ text: 'ok' }))
}
`,
)

const run = spawnSync(bin, ['-p', '--plugin-dir', mod, '/typegen'], {
  cwd: work,
  encoding: 'utf8',
  timeout: 120_000,
  // A throwaway config dir: nothing is read from or written to yours.
  env: { ...process.env, CLAUDE_CONFIG_DIR: join(work, 'config') },
})

const types = join(mod, '.claude-plugin', 'types')
try {
  mkdirSync(join(root, '.types'), { recursive: true })
  copyFileSync(join(types, 'claude-code', 'index.d.ts'), join(root, '.types', 'claude-code.d.ts'))
  copyFileSync(join(types, 'claude-code-tools', 'index.d.ts'), join(root, '.types', 'claude-code-tools.d.ts'))
} catch (error) {
  console.error(`✘ Claude Code wrote no types (${error.code ?? error.message}).\n${run.stdout ?? ''}${run.stderr ?? ''}`)
  process.exit(1)
} finally {
  rmSync(work, { recursive: true, force: true })
}

const version = readFileSync(join(root, '.types', 'claude-code.d.ts'), 'utf8').match(/Written by Claude Code (\d+\.\d+\.\d+)/)?.[1]
console.log(`✔ .types/ written by Claude Code ${version ?? '(unknown version)'}`)

// CLAUDE_BIN if set; else this repo's own Claude Code (scripts/claude-local.sh,
// under .tools/, off PATH) when installed; else whatever `claude` is on PATH.
function claudeBin(root) {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN
  return existsSync(join(root, '.tools', 'claude-code', 'node_modules', '.bin', 'claude')) ? join(root, 'scripts', 'claude-local.sh') : 'claude'
}
