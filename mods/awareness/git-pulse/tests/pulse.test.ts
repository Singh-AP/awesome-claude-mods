import { expect, mock, test } from 'claude-code/testing'

const TYPED = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } } as const

const status = (branch: string, oid: string, changes = '') =>
  `# branch.oid ${oid}\n# branch.head ${branch}\n# branch.upstream origin/${branch}\n# branch.ab +0 -0\n${changes}`

/** A fake git: `repo.status` is what `git status` prints; every call is recorded. */
function fakeGit(repo: { status: string | null; revCount?: string; log?: string; stash?: string }, calls: string[][]) {
  return ($: unknown, e: { argv: readonly string[] }) => {
    calls.push([...e.argv])
    const sub = e.argv.find(a => !a.startsWith('-') && a !== 'git')
    const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (sub === 'status') {
      return repo.status === null
        ? { value: { exitCode: 128, stdout: '', stderr: 'fatal: not a git repository', isStdoutTruncated: false, isStderrTruncated: false } }
        : ok(repo.status)
    }
    if (sub === 'rev-list') return ok(repo.revCount ?? '0\n')
    if (sub === 'log') return ok(repo.log ?? '')
    if (sub === 'stash') return ok(repo.stash ?? '')
    return ok('')
  }
}

test('session start puts the branch and changes on the status line', async ($, on) => {
  const statuses: (string | undefined)[] = []
  on('ui.status', ($, e) => (statuses.push(e.text), { value: undefined }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('process.run', fakeGit({ status: status('main', 'a1', '1 .M N... 1 1 1 a b x.ts\n? y.ts\n') }, []))
  on('session.start', () => ({ cwd: '/work' }))

  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

  expect(statuses.at(-1)).toBe('⎇ main ●1 ?1')
})

test('outside a repository the status line stays empty', async ($, on) => {
  const statuses: (string | undefined)[] = ['before']
  on('ui.status', ($, e) => (statuses.push(e.text), { value: undefined }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('process.run', fakeGit({ status: null }, []))
  on('session.start', () => ({ cwd: '/tmp' }))

  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/tmp' })

  expect(statuses.at(-1)).toBeUndefined()
  const answer = await $.command.run({ command: 'git-pulse', args: '', ...TYPED })
  expect(answer.text).toBe('git-pulse: this folder is not inside a git repository.')
})

test('a burst of edits runs git once, after the edits settle', async ($, on) => {
  const clock = mock.clock(on)
  const calls: string[][] = []
  const statuses: (string | undefined)[] = []
  on('ui.status', ($, e) => (statuses.push(e.text), { value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  const repo = { status: status('main', 'a1') as string | null }
  on('process.run', fakeGit(repo, calls))
  on('tool.call', () => ({ result: 'ok' }))

  repo.status = status('main', 'a1', '1 .M N... 1 1 1 a b x.ts\n1 .M N... 1 1 1 a b y.ts\n')
  await $.tool.call({ tool: 'Edit', file_path: 'x.ts', old_string: 'a', new_string: 'b' })
  await clock.advance(300)
  await $.tool.call({ tool: 'Edit', file_path: 'y.ts', old_string: 'a', new_string: 'b' })
  await clock.advance(300)
  await $.tool.call({ tool: 'Read', file_path: 'z.ts' })
  expect(calls.length).toBe(0)

  await clock.advance(800)
  expect(calls.length).toBe(1)
  expect(statuses.at(-1)).toBe('⎇ main ●2')
})

test('a branch switch under the session gets a toast', async ($, on) => {
  const clock = mock.clock(on)
  const toasts: string[] = []
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', ($, e) => (toasts.push(e.text), { value: undefined }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  const repo = { status: status('main', 'a1') as string | null }
  on('process.run', fakeGit(repo, []))
  on('session.start', () => ({ cwd: '/work' }))
  on('tool.call', () => ({ result: 'ok' }))

  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  repo.status = status('feat/login', 'a1')
  await $.tool.call({ tool: 'Bash', command: 'git checkout -b feat/login' })
  await clock.advance(1000)

  expect(toasts).toEqual(['branch changed: main → feat/login'])
})

test('a turn that made commits says how many', async ($, on) => {
  const toasts: string[] = []
  const calls: string[][] = []
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', ($, e) => (toasts.push(e.text), { value: undefined }))
  const repo = { status: status('main', 'aaa111') as string | null, revCount: '2\n' }
  on('process.run', fakeGit(repo, calls))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))

  await $.turn.start({ text: 'commit this', turnId: 't1' })
  repo.status = status('main', 'bbb222')
  await $.turn.complete({ turnId: 't1', answer: 'done', durationMs: 5000, isAborted: false, reason: 'answer' })

  expect(toasts).toEqual(['2 new commits on main this turn'])
  expect(calls.some(c => c.includes('aaa111..bbb222'))).toBe(true)
})

test('a turn with no new commits stays quiet', async ($, on) => {
  const toasts: string[] = []
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', ($, e) => (toasts.push(e.text), { value: undefined }))
  on('process.run', fakeGit({ status: status('main', 'aaa111') }, []))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))

  await $.turn.start({ text: 'explain', turnId: 't1' })
  await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 2000, isAborted: false, reason: 'answer' })

  expect(toasts).toEqual([])
})

test('/git-pulse summarizes the repository', async ($, on) => {
  on('ui.status', () => ({ value: undefined }))
  on('process.run', fakeGit({ status: status('main', 'aaa111', '1 M. N... 1 1 1 a b x.ts\n'), log: 'aaa111 Add x (1 hour ago)\n', stash: 'stash@{0}\n' }, []))

  const answer = await $.command.run({ command: 'git-pulse', args: '', ...TYPED })

  expect(answer.text).toContain('Branch: main')
  expect(answer.text).toContain('Upstream: origin/main (in sync)')
  expect(answer.text).toContain('Working tree: 1 staged')
  expect(answer.text).toContain('Stash: 1 entry')
  expect(answer.text).toContain('  aaa111 Add x (1 hour ago)')
})

test('when git cannot run, the mod goes quiet instead of failing every call', async ($, on) => {
  let runs = 0
  const statuses: (string | undefined)[] = []
  on('ui.status', ($, e) => (statuses.push(e.text), { value: undefined }))
  on('process.run', () => (runs++, { deny: 'spawn git ENOENT' }))

  for (let i = 0; i < 5; i++) await $.command.run({ command: 'git-pulse', args: '', ...TYPED })

  expect(runs).toBe(3)
  expect(statuses.every(s => s === undefined)).toBe(true)
  expect((await $.command.run({ command: 'git-pulse', args: '', ...TYPED })).text).toBe('git-pulse: git is not available here.')
})
