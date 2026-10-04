#!/usr/bin/env node
// Checks out one community mod at its current commit and runs the official
// validator on it, so the daily agent can pin it in the marketplace.
//
//   node scripts/daily/vet.mjs <owner/repo> [path/in/repo]
//
// Prints VET_OK with the sha, plugin name and the validator's hooks/calls
// lines, or VET_FAIL with the reason. CLAUDE_BIN picks the binary.

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const [repo, dir = ''] = process.argv.slice(2)
if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? '') || dir.includes('..')) {
  console.error('usage: vet.mjs <owner/repo> [path/in/repo]')
  process.exit(2)
}

const work = mkdtempSync(join(tmpdir(), 'acm-vet-'))
const fail = reason => {
  console.log(`VET_FAIL ${repo}${dir ? `/${dir}` : ''}: ${reason}`)
  rmSync(work, { recursive: true, force: true })
  process.exit(1)
}

try {
  const git = (...args) => execFileSync('git', args, { cwd: work, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 }).trim()
  git('clone', '--quiet', '--filter=blob:none', '--no-checkout', `https://github.com/${repo}.git`, 'repo')
  const repoDir = join(work, 'repo')
  const inRepo = (...args) => execFileSync('git', args, { cwd: repoDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 }).trim()
  const sha = inRepo('rev-parse', 'HEAD')
  if (dir !== '') inRepo('sparse-checkout', 'set', '--no-cone', `/${dir}/`)
  inRepo('checkout', '--quiet', sha)

  const pluginDir = join(repoDir, dir)
  const manifest = join(pluginDir, '.claude-plugin', 'plugin.json')
  if (!existsSync(manifest)) fail('no .claude-plugin/plugin.json there')
  const name = JSON.parse(readFileSync(manifest, 'utf8')).name
  const hooks = join(pluginDir, 'hooks', 'hooks.json')
  if (!existsSync(hooks) || !Array.isArray(JSON.parse(readFileSync(hooks, 'utf8')).modules)) fail('hooks/hooks.json lists no modules: not a mod')

  const run = spawnSync(process.env.CLAUDE_BIN || 'claude', ['plugin', 'validate', '--json', pluginDir], { encoding: 'utf8', timeout: 120_000 })
  let report
  try {
    report = JSON.parse(run.stdout)
  } catch {
    fail(`validator gave no report: ${(run.stderr || run.stdout).slice(0, 300)}`)
  }
  if (report.success !== true) fail(`validator refused it: ${JSON.stringify(report).slice(0, 400)}`)

  const notes = (report.contents ?? []).flatMap(c => c.notes ?? [])
  console.log(`VET_OK ${repo}${dir ? `/${dir}` : ''}`)
  console.log(`sha: ${sha}`)
  console.log(`name: ${name}`)
  for (const note of notes) console.log(`analyzer: ${note}`)
  const source = dir === ''
    ? { source: 'github', repo, sha }
    : { source: 'git-subdir', url: `https://github.com/${repo}.git`, path: dir, sha }
  console.log(`marketplace: ${JSON.stringify({ name, source })}`)
} catch (error) {
  fail(String(error.message ?? error).split('\n')[0])
}
rmSync(work, { recursive: true, force: true })
