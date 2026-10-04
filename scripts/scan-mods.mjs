#!/usr/bin/env node
// Keeps data/mods.json, the index of every public Claude Code mod, fresh.
//
//   GH_TOKEN=... node scripts/scan-mods.mjs [--budget-min 20] [--limit N] [--dry-run]
//                                           [--no-refresh] [--no-discover] [--recategorize]
//   node scripts/scan-mods.mjs --from-seed <claude_mods.json> [--sources <modsrc.jsonl>]
//   node scripts/scan-mods.mjs --import-verdicts <claude_mods.json> [--verified <verified.jsonl>]
//
// 1. Refresh: re-reads stars, push date, license and description of every
//    indexed repo through GraphQL, checks each mod's folder is still there,
//    and drops deleted, archived or moved mods.
// 2. Discover: GitHub code search for hooks.json files that list `modules`
//    and for modules importing 'claude-code', split by file size to get past
//    the search API's 1,000-result cap.
// 3. Verify: for each new hit, reads hooks.json, plugin.json and the module,
//    keeps it only if `modules` names a JS/TS file, extracts its events,
//    components and `$` calls, and skips copies (same source fingerprint as a
//    mod in an older repo), forks, fixtures, templates and mirrors.
// 4. Writes data/mods.json, data/stats.json and data/candidates.json (hits
//    already judged, so a daily run doesn't re-verify them).
//
// firstSeen: a mod found by a scan gets that scan's date. Entries from the
// 2026-10-04 seed got their repo's creation date, but never before
// 2026-09-01 (INDEX_EPOCH), when mods were first visible.
//
// With no token it changes nothing and exits 0.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  buildStats,
  categorize,
  dateOf,
  dirname,
  findCopies,
  inspectModule,
  joinPath,
  keyOf,
  kindOf,
  modDir,
  modulesOf,
  record,
  seedFirstSeen,
  serializeRecords,
  sortRecords,
  sourceHash,
  STICKY_VERDICTS,
} from './lib/mods-index.mjs'

const root = join(fileURLToPath(import.meta.url), '..', '..')
const DATA = join(root, 'data')
const MODS = join(DATA, 'mods.json')
const STATS = join(DATA, 'stats.json')
const CANDIDATES = join(DATA, 'candidates.json')

const args = process.argv.slice(2)
const flag = name => args.includes(`--${name}`)
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`)
  return at >= 0 && args[at + 1] !== undefined ? args[at + 1] : fallback
}

const isDryRun = flag('dry-run')
const limit = Number(option('limit', Infinity))
const budgetMs = Number(option('budget-min', 20)) * 60_000
const startedAt = Date.now()
const today = option('today', new Date().toISOString().slice(0, 10))
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || ''

const log = (...parts) => console.log(`[${((Date.now() - startedAt) / 1000).toFixed(0).padStart(4)}s]`, ...parts)
// Discovery stops at 75% of the budget so verification always gets a turn.
const isOverBudget = (share = 1) => Date.now() - startedAt > budgetMs * share
const DISCOVERY_SHARE = 0.75
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

function writeOutputs(records, candidates) {
  const sorted = sortRecords(records)
  const stats = buildStats(sorted, today)
  if (isDryRun) {
    log(`dry run: would write ${sorted.length} mods`, JSON.stringify(stats))
    return
  }
  mkdirSync(DATA, { recursive: true })
  writeFileSync(MODS, serializeRecords(sorted))
  writeFileSync(STATS, JSON.stringify(stats, null, 2) + '\n')
  if (candidates !== undefined) {
    const entries = Object.entries(candidates).sort(([a], [b]) => a.localeCompare(b))
    writeFileSync(CANDIDATES, `{\n${entries.map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n')}\n}\n`)
  }
  log(`wrote ${sorted.length} mods in ${stats.repos} repos`)
}

// ── Seed import ────────────────────────────────────────────────────────────

if (option('from-seed', null) !== null) {
  const seed = JSON.parse(readFileSync(option('from-seed'), 'utf8'))
  const sourcesPath = option('sources', null)
  const heads = new Map()
  if (sourcesPath !== null && existsSync(sourcesPath)) {
    for (const line of readFileSync(sourcesPath, 'utf8').split('\n')) {
      if (line.trim() === '') continue
      const s = JSON.parse(line)
      if (s.head) heads.set(`${s.repo}:${s.module_path}`, s.head)
    }
  }
  const records = seed
    .filter(s => ['mod', 'official', 'builtin'].includes(s.kind))
    .map(s => {
      const head = heads.get(`${s.repo}:${s.module_path}`)
      const fields = {
        name: s.name,
        repo: s.repo,
        path: s.dir,
        url: s.url,
        description: s.description || s.repo_description || '',
        stars: s.stars,
        license: s.license,
        pushedAt: s.repo_pushed,
        createdAt: s.repo_created,
        events: s.events ?? [],
        components: s.components ?? [],
        calls: s.calls ?? [],
        marketplace: s.marketplace_json,
        module: s.module_path ?? null,
        hash: head ? sourceHash(head) : null,
        firstSeen: seedFirstSeen(s.repo_created),
      }
      return record({ ...fields, category: categorize(fields) })
    })
  const copies = findCopies(records)
  const kept = records.filter(r => !copies.has(keyOf(r)))
  log(`seed: ${kept.length} mods (${heads.size} module sources, ${copies.size} more copies set aside)`)
  writeOutputs(kept, {})
  process.exit(0)
}

// One-off: carry the 2026-10-04 research's verdicts into data/candidates.json,
// so the scanner doesn't re-judge 2,600 hits, and drop indexed entries the
// research had set aside (copies, catalogues, mirrors).
if (option('import-verdicts', null) !== null) {
  const seed = JSON.parse(readFileSync(option('import-verdicts'), 'utf8'))
  const verifiedPath = option('verified', null)
  const candidates = existsSync(CANDIDATES) ? JSON.parse(readFileSync(CANDIDATES, 'utf8')) : {}
  const hooksPathOf = new Map()
  let notMods = 0
  if (verifiedPath !== null) {
    for (const line of readFileSync(verifiedPath, 'utf8').split('\n')) {
      if (line.trim() === '') continue
      let v
      try {
        v = JSON.parse(line)
      } catch {
        continue
      }
      hooksPathOf.set(`${v.repo}:${v.dir}`, v.hooks_path)
      const key = `${v.repo}:${v.hooks_path}`
      const isMod = Array.isArray(v.modules) && v.modules.some(m => typeof m === 'string' && /\.(m?[jt]sx?|c[jt]s|mts|cts)$/.test(m))
      if (!isMod && candidates[key] === undefined) {
        candidates[key] = { verdict: v.exists === false ? 'gone' : 'not-a-mod', on: '2026-10-04' }
        notMods++
      }
    }
  }
  const setAside = new Map()
  for (const s of seed) {
    if (['mod', 'official', 'builtin'].includes(s.kind)) continue
    const verdict = s.kind === 'copy?' ? 'copy' : s.kind
    const hooksPath = hooksPathOf.get(`${s.repo}:${s.dir}`) ?? (s.dir === '.' ? 'hooks/hooks.json' : `${s.dir}/hooks/hooks.json`)
    candidates[`${s.repo}:${hooksPath}`] = { verdict, on: '2026-10-04' }
    setAside.set(`${s.repo}:${s.dir}`, verdict)
  }
  let records = existsSync(MODS) ? JSON.parse(readFileSync(MODS, 'utf8')) : []
  const before = records.length
  records = records.filter(r => !setAside.has(keyOf(r)))
  const copies = findCopies(records)
  records = records.filter(r => !copies.has(keyOf(r)))
  log(`imported ${setAside.size} set-aside verdicts and ${notMods} not-a-mod verdicts; dropped ${before - records.length} indexed entries (${copies.size} by copy detection)`)
  writeOutputs(records, candidates)
  process.exit(0)
}

if (token === '') {
  console.log('scan-mods: no GH_TOKEN or GITHUB_TOKEN, so nothing was refreshed.')
  process.exit(0)
}

// ── GitHub I/O ─────────────────────────────────────────────────────────────

const HEADERS = {
  authorization: `Bearer ${token}`,
  accept: 'application/vnd.github+json',
  'user-agent': 'awesome-claude-mods-scanner',
  'x-github-api-version': '2022-11-28',
}

async function waitForReset(response) {
  const reset = Number(response.headers.get('x-ratelimit-reset') ?? 0) * 1000
  const retryAfter = Number(response.headers.get('retry-after') ?? 0) * 1000
  const wait = Math.max(retryAfter, reset - Date.now(), 15_000)
  log(`rate limited, waiting ${Math.round(wait / 1000)}s`)
  await sleep(Math.min(wait, 120_000))
}

async function graphql(query, attempts = 4) {
  for (let i = 0; i < attempts; i++) {
    const response = await fetch('https://api.github.com/graphql', { method: 'POST', headers: HEADERS, body: JSON.stringify({ query }) })
    if (response.status === 403 || response.status === 429 || response.status === 502) {
      await waitForReset(response)
      continue
    }
    const body = await response.json().catch(() => null)
    if (body?.data !== undefined && body.data !== null) return body
    log(`graphql retry ${i + 1}: ${response.status} ${JSON.stringify(body?.errors ?? body)?.slice(0, 200)}`)
    await sleep(5000 * (i + 1))
  }
  return { data: null, errors: [{ type: 'FAILED' }] }
}

const q = JSON.stringify

/** Repo metadata plus whether each named mod folder still exists. */
async function readRepos(repos) {
  const out = new Map()
  for (let i = 0; i < repos.length; i += 80) {
    const batch = repos.slice(i, i + 80)
    const parts = batch.map(({ repo, files }, j) => {
      const [owner, name] = repo.split('/')
      const objects = files.map((f, k) => `f${k}: object(expression: ${q(`HEAD:${f}`)}) { __typename }`).join(' ')
      return `r${j}: repository(owner: ${q(owner)}, name: ${q(name)}) { nameWithOwner stargazerCount pushedAt createdAt isArchived isFork description licenseInfo { spdxId } ${objects} }`
    })
    const body = await graphql(`query { ${parts.join('\n')} }`)
    const notFound = new Set((body.errors ?? []).filter(e => e.type === 'NOT_FOUND').map(e => e.path?.[0]))
    batch.forEach(({ repo, files }, j) => {
      const r = body.data?.[`r${j}`]
      if (r) out.set(repo, { ...r, present: files.map((_, k) => r[`f${k}`] !== null) })
      else if (notFound.has(`r${j}`)) out.set(repo, null)
      // Any other failure: leave the repo out, so its entries are kept as they were.
    })
    if (i + 80 < repos.length) log(`refreshed ${i + batch.length}/${repos.length} repos`)
  }
  return out
}

let lastSearch = 0
let searchDisabled = false

async function searchCode(query, page) {
  const gap = 6700 - (Date.now() - lastSearch)
  if (gap > 0) await sleep(gap)
  for (let i = 0; i < 4; i++) {
    lastSearch = Date.now()
    const url = `https://api.github.com/search/code?q=${encodeURIComponent(query)}&per_page=100&page=${page}`
    const response = await fetch(url, { headers: HEADERS })
    if (response.ok) return response.json()
    if (response.status === 401 || response.status === 422 || (response.status === 403 && response.headers.get('x-ratelimit-remaining') !== '0')) {
      const text = await response.text()
      if (/rate limit/i.test(text) && i < 3) {
        await waitForReset(response)
        continue
      }
      log(`code search unavailable (${response.status}): ${text.slice(0, 160)}; skipping discovery`)
      searchDisabled = true
      return { total_count: 0, items: [] }
    }
    if (response.status === 403 || response.status === 429) {
      await waitForReset(response)
      continue
    }
    log(`code search ${response.status}, retry ${i + 1}`)
    await sleep(10_000)
  }
  return { total_count: 0, items: [] }
}

const SIZE_BANDS = [[0, 100], [101, 150], [151, 200], [201, 300], [301, 500], [501, 1000], [1001, 3000], [3001, 10000], [10001, null]]
const CAP = 1000 // the search API returns at most 1,000 results per query

function addHits(hits, items) {
  for (const item of items ?? []) hits.set(`${item.repository.full_name}:${item.path}`, { repo: item.repository.full_name, path: item.path })
}

/** Every page of one query, once page 1 is in hand. */
async function drain(query, first, hits) {
  addHits(hits, first.items)
  const pages = Math.min(Math.ceil((first.total_count ?? 0) / 100), CAP / 100)
  for (let page = 2; page <= pages && !isOverBudget(DISCOVERY_SHARE) && !searchDisabled; page++) addHits(hits, (await searchCode(query, page)).items)
}

/** A size range; one over the cap is halved until it fits or can't be split. */
async function sizeRange(base, lo, hi, hits) {
  if (searchDisabled || isOverBudget(DISCOVERY_SHARE)) return
  const query = hi === null ? `${base} size:>=${lo}` : `${base} size:${lo}..${hi}`
  const first = await searchCode(query, 1)
  const total = first.total_count ?? 0
  if (total > CAP && (hi === null || hi > lo)) {
    const mid = hi === null ? lo * 2 : Math.floor((lo + hi) / 2)
    log(`search ${query}: ${total} results, splitting`)
    await sizeRange(base, lo, mid, hits)
    await sizeRange(base, mid + 1, hi, hits)
    return
  }
  await drain(query, first, hits)
  log(`search ${query}: ${total} results, ${hits.size} unique hits so far`)
}

async function discover() {
  const hits = new Map()
  const bases = [
    '"modules" filename:hooks.json',
    '"from \'claude-code\'" register language:TypeScript',
    '"from \'claude-code\'" register language:JavaScript',
    '"import type { Register }"',
  ]
  for (const base of bases) {
    if (searchDisabled || isOverBudget(DISCOVERY_SHARE)) break
    const first = await searchCode(base, 1)
    const total = first.total_count ?? 0
    if (total <= CAP) {
      await drain(base, first, hits)
      log(`search ${base}: ${total} results, ${hits.size} unique hits so far`)
      continue
    }
    log(`search ${base}: ${total} results, splitting by file size`)
    for (const [lo, hi] of SIZE_BANDS) await sizeRange(base, lo, hi, hits)
  }
  return [...hits.values()]
}

/** A code-search hit as the hooks.json it points at. */
function hooksPathOf(hit) {
  if (hit.path.endsWith('hooks.json')) return hit.path
  return joinPath(dirname(hit.path), 'hooks.json')
}

/** Which candidate each verified mod came from, to record a copy verdict. */
const candidateKeyOf = new Map()

async function verify(candidates) {
  const found = []
  for (let i = 0; i < candidates.length && !isOverBudget(); i += 25) {
    const batch = candidates.slice(i, i + 25)
    const parts = batch.map(({ repo, hooksPath }, j) => {
      const [owner, name] = repo.split('/')
      const dir = modDir(hooksPath)
      const pluginJson = dir === '.' ? '.claude-plugin/plugin.json' : `${dir}/.claude-plugin/plugin.json`
      return `r${j}: repository(owner: ${q(owner)}, name: ${q(name)}) { nameWithOwner stargazerCount pushedAt createdAt isArchived isFork isPrivate description url licenseInfo { spdxId } defaultBranchRef { name }
        h: object(expression: ${q(`HEAD:${hooksPath}`)}) { ... on Blob { text } }
        p: object(expression: ${q(`HEAD:${pluginJson}`)}) { ... on Blob { text } }
        m: object(expression: "HEAD:.claude-plugin/marketplace.json") { ... on Blob { byteSize } } }`
    })
    const body = await graphql(`query { ${parts.join('\n')} }`)
    // A failed batch leaves its hits unjudged, so the next run tries them again.
    if (body.data === null || body.data === undefined) continue
    const notFound = new Set((body.errors ?? []).filter(e => e.type === 'NOT_FOUND').map(e => e.path?.[0]))
    const withModule = []
    batch.forEach((candidate, j) => {
      const r = body.data[`r${j}`]
      if (!r) {
        if (notFound.has(`r${j}`)) candidate.verdict = 'gone'
        return
      }
      if (r.isArchived || r.isPrivate) return void (candidate.verdict = 'archived')
      if (r.isFork) return void (candidate.verdict = 'fork')
      const modules = r.h?.text ? modulesOf(r.h.text) : null
      if (modules === null) return void (candidate.verdict = 'not-a-mod')
      let plugin = {}
      try {
        plugin = JSON.parse(r.p?.text ?? '{}')
      } catch {}
      const dir = modDir(candidate.hooksPath)
      const name = typeof plugin.name === 'string' && plugin.name !== '' ? plugin.name : dir === '.' ? candidate.repo.split('/')[1] : dir.split('/').pop()
      const kind = kindOf(r.nameWithOwner, dir, name)
      if (kind !== 'mod' && kind !== 'official' && kind !== 'builtin') return void (candidate.verdict = kind)
      candidate.verdict = 'mod'
      withModule.push({
        candidate,
        meta: r,
        module: joinPath(dirname(candidate.hooksPath), modules[0]),
        name,
        dir,
        description: typeof plugin.description === 'string' ? plugin.description : r.description ?? '',
      })
    })
    if (withModule.length > 0) {
      const sources = await graphql(
        `query { ${withModule
          .map(({ meta, module }, j) => {
            const [owner, name] = meta.nameWithOwner.split('/')
            return `s${j}: repository(owner: ${q(owner)}, name: ${q(name)}) { o: object(expression: ${q(`HEAD:${module}`)}) { ... on Blob { text } } }`
          })
          .join('\n')} }`,
      )
      withModule.forEach((m, j) => {
        const text = sources.data?.[`s${j}`]?.o?.text ?? ''
        const inspected = inspectModule(text)
        const branch = m.meta.defaultBranchRef?.name ?? 'main'
        const fields = {
          name: m.name,
          repo: m.meta.nameWithOwner,
          path: m.dir,
          url: m.dir === '.' ? m.meta.url : `${m.meta.url}/tree/${branch}/${m.dir}`,
          description: m.description,
          stars: m.meta.stargazerCount,
          license: m.meta.licenseInfo?.spdxId ?? null,
          pushedAt: m.meta.pushedAt,
          createdAt: m.meta.createdAt,
          events: inspected.events,
          components: inspected.components,
          calls: inspected.calls,
          marketplace: m.meta.m !== null && m.meta.m !== undefined,
          module: m.module,
          hash: text !== '' ? sourceHash(text) : null,
          firstSeen: today,
        }
        const entry = record({ ...fields, category: categorize(fields) })
        candidateKeyOf.set(keyOf(entry), m.candidate.key)
        found.push(entry)
      })
    }
    log(`verified ${Math.min(i + 25, candidates.length)}/${candidates.length} candidates, ${found.length} new mods`)
  }
  return found
}

// ── Main ───────────────────────────────────────────────────────────────────

if (!existsSync(MODS)) {
  console.error('scan-mods: data/mods.json is missing; build it once with --from-seed')
  process.exit(1)
}

let records = JSON.parse(readFileSync(MODS, 'utf8'))
const candidates = existsSync(CANDIDATES) ? JSON.parse(readFileSync(CANDIDATES, 'utf8')) : {}
log(`loaded ${records.length} mods, ${Object.keys(candidates).length} judged candidates`)

if (!flag('no-refresh')) {
  const byRepo = new Map()
  for (const r of records) {
    const entry = byRepo.get(r.repo) ?? { repo: r.repo, files: [] }
    // The folder, not the module: some modules are build output that isn't committed.
    if (r.path !== '.' && !entry.files.includes(r.path)) entry.files.push(r.path)
    byRepo.set(r.repo, entry)
  }
  const repos = [...byRepo.values()].slice(0, limit)
  const meta = await readRepos(repos)
  const dropped = []
  const next = []
  for (const r of records) {
    if (!meta.has(r.repo)) {
      next.push(r)
      continue
    }
    const m = meta.get(r.repo)
    if (m === null || m.isArchived) {
      dropped.push(`${keyOf(r)} (${m === null ? 'repo gone' : 'archived'})`)
      continue
    }
    const fileIndex = byRepo.get(r.repo).files.indexOf(r.path)
    if (fileIndex >= 0 && m.present[fileIndex] === false) {
      dropped.push(`${keyOf(r)} (folder gone)`)
      continue
    }
    const renamed = m.nameWithOwner !== r.repo
    next.push(
      record({
        ...r,
        repo: m.nameWithOwner,
        url: renamed ? r.url.replace(`github.com/${r.repo}`, `github.com/${m.nameWithOwner}`) : r.url,
        stars: m.stargazerCount,
        pushedAt: m.pushedAt,
        license: m.licenseInfo?.spdxId ?? null,
        description: r.description || m.description || '',
      }),
    )
  }
  log(`refresh: ${meta.size}/${repos.length} repos read, ${dropped.length} mods dropped`)
  for (const line of dropped.slice(0, 20)) log(`  dropped ${line}`)
  records = next
}

if (flag('recategorize')) {
  records = records.map(r => record({ ...r, category: categorize(r) }))
  log('recategorized every mod')
}

if (!flag('no-discover') && !isOverBudget(DISCOVERY_SHARE)) {
  const known = new Set(records.map(r => `${r.repo}:${r.path}`))
  const hits = await discover()
  const fresh = []
  for (const hit of hits) {
    const hooksPath = hooksPathOf(hit)
    const key = `${hit.repo}:${hooksPath}`
    if (known.has(`${hit.repo}:${modDir(hooksPath)}`)) continue
    const judged = candidates[key]
    // Re-judge a rejected hit once a month, in case it became a mod; a copy stays a copy.
    if (judged !== undefined && (STICKY_VERDICTS.has(judged.verdict) || Date.parse(today) - Date.parse(judged.on) < 30 * 86_400_000)) continue
    if (fresh.some(c => c.repo === hit.repo && c.hooksPath === hooksPath)) continue
    fresh.push({ repo: hit.repo, hooksPath, key })
  }
  const toVerify = fresh.slice(0, limit)
  log(`discover: ${hits.length} hits, ${fresh.length} new candidates, verifying ${toVerify.length}`)
  const found = await verify(toVerify)
  for (const c of toVerify) if (c.verdict !== undefined) candidates[c.key] = { verdict: c.verdict, on: today }

  // A new find can be a copy of an indexed mod, never the other way round:
  // repo age is a poor guide to who wrote a mod, and the index has been checked.
  const all = [...records, ...found]
  const indexed = new Set(records.map(keyOf))
  const copies = new Set([...findCopies(all, indexed)].filter(key => !indexed.has(key)))
  for (const key of [...copies].slice(0, 15)) log(`  copy set aside: ${key}`)
  const kept = all.filter(r => !copies.has(keyOf(r)))
  const seen = new Set()
  records = kept.filter(r => (seen.has(keyOf(r)) ? false : (seen.add(keyOf(r)), true)))
  for (const r of found) {
    const key = candidateKeyOf.get(keyOf(r))
    if (key !== undefined && copies.has(keyOf(r))) candidates[key] = { verdict: 'copy', on: today }
  }
  log(`discover: ${found.length - found.filter(r => copies.has(keyOf(r))).length} new mods kept, ${copies.size} copies set aside`)
}

writeOutputs(records, candidates)
log(`done in ${Math.round((Date.now() - startedAt) / 1000)}s`)
