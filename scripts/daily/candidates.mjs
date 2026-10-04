#!/usr/bin/env node
// Writes automation/.work/candidates.md: the index entries the daily agent
// should review today (not curated, not reviewed before), best first.
//
//   node scripts/daily/candidates.mjs [--limit 20]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { candidatesMarkdown, pickCandidates } from './lib.mjs'

const root = join(fileURLToPath(import.meta.url), '..', '..', '..')
const at = process.argv.indexOf('--limit')
const limit = at >= 0 ? Number(process.argv[at + 1]) : 20

const readJson = (path, fallback) => (existsSync(join(root, path)) ? JSON.parse(readFileSync(join(root, path), 'utf8')) : fallback)
const index = readJson('data/mods.json', [])
const community = readJson('data/community.json', [])
const log = readJson('data/curation-log.json', [])

const today = new Date().toISOString().slice(0, 10)
const picked = pickCandidates({ index, community, log, today, limit })

mkdirSync(join(root, 'automation', '.work'), { recursive: true })
writeFileSync(join(root, 'automation', '.work', 'candidates.md'), candidatesMarkdown(picked, today) + '\n')
console.log(`wrote automation/.work/candidates.md (${picked.length} candidates from ${index.length} indexed)`)
