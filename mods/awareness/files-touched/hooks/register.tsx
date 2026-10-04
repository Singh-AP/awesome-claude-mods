import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { TRACKED, bandLine, byRecent, changeOf, delta, listText, mention, merge, relativeTo, tableText, totals } from './changes'

const PANE = 'files-touched'
const TITLE = 'Files touched'

// $.state, so /clear, /resume and /branch start the list over.
const files = atom({ plugin: 'files-touched', key: 'files' } as const, [])

async function remember($: EngineInterface, tool: string, input: Record<string, unknown>, result: unknown) {
  const change = changeOf(tool, input, result)
  if (change === undefined) return
  const root = await $.session.root()
  const now = await $.clock.now()
  await update($, files, list => merge(list, { ...change, path: relativeTo(change.path, root) }, now))
}

async function copyList($: EngineInterface, surface?: Parameters<EngineInterface['ui']['copy']>[0]['surface']) {
  const list = await read($, files)
  if (list.length === 0) return 'No files changed yet this session.'
  const copied = await $.ui.copy(surface === undefined ? { text: listText(list) } : { text: listText(list), surface })
  return copied.isCopied
    ? `Copied ${list.length} path${list.length === 1 ? '' : 's'} to the clipboard.`
    : `Could not copy: ${copied.reason}.`
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'touched',
      description: 'Files Claude changed this session: /touched [pane|copy|clear]',
      argumentHint: '[pane|copy|clear]',
      immediate: true,
    })
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    const tool = String(e.tool)
    if (TRACKED.has(tool) && ran.deny === undefined && ran.isError !== true) {
      await remember($, tool, e as unknown as Record<string, unknown>, ran.result)
    }
    return ran
  })

  on('command.run', { command: 'touched' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'clear' || arg === 'reset') {
      await update($, files, () => [])
      return { text: 'Cleared the list of touched files.' }
    }
    if (arg === 'copy') return { text: await copyList($) }
    if (arg === 'pane' || arg === 'open') {
      const opened = await $.ui.open({ id: PANE, title: TITLE })
      return opened.isPlaced ? {} : { text: `The pane is waiting for room: ${opened.reason}.` }
    }
    if (arg === 'close') {
      await $.ui.close({ id: PANE })
      return {}
    }
    return { text: tableText(await read($, files)) }
  })

  if (options.band !== false) {
    on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
      if (e.props.hasSurvey) return next(e)
      const list = await read($, files)
      if (list.length === 0) return next(e)

      const { Box, Text } = $.ui.resolve(e)
      const theirs = await next(e)
      return (
        <Box flexDirection="column">
          <Text dimColor wrap="truncate-end">
            {bandLine(list, Math.max(10, e.props.bodyColumns))}
          </Text>
          {theirs}
        </Box>
      )
    })
  }

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const list = byRecent(await read($, files))
    const sum = totals(list)
    const width = Math.max(20, e.props.bodyColumns)

    return (
      <Box flexDirection="column">
        <Text bold wrap="truncate-end">
          {list.length === 0
            ? 'No files changed yet.'
            : `${list.length} file${list.length === 1 ? '' : 's'} · +${sum.added} −${sum.removed} · press one to @mention it`}
        </Text>
        <Box flexDirection="row" columnGap={1}>
          <Button key="copy" label="Copy paths" hotkey="y" onPress={press => copyList($, press.surface).then(text => $.ui.toast(text))} />
          <Button key="clear" label="Clear" hotkey="c" onPress={() => update($, files, () => [])} />
          <Button key="close" label="Close" hotkey="x" role="dismiss" onPress={() => $.ui.close({ id: PANE })} />
        </Box>
        {list.map((file, i) => {
          const tag = `${file.created ? 'new ' : ''}${delta(file)}`
          const room = Math.max(4, width - tag.length - 6)
          const shown = file.path.length > room ? `…${file.path.slice(-(room - 1))}` : file.path
          return (
            <Box key={`row:${file.path}`} flexDirection="row" columnGap={1}>
              <Button
                key={`file:${file.path}`}
                label={shown}
                plain
                {...(i < 9 ? { hotkey: String(i + 1) } : {})}
                onPress={() => $.prompt.fill({ text: mention(file.path), mode: 'insert' })}
              />
              <Text color={file.created ? 'green' : undefined} dimColor={!file.created}>
                {tag}
              </Text>
            </Box>
          )
        })}
      </Box>
    )
  })
}
