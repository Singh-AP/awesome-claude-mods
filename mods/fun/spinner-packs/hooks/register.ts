import type { Register } from 'claude-code'

import { PACK_IDS, PACKS, indexFor, packById, parseCustom, pastAt, pastFor, presentFor, samples, type Pack } from './packs'

// What /spinner chose, read from $.store at session start: a pack id,
// 'random' or 'off'; undefined follows the `pack` option.
let chosen: string | undefined
// The pack 'random' landed on for this session.
let rolled: Pack | undefined
// Bumped at every turn start, so each turn gets its own word.
let turnSeq = 0
// The pair the spinner last showed, and the pair each closing line took, so
// "Charting a course…" ends as "Charted a course for 51s" and stays that way.
let lastIndex: number | undefined
const closing = new Map<string, number>()

function roll(): Pack {
  rolled = PACKS[Math.floor(Math.random() * PACKS.length)]!
  return rolled
}

export const register: Register = (on, options) => {
  const custom = parseCustom(String(options.custom ?? ''))
  const optionPack = String(options.pack ?? 'random')
  const themeClosingLine = options.themeClosingLine !== false

  const setting = (): string => chosen ?? optionPack

  const currentPack = (): Pack | undefined => {
    if (custom !== undefined) return custom
    const id = setting()
    if (id === 'off') return undefined
    if (id === 'random') return rolled ?? roll()
    return packById(id) ?? rolled ?? roll()
  }

  on('session.start', async ($, e, next) => {
    const stored = await $.store.get('pack')
    chosen = typeof stored === 'string' ? stored : undefined
    await $.command.register({
      name: 'spinner',
      description: 'Pick the spinner word pack: /spinner <pack|random|off|reset>',
      argumentHint: '[pack]',
      immediate: true,
    })
    return next(e)
  })

  on('turn.start', ($, e, next) => {
    turnSeq += 1
    $.ui.invalidate('ui.render')
    return next(e)
  })

  // The line that animates while Claude works.
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    const pack = currentPack()
    // A state that overrides the word (compacting, retrying) keeps its text.
    if (pack === undefined || e.props.message !== null) return next(e)
    // The desktop's row names the step it is on; only its idle "Working" is ours.
    if (e.surface === 'desktop' && e.props.word !== 'Working') return next(e)
    lastIndex = indexFor(pack, `${turnSeq}:${e.requestId}`)
    return next({ ...e, props: { ...e.props, word: pack.words[lastIndex]![0] } })
  })

  // The line that closes a turn ("Plundered for 1m 3s"), terminal only.
  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    const pack = currentPack()
    if (pack === undefined || !themeClosingLine) return next(e)
    let index = closing.get(e.requestId)
    if (index === undefined && lastIndex !== undefined) {
      index = lastIndex
      closing.set(e.requestId, index)
      if (closing.size > 500) closing.delete(closing.keys().next().value!)
    }
    const word = (index !== undefined ? pastAt(pack, index) : undefined) ?? pastFor(pack, e.requestId)
    if (word === undefined) return next(e)
    return next({ ...e, props: { ...e.props, word } })
  })

  on('command.run', { command: 'spinner' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()

    if (arg === '' || arg === 'list') {
      const now = currentPack()
      const current = custom !== undefined
        ? 'custom words (from the `custom` option)'
        : setting() === 'off'
          ? 'off (Claude Code’s own words)'
          : setting() === 'random'
            ? `random, ${now?.emoji ?? ''} ${now?.id ?? ''} this session`
            : `${now?.emoji ?? ''} ${now?.id ?? ''}`
      const rows = PACKS.map(p => `  ${p.emoji} ${p.id.padEnd(12)} ${samples(p).join(' · ')}…`)
      return {
        text: [
          `Spinner pack: ${current}.`,
          '',
          ...rows,
          '',
          'Switch with /spinner <pack>, /spinner random, /spinner off, or /spinner reset (back to your setting).',
        ].join('\n'),
      }
    }

    if (arg === 'reset') {
      chosen = undefined
      await $.store.delete('pack')
    } else if (arg === 'random') {
      chosen = 'random'
      roll()
      await $.store.set('pack', chosen)
    } else if (arg === 'off') {
      chosen = 'off'
      await $.store.set('pack', chosen)
    } else if (packById(arg) !== undefined) {
      chosen = arg
      await $.store.set('pack', chosen)
    } else {
      return { text: `No pack named "${arg}". Packs: ${PACK_IDS.join(', ')}, or random, off, reset.` }
    }

    $.ui.invalidate('ui.render')
    const pack = currentPack()
    if (custom !== undefined) return { text: 'Saved, but your `custom` words win while that option is set.' }
    if (pack === undefined) return { text: 'Spinner pack off: Claude Code’s own words are back.' }
    const label = chosen === undefined ? `back to your setting (${optionPack})` : `${pack.emoji} ${pack.title}`
    return { text: `Spinner pack: ${label}. For example: ${samples(pack, 2).join(', ')}…` }
  })
}
