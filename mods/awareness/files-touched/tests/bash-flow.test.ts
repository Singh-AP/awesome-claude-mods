import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { countStrings } from '../hooks/changes'

const TYPED = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } } as const
const BASH_OK = (text = '') => ({ result: { stdout: text, stderr: '', interrupted: false }, text })

// A tiny git repo in memory: `head` is each file's committed content (absent: untracked),
// `content` the work tree's (null: deleted).
type FakeFile = { content: string | null; head?: string }
type FakeRepo = { oid: string; files: Map<string, FakeFile>; calls: string[]; isRepo: boolean }

function fakeHash(text: string): string {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return (h >>> 0).toString(16).padStart(8, '0').repeat(5)
}

function fakeGit(repo: FakeRepo, argv: readonly string[], stdin: string | undefined): { exitCode: number; stdout: string } {
  const args = argv.slice(2) // drop `git --no-optional-locks`
  repo.calls.push(args[0] ?? '')
  if (!repo.isRepo) return { exitCode: 128, stdout: '' }
  switch (args[0]) {
    case 'rev-parse':
      return { exitCode: 0, stdout: '/repo\n\n' }
    case 'status': {
      const lines = [`# branch.oid ${repo.oid}`, '# branch.head main']
      for (const [path, file] of [...repo.files.entries()].sort()) {
        if (file.head === undefined) {
          if (file.content !== null) lines.push(`? ${path}`)
        } else if (file.content === null) {
          lines.push(`1 .D N... 100644 100644 000000 ${fakeHash(file.head)} ${fakeHash(file.head)} ${path}`)
        } else if (file.content !== file.head) {
          lines.push(`1 .M N... 100644 100644 100644 ${fakeHash(file.head)} ${fakeHash(file.head)} ${path}`)
        }
      }
      return { exitCode: 0, stdout: `${lines.join('\0')}\0` }
    }
    case 'hash-object': {
      const paths = (stdin ?? '').split('\n').filter(p => p !== '')
      const out: string[] = []
      for (const path of paths) {
        const content = repo.files.get(path)?.content
        if (content === null || content === undefined) return { exitCode: 128, stdout: '' }
        out.push(fakeHash(content))
      }
      return { exitCode: 0, stdout: `${out.join('\n')}\n` }
    }
    case 'diff': {
      const rows: string[] = []
      for (const [path, file] of repo.files) {
        if (file.head === undefined || file.content === file.head) continue
        const counts = countStrings(file.head, file.content ?? '')
        rows.push(`${counts.added}\t${counts.removed}\t${path}`)
      }
      return { exitCode: 0, stdout: rows.length === 0 ? '' : `${rows.join('\0')}\0` }
    }
  }
  return { exitCode: 1, stdout: '' }
}

function newRepo(isRepo = true): FakeRepo {
  return {
    oid: 'a'.repeat(40),
    isRepo,
    calls: [],
    files: new Map<string, FakeFile>([
      ['src/a.ts', { content: 'one\ntwo\n', head: 'one\ntwo\n' }],
      ['README.md', { content: '# app\n', head: '# app\n' }],
    ]),
  }
}

/** Wires the stubs: git over `repo`, the file reads, and Bash commands mapped to what they do. */
function wire(on: On, repo: FakeRepo, effects: Record<string, () => void>, readOnly: string[] = []) {
  mock.clock(on, { now: 1000 })
  on('session.root', () => ({ value: '/repo' }))
  on('process.run', ($, e) => ({ value: { ...fakeGit(repo, e.argv, e.init?.stdin), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('fs.read', ($, e) => ({ value: repo.files.get(e.path.replace('/repo/', ''))?.content ?? '' }))
  on('fs.exists', ($, e) => ({ value: (repo.files.get(e.path.replace('/repo/', ''))?.content ?? null) !== null }))
  on('tool.call', ($, e) => {
    if (e.tool === 'Bash') {
      effects[e.command]?.()
      return readOnly.includes(e.command) ? { ...BASH_OK('listing'), isReadOnly: true as const } : BASH_OK()
    }
    if (e.tool === 'Edit') {
      const file = repo.files.get(e.file_path.replace('/repo/', ''))!
      file.content = (file.content ?? '').replace(e.old_string, e.new_string)
      return { result: { structuredPatch: [{ lines: ['-two', '+TWO', '+three'] }] } }
    }
    return { result: 'ok' }
  })
}

test('files a Bash command writes or edits are counted, and an Edit merges into the same row', async ($, on) => {
  const repo = newRepo()
  wire(on, repo, {
    "printf 'x\\n' > note.txt": () => repo.files.set('note.txt', { content: 'x\n' }),
    "printf 'more\\n' >> src/a.ts": () => {
      repo.files.get('src/a.ts')!.content = 'one\ntwo\nmore\n'
    },
  })

  await $.tool.call({ tool: 'Bash', command: "printf 'x\\n' > note.txt" })
  await $.tool.call({ tool: 'Bash', command: "printf 'more\\n' >> src/a.ts" })
  await $.tool.call({ tool: 'Edit', file_path: '/repo/src/a.ts', old_string: 'two', new_string: 'TWO\nthree' })

  const out = await $.command.run({ command: 'touched', args: '', ...TYPED })
  expect(out.text).toMatch(/^\*\*2 files changed\*\*/)
  expect(out.text).toMatch(/\| `note\.txt` \| created \(bash\) \| 1 \| \+1 \| −0 \|/)
  // +1 from the Bash append, +2 −1 from the Edit's patch.
  expect(out.text).toMatch(/\| `src\/a\.ts` \| modified \(\+bash\) \| 2 \| \+3 \| −1 \|/)
})

test('the git look before a command is reused: read-only commands cost no git at all', async ($, on) => {
  const repo = newRepo()
  wire(on, repo, { 'touch new.txt': () => repo.files.set('new.txt', { content: '' }) }, ['ls', 'git status'])

  await $.tool.call({ tool: 'Bash', command: 'ls' })
  const afterFirst = repo.calls.length
  await $.tool.call({ tool: 'Bash', command: 'git status' })
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(repo.calls.length).toBe(afterFirst)

  await $.tool.call({ tool: 'Bash', command: 'touch new.txt' })
  expect(repo.calls.filter(c => c === 'rev-parse')).toHaveLength(1)
  const out = await $.command.run({ command: 'touched', args: '', ...TYPED })
  expect(out.text).toMatch(/\| `new\.txt` \| created \(bash\) \| 1 \| \+0 \| −0 \|/)
})

test('committing what was already changed is not counted again; reverting and deleting are', async ($, on) => {
  const repo = newRepo()
  wire(on, repo, {
    'append': () => {
      repo.files.get('README.md')!.content = '# app\nmore\n'
    },
    'git commit -am wip': () => {
      const file = repo.files.get('README.md')!
      file.head = file.content!
      repo.oid = 'b'.repeat(40)
    },
    'printf x > scratch.txt': () => repo.files.set('scratch.txt', { content: 'x' }),
    'rm scratch.txt': () => {
      repo.files.get('scratch.txt')!.content = null
    },
    'sed -i s/one/1/ src/a.ts': () => {
      repo.files.get('src/a.ts')!.content = '1\ntwo\n'
    },
    'git checkout -- src/a.ts': () => {
      repo.files.get('src/a.ts')!.content = 'one\ntwo\n'
    },
  })

  for (const command of ['append', 'git commit -am wip', 'printf x > scratch.txt', 'rm scratch.txt', 'sed -i s/one/1/ src/a.ts', 'git checkout -- src/a.ts']) {
    await $.tool.call({ tool: 'Bash', command })
  }

  const out = await $.command.run({ command: 'touched', args: '', ...TYPED })
  expect(out.text).toMatch(/\| `README\.md` \| modified \(bash\) \| 1 \| \+1 \| −0 \|/)
  expect(out.text).toMatch(/\| `scratch\.txt` \| deleted \(bash\) \| 2 \| \+1 \| −1 \|/)
  // The sed (+1 −1) and the checkout that undid it (+1 −1) are two changes.
  expect(out.text).toMatch(/\| `src\/a\.ts` \| modified \(bash\) \| 2 \| \+2 \| −2 \|/)
})

test('outside a git repo Bash commands run untouched and git is asked once', async ($, on) => {
  const repo = newRepo(false)
  wire(on, repo, { 'printf x > a.txt': () => repo.files.set('a.txt', { content: 'x' }) })

  await $.tool.call({ tool: 'Bash', command: 'printf x > a.txt' })
  await $.tool.call({ tool: 'Bash', command: 'printf x > a.txt' })

  expect(repo.calls).toEqual(['rev-parse'])
  expect((await $.command.run({ command: 'touched', args: '', ...TYPED })).text).toBe('No files changed yet this session.')
})

test('a denied command changes nothing and git failing never breaks a call', async ($, on) => {
  const repo = newRepo()
  mock.clock(on, { now: 1000 })
  on('session.root', () => ({ value: '/repo' }))
  on('process.run', () => ({ deny: 'git is not installed' }))
  on('tool.call', ($, e) => (e.tool === 'Bash' && e.command === 'nope' ? { deny: 'blocked' } : BASH_OK('fine')))

  expect((await $.tool.call({ tool: 'Bash', command: 'nope' })).deny).toBe('blocked')
  const ran = await $.tool.call({ tool: 'Bash', command: 'echo hi > x' })
  expect(ran.deny).toBeUndefined()
  expect(repo.calls).toEqual([])
})
