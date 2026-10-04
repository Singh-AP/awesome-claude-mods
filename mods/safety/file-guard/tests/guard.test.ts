import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const TYPED = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } } as const

// A tiny file system: what exists, and where each path really lands.
const FS: Record<string, string> = {
  '/': '/',
  '/work': '/work',
  '/work/src': '/work/src',
  '/work/src/a.ts': '/work/src/a.ts',
  '/work/.github': '/work/.github',
  '/work/.git': '/work/.git',
  '/work/out': '/etc', // a symlink pointing out of the project
  '/etc': '/etc',
  '/etc/hosts': '/etc/hosts',
  '/tmp': '/private/tmp',
  '/private': '/private',
  '/private/tmp': '/private/tmp',
  '/Users': '/Users',
  '/Users/me': '/Users/me',
  '/Users/me/.claude': '/Users/me/.claude',
  '/Users/me/notes': '/Users/me/notes',
  '/work/dangling': '',
}

/** The world beneath the mod: files, session, env, store, toasts and the tools. */
function world(on: On, answer?: string) {
  const seen = { ran: [] as string[], asked: [] as string[], toasts: [] as string[] }
  mock.store(on)
  mock.env(on, { HOME: '/Users/me' })
  on('session.root', () => ({ value: '/work' }))
  on('session.cwd', () => ({ value: '/work' }))
  on('fs.stat', ($, e) => {
    if (!(e.path in FS)) return { deny: `ENOENT: ${e.path}` }
    const realPath = FS[e.path] === '' ? undefined : FS[e.path]
    return { value: { kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false, ...(realPath === undefined ? {} : { realPath }) } }
  })
  on('ui.toast', ($, e) => (seen.toasts.push(e.text), { value: undefined }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('tool.call', ($, e) => {
    if (e.tool === 'AskUserQuestion') {
      const question = e.questions[0]!.question
      seen.asked.push(question)
      if (answer === undefined) throw new Error('nobody to ask')
      return { result: { questions: e.questions, answers: { [question]: answer } } }
    }
    seen.ran.push(String(e.tool))
    return { result: { type: 'create' as const, filePath: '', content: '', structuredPatch: [], originalFile: null } }
  })
  return seen
}

test('a write inside the project goes through untouched', async ($, on) => {
  const seen = world(on)
  const out = await $.tool.call({ tool: 'Write', file_path: '/work/src/new/deep/file.ts', content: 'x' })
  expect(out.deny).toBeUndefined()
  expect(seen.ran).toEqual(['Write'])
})

test('a write outside the project is refused with a reason the model can act on', async ($, on) => {
  const seen = world(on)
  const out = await $.tool.call({ tool: 'Write', file_path: '/etc/hosts', content: 'x' })
  expect(out.deny).toMatch(/outside this project \(\/work\)/)
  expect(out.deny).toMatch(/extraRoots/)
  expect(seen.ran).toEqual([])
  expect(seen.toasts[0]).toMatch(/file-guard blocked Write/)
})

test('a symlink inside the project that leads outside is caught', async ($, on) => {
  const seen = world(on)
  const out = await $.tool.call({ tool: 'Edit', file_path: '/work/out/passwd', old_string: 'a', new_string: 'b' })
  expect(out.deny).toMatch(/\/etc\/passwd is outside/)
  expect(seen.ran).toEqual([])
})

test('relative paths and .. are resolved before judging', async ($, on) => {
  world(on)
  const out = await $.tool.call({ tool: 'Write', file_path: 'src/../../etc/x', content: 'x' })
  expect(out.deny).toMatch(/\/etc\/x is outside/)
})

test('a dangling link is refused', async ($, on) => {
  world(on)
  const out = await $.tool.call({ tool: 'Write', file_path: '/work/dangling', content: 'x' })
  expect(out.deny).toMatch(/cannot tell where this path really lands/)
})

test('temp folders and Claude\'s own folders are writable; settings.json is not', async ($, on) => {
  const seen = world(on)
  expect((await $.tool.call({ tool: 'Write', file_path: '/tmp/scratch.txt', content: 'x' })).deny).toBeUndefined()
  expect((await $.tool.call({ tool: 'Write', file_path: '/Users/me/.claude/plans/p.md', content: 'x' })).deny).toBeUndefined()
  expect((await $.tool.call({ tool: 'Write', file_path: '/Users/me/.claude/settings.json', content: '{}' })).deny).toMatch(/~\/.claude\/settings.json is outside/)
  expect(seen.ran).toEqual(['Write', 'Write'])
})

test('allowTemp: false fences /tmp too', { options: { allowTemp: false } }, async ($, on) => {
  world(on)
  expect((await $.tool.call({ tool: 'Write', file_path: '/tmp/scratch.txt', content: 'x' })).deny).toMatch(/\/private\/tmp\/scratch.txt is outside/)
})

test('extraRoots opens a folder outside the project', { options: { extraRoots: '~/notes' } }, async ($, on) => {
  world(on)
  expect((await $.tool.call({ tool: 'Write', file_path: '/Users/me/notes/today.md', content: 'x' })).deny).toBeUndefined()
})

test('reads outside are allowed by default and fenced with fenceReads', async ($, on) => {
  world(on)
  expect((await $.tool.call({ tool: 'Read', file_path: '/etc/hosts' })).deny).toBeUndefined()
})

test('fenceReads: true refuses reads outside', { options: { fenceReads: true } }, async ($, on) => {
  world(on)
  expect((await $.tool.call({ tool: 'Read', file_path: '/etc/hosts' })).deny).toMatch(/refused to read/)
})

test('writes into .git are always refused', async ($, on) => {
  world(on, 'Allow once')
  const out = await $.tool.call({ tool: 'Write', file_path: '/work/.git/hooks/pre-commit', content: 'x' })
  expect(out.deny).toMatch(/inside git's own .git folder/)
})

test('a protected file asks first and runs once allowed', async ($, on) => {
  const seen = world(on, 'Allow once')
  const out = await $.tool.call({ tool: 'Edit', file_path: '/work/.github/workflows/ci.yml', old_string: 'a', new_string: 'b' })
  expect(out.deny).toBeUndefined()
  expect(seen.asked[0]).toMatch(/\.github\/workflows\/ci.yml is protected \(matches \.github\/workflows\/\*\*\)/)
  expect(seen.ran).toEqual(['Edit'])
})

test('a protected file is refused when the person blocks it', async ($, on) => {
  const seen = world(on, 'Block it')
  const out = await $.tool.call({ tool: 'Write', file_path: '/work/yarn.lock', content: 'x' })
  expect(out.deny).toMatch(/needs the user's OK/)
  expect(seen.ran).toEqual([])
})

test('a protected file is refused when nobody can answer', async ($, on) => {
  const seen = world(on)
  const out = await $.tool.call({ tool: 'Write', file_path: '/work/.env', content: 'x' })
  expect(out.deny).toMatch(/needs the user's OK/)
  expect(seen.asked.length).toBe(1)
})

test('allowing a file for the session stops further questions about it', async ($, on) => {
  const seen = world(on, 'Allow this file for the session')
  await $.tool.call({ tool: 'Edit', file_path: '/work/db/migrations/001.sql', old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Edit', file_path: '/work/db/migrations/001.sql', old_string: 'b', new_string: 'c' })
  expect(seen.asked.length).toBe(1)
  expect(seen.ran).toEqual(['Edit', 'Edit'])
})

test('.env.example is not protected', async ($, on) => {
  const seen = world(on)
  expect((await $.tool.call({ tool: 'Write', file_path: '/work/.env.example', content: 'X=' })).deny).toBeUndefined()
  expect(seen.asked.length).toBe(0)
})

test('NotebookEdit is fenced by notebook_path', async ($, on) => {
  world(on)
  const out = await $.tool.call({ tool: 'NotebookEdit', notebook_path: '/etc/nb.ipynb', new_source: 'x' })
  expect(out.deny).toMatch(/outside/)
})

test('other tools pass straight through', async ($, on) => {
  const seen = world(on)
  await $.tool.call({ tool: 'Bash', command: 'echo hi > /etc/hosts' })
  expect(seen.ran).toEqual(['Bash'])
})

test('/file-guard check explains a path, and /file-guard reports the fence', async ($, on) => {
  world(on)
  const check = await $.command.run({ command: 'file-guard', args: 'check /work/out/x', ...TYPED })
  expect(check.text).toMatch(/\/work\/out\/x → \/etc\/x/)
  expect(check.text).toMatch(/write: blocked/)
  expect(check.text).toMatch(/read: {2}allowed/)

  await $.tool.call({ tool: 'Write', file_path: '/etc/hosts', content: 'x' })
  const status = await $.command.run({ command: 'file-guard', args: '', ...TYPED })
  expect(status.text).toMatch(/Project: \/work/)
  expect(status.text).toMatch(/Also writable: .*\/private\/tmp/)
  expect(status.text).toMatch(/This session: 1 blocked/)
})
