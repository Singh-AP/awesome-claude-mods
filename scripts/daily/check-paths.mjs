#!/usr/bin/env node
// Fails when the daily agent's changes touch anything outside what it may
// change (see ALLOWED in lib.mjs): workflows, scripts, the site and the build
// config stay out of its reach, so it can't weaken the checks that judge it.
//
//   node scripts/daily/check-paths.mjs            checks `git status` of the working tree
//   node scripts/daily/check-paths.mjs --stdin < paths    checks a newline-separated list

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

import { checkPaths } from './lib.mjs'

function changedPaths() {
  const entries = execFileSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], { encoding: 'utf8' }).split('\0')
  const paths = []
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    if (!entry) continue
    paths.push(entry.slice(3))
    // A rename or copy is followed by its original path: that one changed too.
    if (entry[0] === 'R' || entry[0] === 'C') paths.push(entries[++i] ?? '')
  }
  return paths.filter(Boolean)
}

const paths = process.argv.includes('--stdin') ? readFileSync(0, 'utf8').split('\n').filter(Boolean) : changedPaths()

const { allowed, refused } = checkPaths(paths)
for (const p of allowed) console.log(`  ok  ${p}`)
for (const p of refused) console.log(`  ✘   ${p}`)
if (refused.length > 0) {
  console.error(`\n✘ ${refused.length} path(s) the daily agent may not change.`)
  process.exit(1)
}
console.log(`\n✔ ${allowed.length} changed path(s), all allowed`)
