#!/usr/bin/env node
// Runs `claude plugin validate --strict` or `claude plugin test` on every mod
// in the repo (or the ones named on the command line) and summarises.
//
//   node scripts/each-mod.mjs validate [mod-name...]
//   node scripts/each-mod.mjs test [mod-name...]
//
// CLAUDE_BIN picks the Claude Code binary (default: `claude` on PATH).

import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(fileURLToPath(import.meta.url), '..', '..')
const bin = process.env.CLAUDE_BIN || 'claude'
const args = process.argv.slice(2)
const shouldUpdateCount = args.includes('--update-count')
const [action, ...only] = args.filter(a => !a.startsWith('--'))

if (action !== 'validate' && action !== 'test') {
  console.error('usage: each-mod.mjs validate|test [mod-name...]')
  process.exit(2)
}

export function findMods(base = join(root, 'mods')) {
  const mods = []
  for (const category of readdirSync(base, { withFileTypes: true })) {
    if (!category.isDirectory()) continue
    for (const mod of readdirSync(join(base, category.name), { withFileTypes: true })) {
      const dir = join(base, category.name, mod.name)
      if (mod.isDirectory() && existsSync(join(dir, '.claude-plugin', 'plugin.json'))) mods.push(dir)
    }
  }
  return mods.sort()
}

const mods = findMods().filter(dir => only.length === 0 || only.some(name => dir.endsWith(`/${name}`)))
const failed = []
let testTotal = 0

if (action === 'validate') {
  const marketplace = spawnSync(bin, ['plugin', 'validate', '--strict', root], { encoding: 'utf8' })
  if (marketplace.status !== 0) failed.push(['marketplace', marketplace.stdout + marketplace.stderr])
  else console.log('✔ marketplace')
}

for (const dir of mods) {
  const args = action === 'validate' ? ['plugin', 'validate', '--strict', dir] : ['plugin', 'test', dir]
  const run = spawnSync(bin, args, { encoding: 'utf8', cwd: dir })
  const name = relative(root, dir)
  if (run.status === 0) {
    const passed = Number(run.stdout.match(/(\d+) pass/)?.[1] ?? 0)
    testTotal += passed
    const tally = action === 'test' ? `${passed} tests` : 'valid'
    console.log(`✔ ${name} (${tally})`)
  } else {
    console.log(`✘ ${name}`)
    failed.push([name, run.stdout + run.stderr])
  }
}

for (const [name, output] of failed) console.error(`\n── ${name} ──\n${output.trim()}`)

// `--update-count` records the total in registry.json, which feeds the README badge.
if (action === 'test' && shouldUpdateCount && failed.length === 0 && only.length === 0) {
  const path = join(root, 'registry.json')
  const registry = JSON.parse(readFileSync(path, 'utf8'))
  registry.testCount = testTotal
  writeFileSync(path, JSON.stringify(registry, null, 2) + '\n')
  console.log(`registry.json testCount = ${testTotal}`)
}
console.log(`\n${mods.length - failed.filter(([n]) => n !== 'marketplace').length}/${mods.length} mods passed ${action}`)
process.exit(failed.length === 0 ? 0 : 1)
