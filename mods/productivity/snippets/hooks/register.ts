import type { EngineInterface, Register } from 'claude-code'

import { expand, listing, merged, parseSnip, placeholders, STARTERS } from './snippets'

type Saved = { own: Record<string, string>; hidden: string[] }

async function loadSnippets($: EngineInterface): Promise<Saved> {
  const own = ((await $.store.get('snippets')) as Record<string, string> | undefined) ?? {}
  const hidden = ((await $.store.get('hidden')) as string[] | undefined) ?? []
  return { own, hidden }
}

/** Fetches only the values the template names. */
async function valuesFor($: EngineInterface, template: string, extra: string): Promise<Record<string, string>> {
  const wanted = placeholders(template)
  const values: Record<string, string> = { args: extra }
  if (wanted.has('selection')) values.selection = (await $.ui.selection())?.text ?? ''
  if (wanted.has('date')) values.date = new Date(await $.clock.now()).toISOString().slice(0, 10)
  if (wanted.has('branch')) {
    const git = await $.process
      .run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], { timeoutMs: 3000 })
      .catch(() => undefined)
    const branch = git?.exitCode === 0 ? git.stdout.trim() : ''
    values.branch = branch === 'HEAD' ? '' : branch
  }
  return values
}

async function useSnippet($: EngineInterface, name: string, extra: string) {
  const { own, hidden } = await loadSnippets($)
  const all = merged(own, hidden)
  const template = all[name]
  if (template === undefined) {
    return { text: `No snippet named "${name}". ${Object.keys(all).length > 0 ? `Try: ${Object.keys(all).sort().join(', ')}.` : ''}` }
  }

  const text = expand(template, await valuesFor($, template, extra))
  const box = await $.prompt.read()
  const hasDraft = box.text.trim() !== '' && !box.text.trimStart().startsWith('/snip')
  const filled = await $.prompt.fill({ text: hasDraft ? `${text} ` : text, mode: hasDraft ? 'insert' : 'replace' })
  if (filled.isFilled) {
    $.ui.toast(`/snip ${name} is in the prompt: edit it or press Enter`)
    return {}
  }
  // No prompt box (a -p run) or a dialog holds it: show the text instead.
  return { text: `Snippet "${name}":\n\n${text}` }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: 'snip',
        description: 'Put a saved prompt in the prompt box (/snip <name>), or list, save, show, rm',
        argumentHint: '<name> [extra] | save <name> <text> | show <name> | rm <name>',
      })
    } catch (error) {
      $.ui.log(`snippets: could not add /snip: ${String(error)}`, { to: 'debug' })
    }
    return next(e)
  })

  on('command.run', { command: 'snip' }, async ($, e) => {
    const command = parseSnip(e.args)
    switch (command.kind) {
      case 'error':
        return { text: command.message }
      case 'list': {
        const { own, hidden } = await loadSnippets($)
        return { text: listing(merged(own, hidden), new Set(Object.keys(own))) }
      }
      case 'show': {
        const { own, hidden } = await loadSnippets($)
        const template = merged(own, hidden)[command.name]
        return { text: template === undefined ? `No snippet named "${command.name}".` : `/snip ${command.name}:\n\n${template}` }
      }
      case 'save': {
        const { own } = await loadSnippets($)
        const existed = own[command.name] !== undefined || STARTERS[command.name] !== undefined
        await $.store.set('snippets', { ...own, [command.name]: command.text })
        return { text: `${existed ? 'Updated' : 'Saved'} /snip ${command.name}.` }
      }
      case 'rm': {
        const { own, hidden } = await loadSnippets($)
        const isOwn = own[command.name] !== undefined
        const isStarter = STARTERS[command.name] !== undefined && !hidden.includes(command.name)
        if (!isOwn && !isStarter) return { text: `No snippet named "${command.name}".` }
        if (isOwn) {
          const { [command.name]: _gone, ...rest } = own
          await $.store.set('snippets', rest)
        }
        // Removing a name hides its starter too, so it doesn't come back.
        if (STARTERS[command.name] !== undefined && !hidden.includes(command.name)) {
          await $.store.set('hidden', [...hidden, command.name])
        }
        return { text: `Removed /snip ${command.name}.` }
      }
      case 'use':
        return useSnippet($, command.name, command.extra)
    }
  })
}
