import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const TYPED = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } } as const
const PANE = {
  plugin: 'codebuild', component: 'Pane', requestId: 'codebuild', viewport: { columns: 140, rows: 40 },
  props: { title: 'CodeBuild', isFocused: true, bodyColumns: 70, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

type World = { calls: string[]; rmStdin: string[]; toasts: string[]; prompts: string[]; outcome: 'SUCCEEDED' | 'FAILED'; polls: number }

const ok = (stdout = '') => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
const fail = (stderr: string) => ({ value: { exitCode: 254, stdout: '', stderr, isStdoutTruncated: false, isStderrTruncated: false } })

/** A fake AWS account and git repo beneath the mod. */
function world(on: On, outcome: 'SUCCEEDED' | 'FAILED' = 'SUCCEEDED', created = { bucket: false, role: false, project: false }, store: Record<string, unknown> = {}, isSignedOut = false) {
  const w: World = { calls: [], rmStdin: [], toasts: [], prompts: [], outcome, polls: 0 }
  mock.store(on, store)
  const clock = mock.clock(on, { now: Date.parse('2026-10-13T10:00:00Z') })
  on('session.root', () => ({ value: '/work/app' }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('env.get', () => ({ value: undefined }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('tool.register', ($, e) => ({ value: { tool: `mcp__codebuild__${e.name}` } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', ($, e) => (w.toasts.push(e.text), { value: undefined }))
  on('fs.list', () => ({ value: [{ name: 'package.json', kind: 'file', size: 10, mtimeMs: 0, isLink: false }, { name: 'package-lock.json', kind: 'file', size: 10, mtimeMs: 0, isLink: false }] }))
  on('fs.read', ($, e) => ({ value: e.path.endsWith('package.json') ? '{"scripts":{"test":"node --test"}}' : '' }))
  on('fs.stat', ($, e) => ({ value: { kind: e.path.endsWith('.zip') ? ('file' as const) : ('dir' as const), size: 4096, mtimeMs: 0, isLink: false } }))
  on('prompt.submit', ($, e) => (w.prompts.push(e.text), { text: e.text }))
  on('process.run', ($, e) => {
    const [cmd, ...args] = e.argv
    const line = [String(cmd), ...args].filter(a => !['--output', 'json', '--no-cli-pager'].includes(a)).join(' ')
    w.calls.push(line)
    if (cmd === 'sleep' || cmd === 'mkdir' || cmd === 'rm' || cmd === 'rmdir') return ok()
    if (cmd === 'git') {
      if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') return ok('/work/app\n')
      if (args[0] === 'rev-parse' && args[1] === '--show-prefix') return ok('\n')
      if (args[0] === 'ls-files') return ok(['package.json', 'src/a.js', '.env', '.env.example'].join('\0'))
      if (args.includes('rm')) w.rmStdin.push(e.init?.stdin ?? '')
      if (args[0] === 'write-tree') return ok('abc123\n')
      return ok()
    }
    if (cmd === 'aws' && args.includes('gone')) return fail('The config profile (gone) could not be found')
    if (cmd === 'aws' && args[0] === 'sts' && isSignedOut) return fail('Unable to locate credentials. You can configure credentials by running "aws configure".')
    if (cmd === 'aws' && args[0] === 'sts' && args.includes('default')) return fail('Unable to locate credentials. You can configure credentials by running "aws configure".')
    const sub = `${args[0]} ${args[1]}`
    if (sub === 'configure list-profiles') return ok('default\ndev\n')
    if (sub === 'configure get') return ok('us-west-2\n')
    if (sub === 'sts get-caller-identity') return ok(JSON.stringify({ Account: '123456789012', Arn: 'arn:aws:sts::123456789012:assumed-role/Dev/me' }))
    if (sub === 's3api head-bucket') return created.bucket ? ok() : fail('An error occurred (404) when calling the HeadBucket operation: Not Found')
    if (sub === 'iam get-role') return created.role ? ok('{}') : fail('An error occurred (NoSuchEntity)')
    if (sub === 'codebuild batch-get-projects') return ok(JSON.stringify({ projects: created.project ? [{ name: 'x' }] : [] }))
    if (sub === 'codebuild start-build') return ok(JSON.stringify({ build: { id: 'claude-app:1', buildNumber: 1, buildStatus: 'IN_PROGRESS', currentPhase: 'SUBMITTED', startTime: '2026-10-13T10:00:00Z' } }))
    if (sub === 'codebuild batch-get-builds') {
      w.polls += 1
      const isDone = w.polls >= 2
      return ok(JSON.stringify({ builds: [{
        id: 'claude-app:1', buildNumber: 1, buildStatus: isDone ? w.outcome : 'IN_PROGRESS', currentPhase: isDone ? 'COMPLETED' : 'BUILD',
        startTime: '2026-10-13T10:00:00Z', endTime: isDone ? '2026-10-13T10:01:30Z' : undefined,
        phases: [{ phaseType: 'INSTALL', phaseStatus: 'SUCCEEDED', durationInSeconds: 12 }, { phaseType: 'BUILD', phaseStatus: isDone ? (w.outcome === 'SUCCEEDED' ? 'SUCCEEDED' : 'FAILED') : undefined, contexts: w.outcome === 'FAILED' ? [{ message: 'COMMAND_EXECUTION_ERROR' }] : [] }],
        logs: { groupName: '/aws/codebuild/claude-app', streamName: 's1' },
      }] }))
    }
    if (sub === 'logs get-log-events') {
      const token = args.includes('--next-token') ? 't1' : undefined
      return ok(JSON.stringify(token ? { events: [], nextForwardToken: 't1' } : { events: [{ message: '[Container] Running command npm test\n' }, { message: w.outcome === 'FAILED' ? 'not ok 1 - adds a todo\n' : 'ok 1 - adds a todo\n' }], nextForwardToken: 't1' }))
    }
    return ok('{}')
  })
  return { ...w, w, clock }
}

test('/codebuild on a new repo opens a one-screen setup with the profiles and the account', async ($, on) => {
  world(on)
  const out = await $.command.run({ command: 'codebuild', args: '', ...TYPED })
  expect(out.text).toMatch(/Ready with profile dev .*Run \/codebuild again to set up and build/s)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ key: 'profile' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /account 123456789012 · us-west-2 · assumed-role\/Dev\/me/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /node \(npm\) · buildspec generated/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /First run creates/ })).toBeDefined()
    await ui.unmount()
  }
})

test('Set up & build creates the bucket, role and project, uploads the tree and follows the build to green', async ($, on) => {
  const { w } = world(on)
  await $.command.run({ command: 'codebuild', args: '', ...TYPED })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'go' })

  const order = (needle: string) => w.calls.findIndex(c => c.includes(needle))
  expect(order('s3api create-bucket --bucket claude-codebuild-123456789012-us-west-2')).toBeGreaterThan(-1)
  expect(w.calls.some(c => c.includes('put-public-access-block'))).toBe(true)
  expect(order('iam create-role --role-name claude-codebuild-service-role')).toBeGreaterThan(-1)
  expect(order('codebuild create-project')).toBeGreaterThan(order('iam put-role-policy'))
  expect(order('s3 cp')).toBeGreaterThan(order('git archive'))
  expect(w.calls.find(c => c.includes('start-build'))).toMatch(/--source-type-override S3 .*--buildspec-override version: 0\.2/s)
  expect(w.rmStdin[0]).toBe('.env')

  expect(await ui.find({ type: 'Text', text: /☁️ #1 · SUBMITTED/ })).toBeDefined()
  await ui.unmount()
})

test('the build is followed until it ends, with a toast and the log in the pane', async ($, on) => {
  const { w, clock } = world(on, 'SUCCEEDED', { bucket: true, role: true, project: true }, { 'repo:/work/app': { profile: 'dev', region: 'us-west-2', account: '123456789012', repo: '/work/app', project: 'claude-app-abc123', bucket: 'claude-codebuild-123456789012-us-west-2', role: 'claude-codebuild-service-role' } })
  const started = await $.command.run({ command: 'codebuild', args: '', ...TYPED })
  expect(started.text).toMatch(/Started build #1/)
  await clock.advance(4000)
  await clock.advance(4000)
  expect(w.toasts.at(-1)).toMatch(/CodeBuild #1 passed in 1m 30s/)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /passed/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /ok 1 - adds a todo/ })).toBeDefined()
  expect(await ui.find({ key: 'again' })).toBeDefined()
})

test('Claude builds through the tool after the person agrees, and reads the failing log lines', async ($, on) => {
  const { w } = world(on, 'FAILED', { bucket: true, role: true, project: true }, { 'repo:/work/app': { profile: 'dev', region: 'us-west-2', account: '123456789012', repo: '/work/app', project: 'claude-app-abc123', bucket: 'claude-codebuild-123456789012-us-west-2', role: 'claude-codebuild-service-role' } })
  const asked: string[] = []
  on('tool.call', ($, e) => {
    const question = (e as { questions: { question: string }[] }).questions[0]!.question
    asked.push(question)
    return { result: { questions: (e as { questions: unknown }).questions, answers: { [question]: 'Build' } } }
  })
  const out = await $.tool.call({ tool: 'mcp__codebuild__build' })
  expect(asked[0]).toMatch(/Claude wants to build \/work\/app on AWS CodeBuild with profile "dev"/)
  expect(String(out.result)).toMatch(/CodeBuild build #1 \(claude-app-[0-9a-f]{6}\) FAILED after 1m 30s/)
  expect(String(out.result)).toMatch(/not ok 1 - adds a todo/)
  expect(w.toasts.at(-1)).toMatch(/failed/)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'fix' })
  expect(w.prompts[0]).toMatch(/Find the cause and fix it[\s\S]*not ok 1/)
})

test('without anyone to ask, Claude is told the build needs the user', async ($, on) => {
  world(on, 'SUCCEEDED', { bucket: true, role: true, project: true }, { 'repo:/work/app': { profile: 'dev', region: 'us-west-2', account: '123456789012', repo: '/work/app', project: 'claude-app-abc123', bucket: 'claude-codebuild-123456789012-us-west-2', role: 'claude-codebuild-service-role' } })
  on('tool.call', () => ({ deny: 'headless' }))
  const out = await $.tool.call({ tool: 'mcp__codebuild__build' })
  expect(String(out.result)).toMatch(/needs the user's OK/)
})

test('a remembered profile that no longer exists opens the setup screen instead of failing', async ($, on) => {
  const { w } = world(on, 'SUCCEEDED', { bucket: true, role: true, project: true }, { 'repo:/work/app': { profile: 'gone', region: 'us-east-1', account: '123456789012', repo: '/work/app', project: 'p', bucket: 'b', role: 'r' } })
  void w
  on('ui.render', () => ({ type: 'Text' as const, props: {}, children: ['engine'] }))
  const out = await $.command.run({ command: 'codebuild', args: '', ...TYPED })
  expect(out.text).toMatch(/Pick a working AWS profile/)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const picker = await ui.find({ key: 'profile' })
  expect((picker?.props as { value?: string }).value).toBe('dev')
})

test('setup preselects the first profile that has working credentials and shows the others', async ($, on) => {
  world(on)
  on('ui.render', () => ({ type: 'Text' as const, props: {}, children: ['engine'] }))
  await $.command.run({ command: 'codebuild', args: 'setup', ...TYPED })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const picker = await ui.find({ key: 'profile' })
  expect((picker?.props as { value?: string }).value).toBe('dev')
  expect(await ui.find({ type: 'Text', text: /other profiles: default ✗/ })).toBeDefined()
})

test('/codebuild profile <name> switches without the dropdown', async ($, on) => {
  world(on)
  on('ui.render', () => ({ type: 'Text' as const, props: {}, children: ['engine'] }))
  expect((await $.command.run({ command: 'codebuild', args: 'profile default', ...TYPED })).text).toMatch(/no credentials/)
  expect((await $.command.run({ command: 'codebuild', args: 'profile dev', ...TYPED })).text).toMatch(/Using profile dev: ✓ account 123456789012/)
})

test('running /codebuild again on the setup screen sets up and builds, and /codebuild fix hands Claude the failure', async ($, on) => {
  const { w } = world(on, 'FAILED')
  on('ui.render', () => ({ type: 'Text' as const, props: {}, children: ['engine'] }))
  await $.command.run({ command: 'codebuild', args: '', ...TYPED })
  const go = await $.command.run({ command: 'codebuild', args: '', ...TYPED })
  expect(go.text).toMatch(/Setting up and building with profile dev/)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.unmount()
  expect(w.calls.some(c => c.includes('codebuild create-project'))).toBe(true)
  expect(w.calls.some(c => c.includes('codebuild start-build'))).toBe(true)
})

test('/codebuild fix submits the failure to Claude once the command has returned', async ($, on) => {
  const { w, clock } = world(on, 'FAILED', { bucket: true, role: true, project: true }, { 'repo:/work/app': { profile: 'dev', region: 'us-west-2', account: '123456789012', repo: '/work/app', project: 'claude-app-abc123', bucket: 'b', role: 'r' } })
  await $.command.run({ command: 'codebuild', args: '', ...TYPED })
  await clock.advance(4000)
  await clock.advance(4000)
  const out = await $.command.run({ command: 'codebuild', args: 'fix', ...TYPED })
  expect(out.text).toMatch(/Asking Claude to fix build #1/)
  expect(w.prompts).toEqual([])
  await clock.settle()
  expect(w.prompts[0]).toMatch(/Find the cause and fix it[\s\S]*not ok 1/)
})

test('with no working credentials, setup says to sign in instead of offering to build', async ($, on) => {
  world(on, 'SUCCEEDED', undefined, {}, true)
  on('ui.render', () => ({ type: 'Text' as const, props: {}, children: ['engine'] }))
  const out = await $.command.run({ command: 'codebuild', args: '', ...TYPED })
  expect(out.text).toMatch(/No AWS profile with working credentials/)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ key: 'go' }))?.props).toMatchObject({ label: 'Sign in to AWS first' })
  expect(await ui.find({ type: 'Text', text: /Sign in to AWS in a terminal/ })).toBeDefined()
})
