import type { EngineInterface, Register } from 'claude-code'

import {
  baseName,
  commitSubject,
  dayLabel,
  dayOf,
  DAY_PREFIX,
  expiredKeys,
  isGitCommit,
  journalDays,
  journalText,
  relativeTo,
  standupPrompt,
  SYSTEM,
  withEntry,
  type Entry,
} from './journal'

// Prompts from these origins are the person's own words.
const PERSON = new Set(['composer', 'bridge', 'sdk'])

// What the running turn has done so far; reset when it completes.
let prompt = ''
let files: string[] = []
let commits: string[] = []

async function whereWeAre($: EngineInterface): Promise<{ project: string; root: string }> {
  try {
    const repo = await $.session.repo()
    if (repo !== null) return { project: baseName(repo.root), root: repo.root }
  } catch {
    // Not a repository, or git is missing: the folder names the project.
  }
  const root = await $.session.root()
  return { project: baseName(root), root }
}

async function readDay($: EngineInterface, day: string): Promise<Entry[]> {
  const value = await $.store.get(DAY_PREFIX + day)
  return Array.isArray(value) ? (value as Entry[]) : []
}

/** The newest `count` journal days, oldest first. */
async function recentDays($: EngineInterface, count: number): Promise<{ day: string; entries: Entry[] }[]> {
  const days = journalDays(await $.store.keys()).slice(0, count).reverse()
  const out: { day: string; entries: Entry[] }[] = []
  for (const day of days) {
    const entries = await readDay($, day)
    if (entries.length > 0) out.push({ day, entries })
  }
  return out
}

async function record($: EngineInterface, durationMs: number): Promise<void> {
  const now = await $.clock.now()
  const today = dayOf(now)
  const { project, root } = await whereWeAre($)
  const entry: Entry = {
    at: now,
    project,
    prompt,
    files: files.map(f => relativeTo(f, root)),
    commits,
    durationMs,
  }
  await $.store.set(DAY_PREFIX + today, withEntry(await readDay($, today), entry))
  for (const key of expiredKeys(await $.store.keys(), today)) await $.store.delete(key)
}

export const register: Register = (on, options) => {
  const model = String(options.model ?? 'haiku')

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'standup',
      description: 'Write your standup from what you did with Claude: /standup [raw [days] | copy | clear]',
      argumentHint: '[raw [days] | copy | clear]',
    })
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (PERSON.has(e.origin.kind) && !e.text.trimStart().startsWith('/')) {
      // A prompt typed into a running turn adds to it; a new turn starts fresh.
      prompt = e.turnId !== undefined && prompt !== '' ? `${prompt} / ${e.text}` : e.text
      if (e.turnId === undefined) {
        files = []
        commits = []
      }
    }
    return next(e)
  })

  on('tool.call', { tool: ['Edit', 'Write', 'NotebookEdit', 'Bash'] }, async ($, e, next) => {
    const out = await next(e)
    if (out.deny !== undefined || out.isError === true) return out
    if (e.tool === 'Edit' || e.tool === 'Write') files.push(e.file_path)
    else if (e.tool === 'NotebookEdit') files.push(e.notebook_path)
    else if (e.tool === 'Bash' && isGitCommit(e.command)) {
      const subject = commitSubject(e.command, out.text ?? '')
      if (subject !== undefined) commits.push(subject)
    }
    return out
  })

  on('turn.complete', async ($, e, next) => {
    const out = await next(e)
    if (e.agentId !== undefined) return out
    const hasWork = prompt !== '' || files.length > 0 || commits.length > 0
    if (hasWork) {
      try {
        await record($, e.durationMs)
      } catch {
        // A full or unreadable store must never break a turn.
      }
    }
    prompt = ''
    files = []
    commits = []
    return out
  })

  on('command.run', { command: 'standup' }, async ($, e) => {
    const [verb = '', arg = ''] = e.args.trim().split(/\s+/)
    const today = dayOf(await $.clock.now())

    if (verb === 'clear') {
      const keys = (await $.store.keys()).filter(k => k.startsWith(DAY_PREFIX) || k === 'last')
      for (const key of keys) await $.store.delete(key)
      const days = keys.filter(k => k !== 'last').length
      return { text: `standup: cleared ${days} day${days === 1 ? '' : 's'} of journal.` }
    }

    if (verb === 'copy') {
      const last = await $.store.get('last')
      if (typeof last !== 'string' || last === '') return { text: 'standup: nothing to copy yet. Run /standup first.' }
      const copied = await $.ui.copy({ text: last })
      return { text: copied.isCopied ? 'standup: copied to your clipboard.' : `standup: could not copy (${copied.reason}).` }
    }

    if (verb === 'raw') {
      const count = Math.max(1, Math.min(14, Number.parseInt(arg, 10) || 2))
      const days = await recentDays($, count)
      if (days.length === 0) return { text: 'standup: the journal is empty. It fills up as you work.' }
      return { text: journalText(days, today) }
    }

    if (verb !== '') return { text: 'Usage: /standup, /standup raw [days], /standup copy, /standup clear' }

    // The last working day before today, and today.
    const known = journalDays(await $.store.keys())
    const picked = [known.find(d => d < today), known.includes(today) ? today : undefined]
    const days: { day: string; entries: Entry[] }[] = []
    for (const day of picked) {
      if (day === undefined) continue
      const entries = await readDay($, day)
      if (entries.length > 0) days.push({ day, entries })
    }
    if (days.length === 0) return { text: 'standup: nothing journaled yet. It records each turn from now on; come back after some work.' }

    const journal = journalText(days, today)
    const reply = await $.model.complete({
      model,
      system: SYSTEM,
      prompt: standupPrompt(journal, [...days.map(d => dayLabel(d.day, today)), 'Blockers']),
      maxTokens: 600,
      timeoutMs: 60_000,
    })
    if (!reply.isAnswered || reply.text.trim() === '') {
      const why = reply.isAnswered ? 'empty reply' : reply.reason
      return { text: `standup: the model was unavailable (${why}), so here is the journal:\n\n${journal}` }
    }
    const text = reply.text.trim()
    await $.store.set('last', text)
    return { text: `${text}\n\n(/standup copy puts it on your clipboard)` }
  })
}
