import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { BuildView, Wizard } from '../types'
import {
  bucketName, costOf, duration, explainAwsError, isDone, isSecretPath, lifecycle, parseBuild, PRICE_PER_MINUTE,
  projectInput, projectName, reportForClaude, ROLE, rolePolicy, shownPhases, statusText, TAG, trustPolicy, usefulLog,
  type Config, type Target,
} from './aws'
import { planBuild, type Plan, type ProjectFiles } from './buildspec'

const PANE = 'codebuild'
const TOOL = 'mcp__codebuild__build'
const LOG_LINES = 400

const wizardAtom = atom({ plugin: 'codebuild', key: 'wizard' } as const, null)
const buildAtom = atom({ plugin: 'codebuild', key: 'build' } as const, null)
const logAtom = atom({ plugin: 'codebuild', key: 'log' } as const, [])
const modeAtom = atom({ plugin: 'codebuild', key: 'mode' } as const, 'wizard')

type Settings = { profile: string; region: string; computeType: string; image: string }
type Active = { config: Config; startedBy: 'you' | 'claude'; plan: Plan; hasOwnBuildspec: boolean }

// Module state: a reload starts these over; the running build is in $.state and $.store.
let settings: Settings = { profile: '', region: '', computeType: 'BUILD_GENERAL1_SMALL', image: 'aws/codebuild/amazonlinux-x86_64-standard:5.0' }
let active: Active | null = null
let logToken: string | undefined
let poller: { cancel: () => void } | null = null
let isTicking = false
let isClaudeAllowed = false

type AwsOut = { ok: boolean; json: any; stdout: string; stderr: string }

/** Runs the AWS CLI with the person's profile and region. Rejects only when the CLI is missing. */
async function awsCli($: EngineInterface, t: { profile: string; region?: string }, args: string[], timeoutMs = 60_000): Promise<AwsOut> {
  const argv = ['aws', ...args, '--output', 'json', '--no-cli-pager']
  if (t.profile !== '') argv.push('--profile', t.profile)
  if (t.region) argv.push('--region', t.region)
  let ran
  try {
    ran = await $.process.run(argv, { timeoutMs })
  } catch (error) {
    if (/ENOENT|not found|No such file/i.test(String(error))) {
      throw new Error('The AWS CLI isn\'t installed. Install it (https://aws.amazon.com/cli/), then run /codebuild again.')
    }
    throw error
  }
  let json: any
  try {
    json = ran.stdout.trim() === '' ? {} : JSON.parse(ran.stdout)
  } catch {
    json = {}
  }
  return { ok: ran.exitCode === 0, json, stdout: ran.stdout, stderr: ran.stderr }
}

/** Like awsCli, but a failure throws what the person should do about it. */
async function awsMust($: EngineInterface, t: { profile: string; region?: string }, args: string[], timeoutMs?: number): Promise<any> {
  const out = await awsCli($, t, args, timeoutMs)
  if (!out.ok) throw new Error(explainAwsError(out.stderr, t.profile || 'default'))
  return out.json
}

async function listProfiles($: EngineInterface): Promise<string[]> {
  try {
    const ran = await $.process.run(['aws', 'configure', 'list-profiles'], { timeoutMs: 10_000 })
    return ran.stdout.split('\n').map(line => line.trim()).filter(Boolean)
  } catch {
    return []
  }
}

/** Who the profile is: account, region, identity. */
async function resolveTarget($: EngineInterface, profile: string): Promise<Target & { arn: string }> {
  const who = await awsMust($, { profile, region: settings.region || undefined }, ['sts', 'get-caller-identity'], 30_000)
  let region = settings.region
  if (region === '') {
    const configured = await awsCli($, { profile }, ['configure', 'get', 'region'], 10_000)
    region = configured.stdout.trim()
  }
  if (region === '') region = (await $.env.get('AWS_REGION')) ?? (await $.env.get('AWS_DEFAULT_REGION')) ?? 'us-east-1'
  return { profile, region, account: String(who.Account), arn: String(who.Arn) }
}

async function absoluteRepo($: EngineInterface, path: string): Promise<string> {
  let repo = path.trim() === '' ? await $.session.root() : path.trim()
  if (repo.startsWith('~')) repo = `${(await $.env.get('HOME')) ?? ''}${repo.slice(1)}`
  if (!repo.startsWith('/')) repo = `${await $.session.root()}/${repo}`
  return repo.replace(/\/+$/, '').replace(/\/\.\//g, '/') || '/'
}

/** What the repo is, and the buildspec CodeBuild will run. */
async function inspectRepo($: EngineInterface, repo: string): Promise<{ plan: Plan; hasOwnBuildspec: boolean }> {
  const names = (await $.fs.list(repo)).map(entry => entry.name)
  const readText = async (name: string) => (names.includes(name) ? await $.fs.read(`${repo}/${name}`).catch(() => undefined) : undefined)
  const files: ProjectFiles = { names }
  const pkg = await readText('package.json')
  if (pkg !== undefined) {
    try {
      files.packageJson = JSON.parse(pkg)
    } catch {
      files.packageJson = {}
    }
  }
  files.nodeVersion = (await readText('.nvmrc')) ?? (await readText('.node-version'))
  files.pythonVersion = await readText('.python-version')
  files.makefile = await readText('Makefile')
  const hasOwnBuildspec = names.includes('buildspec.yml') || names.includes('buildspec.yaml')
  return { plan: planBuild(files), hasOwnBuildspec }
}

async function identityLine($: EngineInterface, profile: string): Promise<{ text: string; isOk: boolean }> {
  try {
    const t = await resolveTarget($, profile)
    const who = t.arn.split(':').pop() ?? t.arn
    return { text: `✓ account ${t.account} · ${t.region} · ${who}`, isOk: true }
  } catch (error) {
    return { text: `✗ ${error instanceof Error ? error.message : String(error)}`, isOk: false }
  }
}

/** Opens the one-screen setup: profile, repo, what it will create. */
async function openWizard($: EngineInterface, repoArg: string): Promise<void> {
  const repo = await absoluteRepo($, repoArg)
  const saved = (await $.store.get(`repo:${repo}`)) as Config | undefined
  const profiles = await listProfiles($)
  const envProfile = (await $.env.get('AWS_PROFILE')) ?? ''
  const profile = saved?.profile ?? (settings.profile || envProfile || (profiles.includes('default') ? 'default' : profiles[0] ?? ''))
  const { plan, hasOwnBuildspec } = await inspectRepo($, repo).catch(() => ({ plan: planBuild({ names: [] }), hasOwnBuildspec: false }))
  await update($, modeAtom, () => 'wizard')
  await update($, wizardAtom, () => ({
    profiles, profile, repo, identity: 'checking AWS…', isIdentityOk: false, stack: plan.stack.join(' + '),
    buildspec: plan.yaml, hasOwnBuildspec, isConfigured: saved !== undefined, showBuildspec: false, message: '', isBusy: false,
  }))
  await $.ui.open({ id: PANE, title: 'CodeBuild' })
  const who = await identityLine($, profile)
  await update($, wizardAtom, w => (w === null ? w : { ...w, identity: who.text, isIdentityOk: who.isOk }))
}

async function pickProfile($: EngineInterface, profile: string): Promise<void> {
  await update($, wizardAtom, w => (w === null ? w : { ...w, profile, identity: 'checking AWS…', isIdentityOk: false }))
  const who = await identityLine($, profile)
  await update($, wizardAtom, w => (w === null ? w : { ...w, identity: who.text, isIdentityOk: who.isOk }))
}

async function pickRepo($: EngineInterface, path: string): Promise<void> {
  const repo = await absoluteRepo($, path)
  const kind = await $.fs.stat(repo).then(s => s.kind).catch(() => 'missing')
  if (kind !== 'dir') {
    await update($, wizardAtom, w => (w === null ? w : { ...w, message: `✗ ${repo} isn't a folder.` }))
    return
  }
  const { plan, hasOwnBuildspec } = await inspectRepo($, repo)
  const saved = await $.store.get(`repo:${repo}`)
  await update($, wizardAtom, w => (w === null ? w : { ...w, repo, stack: plan.stack.join(' + '), buildspec: plan.yaml, hasOwnBuildspec, isConfigured: saved !== undefined, message: '' }))
}

/** Creates what's missing (bucket, role, project) and remembers the repo's setup. */
async function ensureSetup($: EngineInterface, repo: string, profile: string, plan: Plan): Promise<Config> {
  const t = await resolveTarget($, profile)
  const c: Config = { profile, region: t.region, account: t.account, repo, project: projectName(repo), bucket: bucketName(t.account, t.region), role: ROLE }

  if (!(await awsCli($, c, ['s3api', 'head-bucket', '--bucket', c.bucket])).ok) {
    const create = ['s3api', 'create-bucket', '--bucket', c.bucket]
    if (c.region !== 'us-east-1') create.push('--create-bucket-configuration', `LocationConstraint=${c.region}`)
    await awsMust($, c, create)
    await awsMust($, c, ['s3api', 'put-public-access-block', '--bucket', c.bucket, '--public-access-block-configuration', 'BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true'])
    await awsMust($, c, ['s3api', 'put-bucket-lifecycle-configuration', '--bucket', c.bucket, '--lifecycle-configuration', JSON.stringify(lifecycle)])
    await awsMust($, c, ['s3api', 'put-bucket-tagging', '--bucket', c.bucket, '--tagging', JSON.stringify({ TagSet: [TAG] })])
  }

  if (!(await awsCli($, c, ['iam', 'get-role', '--role-name', ROLE])).ok) {
    await awsMust($, c, ['iam', 'create-role', '--role-name', ROLE, '--description', 'Lets CodeBuild run builds started by the codebuild mod for Claude Code', '--assume-role-policy-document', JSON.stringify(trustPolicy(c.account)), '--tags', `Key=${TAG.Key},Value=${TAG.Value}`])
    await awsMust($, c, ['iam', 'put-role-policy', '--role-name', ROLE, '--policy-name', 'claude-codebuild-run', '--policy-document', JSON.stringify(rolePolicy(c.account))])
  }

  const found = await awsMust($, c, ['codebuild', 'batch-get-projects', '--names', c.project])
  if ((found.projects ?? []).length === 0) {
    const input = JSON.stringify(projectInput(c, { computeType: settings.computeType, image: settings.image, privileged: plan.needsDocker }))
    // A new role takes a few seconds to be assumable: retry while IAM catches up.
    for (let attempt = 0; ; attempt++) {
      const made = await awsCli($, c, ['codebuild', 'create-project', '--cli-input-json', input])
      if (made.ok) break
      if (attempt >= 8 || !/not authorized to perform: sts:AssumeRole|InvalidInputException.*role/i.test(made.stderr)) {
        throw new Error(explainAwsError(made.stderr, profile))
      }
      await $.process.run(['sleep', '5'], { timeoutMs: 10_000 })
    }
  }

  await $.store.set(`repo:${repo}`, c)
  return c
}

/** Zips the working tree as git sees it (uncommitted and untracked included, ignored and secret files left out). */
async function packageSource($: EngineInterface, repo: string): Promise<{ zip: string; dir: string; bytes: number }> {
  const tmp = ((await $.env.get('TMPDIR')) ?? '/tmp').replace(/\/+$/, '')
  const dir = `${tmp}/claude-codebuild-${(await $.clock.now()).toString(36)}`
  const zip = `${dir}/source.zip`
  await $.process.run(['mkdir', '-p', dir])

  const top = await $.process.run(['git', 'rev-parse', '--show-toplevel'], { cwd: repo })
  if (top.exitCode !== 0) {
    const zipped = await $.process.run(['zip', '-r', '-q', '-X', zip, '.', '-x', '.git/*', 'node_modules/*', '*/node_modules/*', '.env', '.env.*', '*.pem', '*.key', 'id_rsa*'], { cwd: repo, timeoutMs: 300_000 })
    if (zipped.exitCode !== 0) throw new Error(`Couldn't zip ${repo}: ${zipped.stderr.slice(0, 200)}`)
  } else {
    const root = top.stdout.trim()
    const prefix = (await $.process.run(['git', 'rev-parse', '--show-prefix'], { cwd: repo })).stdout.trim()
    const env = { GIT_INDEX_FILE: `${dir}/index` }
    const hasHead = (await $.process.run(['git', 'rev-parse', '--verify', '-q', 'HEAD'], { cwd: root })).exitCode === 0
    await $.process.run(['git', 'read-tree', hasHead ? 'HEAD' : '--empty'], { cwd: root, env })
    const added = await $.process.run(['git', 'add', '-A', '--', '.'], { cwd: root, env, timeoutMs: 300_000 })
    if (added.exitCode !== 0) throw new Error(`git couldn't read the working tree: ${added.stderr.slice(0, 200)}`)
    const listed = await $.process.run(['git', 'ls-files', '-z'], { cwd: root, env })
    const secrets = listed.stdout.split('\0').filter(path => path !== '' && isSecretPath(path))
    if (secrets.length > 0) {
      await $.process.run(['git', '--literal-pathspecs', 'rm', '--cached', '-q', '--ignore-unmatch', '--pathspec-from-file=-', '--pathspec-file-nul'], { cwd: root, env, stdin: secrets.join('\0') })
    }
    const tree = (await $.process.run(['git', 'write-tree', ...(prefix === '' ? [] : [`--prefix=${prefix}`])], { cwd: root, env })).stdout.trim()
    const archived = await $.process.run(['git', 'archive', '--format=zip', '-o', zip, tree], { cwd: root, timeoutMs: 300_000 })
    if (archived.exitCode !== 0) throw new Error(`git couldn't zip the source: ${archived.stderr.slice(0, 200)}`)
  }
  const bytes = (await $.fs.stat(zip)).size
  return { zip, dir, bytes }
}

/** Packages, uploads and starts one build; the pane and status line follow it. */
async function launch($: EngineInterface, c: Config, startedBy: 'you' | 'claude'): Promise<BuildView> {
  const { plan, hasOwnBuildspec } = await inspectRepo($, c.repo)
  $.ui.status('☁️ packaging…')
  const source = await packageSource($, c.repo)
  const key = `sources/${c.project}/${await $.clock.now()}.zip`
  $.ui.status(`☁️ uploading ${(source.bytes / 1_048_576).toFixed(1)} MB…`)
  await awsMust($, c, ['s3', 'cp', source.zip, `s3://${c.bucket}/${key}`, '--only-show-errors'], 600_000)
  await $.process.run(['rm', '-f', source.zip, `${source.dir}/index`])
  await $.process.run(['rmdir', source.dir]).catch(() => undefined)

  const args = ['codebuild', 'start-build', '--project-name', c.project, '--source-type-override', 'S3', '--source-location-override', `${c.bucket}/${key}`,
    '--buildspec-override', hasOwnBuildspec ? 'buildspec.yml' : plan.yaml, '--compute-type-override', settings.computeType]
  if (plan.needsDocker) args.push('--privileged-mode-override')
  const started = await awsMust($, c, args)
  const view = parseBuild(started.build ?? {}, c, startedBy)

  active = { config: c, startedBy, plan, hasOwnBuildspec }
  logToken = undefined
  await $.store.set('active', { config: c, startedBy })
  await update($, logAtom, () => [])
  await update($, buildAtom, () => view)
  await update($, modeAtom, () => 'build')
  $.ui.status(statusText(view, await $.clock.now()))
  return view
}

async function fetchLogs($: EngineInterface, view: BuildView): Promise<void> {
  if (active === null || view.logGroup === undefined || view.logStream === undefined) return
  for (let page = 0; page < 3; page++) {
    const args = ['logs', 'get-log-events', '--log-group-name', view.logGroup, '--log-stream-name', view.logStream, '--start-from-head', '--limit', '500']
    if (logToken !== undefined) args.push('--next-token', logToken)
    const out = await awsCli($, active.config, args, 30_000)
    if (!out.ok) return
    const lines = (out.json.events ?? []).flatMap((event: { message?: string }) => String(event.message ?? '').replace(/\x1b\[[0-9;]*m/g, '').replace(/\n$/, '').split('\n'))
    const nextToken = out.json.nextForwardToken as string | undefined
    if (lines.length > 0) await update($, logAtom, log => [...log, ...lines].slice(-LOG_LINES))
    if (nextToken === undefined || nextToken === logToken || lines.length === 0) {
      logToken = nextToken ?? logToken
      return
    }
    logToken = nextToken
  }
}

/** Reads the build's progress and new log lines into the pane. */
async function refreshBuild($: EngineInterface): Promise<BuildView | null> {
  const current = await read($, buildAtom)
  if (active === null || current === null) return current
  const out = await awsMust($, active.config, ['codebuild', 'batch-get-builds', '--ids', current.id], 30_000)
  const view = parseBuild((out.builds ?? [])[0] ?? {}, active.config, active.startedBy)
  await update($, buildAtom, () => view)
  await fetchLogs($, view)
  $.ui.status(statusText(view, await $.clock.now()))
  return view
}

async function finishBuild($: EngineInterface, view: BuildView): Promise<void> {
  poller?.cancel()
  poller = null
  await $.store.delete('active')
  const took = duration((view.endedAt ?? view.startedAt) - view.startedAt)
  const cost = costOf((view.endedAt ?? view.startedAt) - view.startedAt, settings.computeType).toFixed(3)
  $.ui.toast(view.status === 'SUCCEEDED' ? `CodeBuild #${view.number} passed in ${took} (~$${cost})` : `CodeBuild #${view.number} ${view.status.toLowerCase()} in ${took}: ${view.failure ?? ''}`, { timeoutMs: 8000 })
}

async function tickBuild($: EngineInterface): Promise<void> {
  if (isTicking) return
  isTicking = true
  try {
    const view = await refreshBuild($)
    if (view !== null && isDone(view)) {
      await fetchLogs($, view)
      await finishBuild($, view)
    }
  } catch (error) {
    $.ui.status(`☁️ ${error instanceof Error ? error.message : String(error)}`.slice(0, 120))
  } finally {
    isTicking = false
  }
}

function followBuild($: EngineInterface): void {
  poller?.cancel()
  poller = $.clock.every(4000, () => void tickBuild($))
}

/** The wizard's button: set up what's missing, then build. */
async function setupAndBuild($: EngineInterface): Promise<void> {
  const w = await read($, wizardAtom)
  if (w === null || w.isBusy) return
  await update($, wizardAtom, x => (x === null ? x : { ...x, isBusy: true, message: w.isConfigured ? 'Starting the build…' : 'Setting up (first time takes ~20s)…' }))
  try {
    const { plan } = await inspectRepo($, w.repo)
    const c = await ensureSetup($, w.repo, w.profile, plan)
    await launch($, c, 'you')
    await update($, wizardAtom, x => (x === null ? x : { ...x, isBusy: false, isConfigured: true, message: '' }))
    followBuild($)
  } catch (error) {
    await update($, wizardAtom, x => (x === null ? x : { ...x, isBusy: false, message: `✗ ${error instanceof Error ? error.message : String(error)}` }))
  }
}

async function stopBuild($: EngineInterface): Promise<string> {
  const view = await read($, buildAtom)
  if (active === null || view === null || isDone(view)) return 'No build is running.'
  await awsMust($, active.config, ['codebuild', 'stop-build', '--id', view.id])
  await tickBuild($)
  return `Stopping build #${view.number}.`
}

async function askClaudeToFix($: EngineInterface): Promise<void> {
  const view = await read($, buildAtom)
  if (view === null) return
  const log = await read($, logAtom)
  await $.prompt.submit({ text: `My AWS CodeBuild build failed. Find the cause and fix it, then build again with the codebuild tool.\n\n${reportForClaude(view, log, settings.computeType)}` })
}

async function saveBuildspec($: EngineInterface, repo: string): Promise<string> {
  const { plan, hasOwnBuildspec } = await inspectRepo($, repo)
  if (hasOwnBuildspec) return `${repo} already has a buildspec.yml; it's used as is.`
  await $.fs.write(`${repo}/buildspec.yml`, plan.yaml)
  return `Wrote ${repo}/buildspec.yml (${plan.stack.join(' + ')}). Edit it and the next build uses it.`
}

/** Deletes what the mod created for this repo; the shared role and bucket only with `all`. */
async function teardown($: EngineInterface, repo: string, isAll: boolean): Promise<string> {
  const c = (await $.store.get(`repo:${repo}`)) as Config | undefined
  if (c === undefined) return `Nothing was set up for ${repo}.`
  const what = [`CodeBuild project ${c.project}`, `log group /aws/codebuild/${c.project}`, `uploaded sources s3://${c.bucket}/sources/${c.project}/`]
  if (isAll) what.push(`IAM role ${ROLE}`, `S3 bucket ${c.bucket} (if empty)`)
  let answer = 'Keep them'
  try {
    answer = await $.ui.ask(`Delete these from account ${c.account} (${c.region})?\n\n${what.map(x => `  • ${x}`).join('\n')}`, { header: 'codebuild', options: ['Delete', 'Keep them'] })
  } catch {
    return 'Not deleted: nobody to confirm.'
  }
  if (answer !== 'Delete') return 'Kept everything.'
  await awsCli($, c, ['codebuild', 'delete-project', '--name', c.project])
  await awsCli($, c, ['logs', 'delete-log-group', '--log-group-name', `/aws/codebuild/${c.project}`])
  await awsCli($, c, ['s3', 'rm', `s3://${c.bucket}/sources/${c.project}/`, '--recursive', '--only-show-errors'], 300_000)
  if (isAll) {
    await awsCli($, c, ['iam', 'delete-role-policy', '--role-name', ROLE, '--policy-name', 'claude-codebuild-run'])
    await awsCli($, c, ['iam', 'delete-role', '--role-name', ROLE])
    await awsCli($, c, ['s3api', 'delete-bucket', '--bucket', c.bucket])
  }
  await $.store.delete(`repo:${repo}`)
  return `Deleted: ${what.join(', ')}.`
}

/** The model's tool: confirm, set up if needed, build, wait, and report. */
async function buildForClaude($: EngineInterface, input: { repo?: unknown; profile?: unknown; wait?: unknown }, signal: AbortSignal): Promise<string> {
  const repo = await absoluteRepo($, typeof input.repo === 'string' ? input.repo : '')
  const saved = (await $.store.get(`repo:${repo}`)) as Config | undefined
  const profile = typeof input.profile === 'string' && input.profile !== '' ? input.profile : saved?.profile ?? settings.profile
  if (profile === '' && saved === undefined) {
    return `CodeBuild isn't set up for ${repo} yet. Ask the user to run /codebuild once to choose an AWS profile.`
  }
  const view = await read($, buildAtom)
  if (view !== null && !isDone(view)) return `Build #${view.number} is still running. Wait for it, or ask the user to stop it with /codebuild stop.`

  if (!isClaudeAllowed) {
    const creates = saved === undefined ? ' First run: creates a private S3 bucket, an IAM role and a CodeBuild project.' : ''
    let answer = "Don't build"
    try {
      answer = await $.ui.ask(`Claude wants to build ${repo} on AWS CodeBuild with profile "${profile}" (~$${PRICE_PER_MINUTE[settings.computeType] ?? 0.005}/min).${creates}`, { header: 'codebuild', options: ['Build', 'Allow this session', "Don't build"] })
    } catch {
      return 'The build needs the user\'s OK and nobody could be asked (headless run).'
    }
    if (answer === "Don't build") return 'The user declined the CodeBuild build.'
    if (answer === 'Allow this session') isClaudeAllowed = true
  }

  const { plan } = await inspectRepo($, repo)
  const c = await ensureSetup($, repo, profile, plan)
  await $.ui.open({ id: PANE, title: 'CodeBuild' })
  const started = await launch($, c, 'claude')
  if (input.wait === false) {
    followBuild($)
    return `Started CodeBuild build #${started.number}: ${started.consoleUrl}`
  }
  // Wait through $ calls (a process sleep), so the hook's own time stays tiny.
  for (let i = 0; i < 450; i++) {
    if (signal.aborted) {
      followBuild($)
      return `Stopped waiting; build #${started.number} keeps running and the pane follows it.`
    }
    await $.process.run(['sleep', '4'], { timeoutMs: 10_000 })
    const now = await refreshBuild($)
    if (now !== null && isDone(now)) {
      await fetchLogs($, now)
      await finishBuild($, now)
      return reportForClaude(now, await read($, logAtom), settings.computeType)
    }
  }
  followBuild($)
  return `Build #${started.number} is still running after 30 minutes; the pane keeps following it.`
}

export const register: Register = (on, options) => {
  settings = {
    profile: String(options.profile ?? ''),
    region: String(options.region ?? ''),
    computeType: String(options.computeType ?? 'BUILD_GENERAL1_SMALL'),
    image: String(options.image ?? 'aws/codebuild/amazonlinux-x86_64-standard:5.0'),
  }

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'codebuild',
      description: 'Build this repo on AWS CodeBuild: /codebuild [setup|stop|status|logs|buildspec [save]|teardown [all]|<path>]',
      argumentHint: '[setup | stop | status | logs | buildspec | teardown | <path>]',
    })
    await $.tool.register({
      name: 'build',
      description:
        'Build and test a repository on AWS CodeBuild (a clean Linux machine) and return the outcome and the relevant log lines. ' +
        'Uploads the working tree, uncommitted changes included. Use when the user asks to build or test on CodeBuild, in CI, or in the cloud, ' +
        'or to verify a fix there. The user confirms before it runs. After a failure, fix the cause and call it again.',
      inputSchema: {
        type: 'object',
        properties: {
          repo: { type: 'string', description: 'Folder to build; default: the project root' },
          profile: { type: 'string', description: 'AWS profile; default: the one this repo was set up with' },
          wait: { type: 'boolean', description: 'Wait for the result (default true)' },
        },
      },
    })
    // A reload mid-build: keep following it.
    const saved = (await $.store.get('active')) as { config: Config; startedBy: 'you' | 'claude' } | undefined
    const view = await read($, buildAtom)
    if (saved !== undefined && view !== null && !isDone(view)) {
      const { plan, hasOwnBuildspec } = await inspectRepo($, saved.config.repo).catch(() => ({ plan: planBuild({ names: [] }), hasOwnBuildspec: false }))
      active = { ...saved, plan, hasOwnBuildspec }
      followBuild($)
    }
    return next(e)
  })

  on('command.run', { command: 'codebuild' }, async ($, e) => {
    const [verb = '', ...rest] = e.args.trim().split(/\s+/)
    try {
      if (verb === 'stop') return { text: await stopBuild($) }
      if (verb === 'setup') {
        await openWizard($, rest.join(' '))
        return { text: 'Opened CodeBuild setup.' }
      }
      if (verb === 'status' || verb === 'logs') {
        const view = await read($, buildAtom)
        if (view === null) return { text: 'No build yet. Run /codebuild.' }
        if (verb === 'status') return { text: `${statusText(view, await $.clock.now())}\n${view.consoleUrl}` }
        return { text: (await read($, logAtom)).slice(-40).join('\n') || '(no log lines yet)' }
      }
      if (verb === 'buildspec') {
        const repo = await absoluteRepo($, '')
        if (rest[0] === 'save') return { text: await saveBuildspec($, repo) }
        const { plan, hasOwnBuildspec } = await inspectRepo($, repo)
        return { text: hasOwnBuildspec ? 'This repo has its own buildspec.yml; builds use it.' : `Generated for ${plan.stack.join(' + ')} (/codebuild buildspec save writes it):\n\n${plan.yaml}` }
      }
      if (verb === 'teardown') return { text: await teardown($, await absoluteRepo($, ''), rest[0] === 'all') }

      // `/codebuild [path]`: build now if this repo is set up, else open the setup screen.
      const repo = await absoluteRepo($, verb === '' ? '' : [verb, ...rest].join(' '))
      const saved = (await $.store.get(`repo:${repo}`)) as Config | undefined
      if (saved === undefined) {
        await openWizard($, repo)
        return { text: 'Pick an AWS profile in the CodeBuild pane, then press Set up & build.' }
      }
      const view = await read($, buildAtom)
      if (view !== null && !isDone(view)) {
        await $.ui.open({ id: PANE, title: 'CodeBuild' })
        return { text: `Build #${view.number} is still running.` }
      }
      await $.ui.open({ id: PANE, title: 'CodeBuild' })
      const started = await launch($, saved, 'you')
      followBuild($)
      return { text: `Started build #${started.number} of ${repo} on ${saved.project} (${saved.region}).` }
    } catch (error) {
      $.ui.status(undefined)
      return { text: `✗ ${error instanceof Error ? error.message : String(error)}` }
    }
  })

  on('tool.call', { tool: TOOL }, async ($, e, next) => {
    try {
      return { result: await buildForClaude($, e as { repo?: unknown; profile?: unknown; wait?: unknown }, next.signal) }
    } catch (error) {
      return { result: `CodeBuild couldn't run: ${error instanceof Error ? error.message : String(error)}` }
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    if (e.surface === 'mobile') {
      const { Text } = $.ui.resolve(e)
      const view = await read($, buildAtom)
      return <Text>{view === null ? 'Open CodeBuild from the terminal or desktop app.' : statusText(view, Date.now())}</Text>
    }
    const { Box, Button, Text, Select, Input, Markdown, Link } = $.ui.resolve(e)
    const width = Math.max(30, e.props.bodyColumns - 2)
    const mode = await read($, modeAtom)
    const build = await read($, buildAtom)
    const w = await read($, wizardAtom)

    if (mode === 'wizard' || build === null) {
      if (w === null) return <Text dimColor>Run /codebuild to set up a build.</Text>
      return (
        <Box flexDirection="column">
          <Text bold>☁️ Build on AWS CodeBuild</Text>
          {w.profiles.length > 0 ? (
            <Select key="profile" label="AWS profile" value={w.profile} options={(w.profiles.includes(w.profile) || w.profile === '' ? w.profiles : [w.profile, ...w.profiles]).map(p => ({ value: p, label: p }))} onSelect={value => void pickProfile($, value)} />
          ) : (
            <Input key="profile-name" label="AWS profile" value={w.profile} placeholder="default" submitLabel="Check" onSubmit={value => void pickProfile($, value)} />
          )}
          <Text color={w.isIdentityOk ? 'green' : 'red'} wrap="wrap">{`  ${w.identity}`}</Text>
          <Input key="repo" label="Repo" value={w.repo} submitLabel="Use" onSubmit={value => void pickRepo($, value)} />
          <Text dimColor wrap="wrap">{`  ${w.stack} · ${w.hasOwnBuildspec ? 'your buildspec.yml' : 'buildspec generated for you'}`}</Text>
          <Text dimColor wrap="wrap">
            {w.isConfigured ? '  Already set up: builds start right away.' : '  First run creates: a private S3 bucket (sources expire in 7 days), one least-privilege IAM role, one CodeBuild project.'}
          </Text>
          <Text dimColor>{`  ~$${PRICE_PER_MINUTE[settings.computeType] ?? 0.005}/min · ${settings.computeType.replace('BUILD_GENERAL1_', '').toLowerCase()} Linux machine`}</Text>
          {w.message !== '' && <Text color={w.message.startsWith('✗') ? 'red' : 'yellow'} wrap="wrap">{w.message}</Text>}
          {w.showBuildspec && <Markdown key="spec" text={'```yaml\n' + w.buildspec + '```'} />}
          <Box flexDirection="row" columnGap={1}>
            <Button key="go" variant="primary" hotkey="b" label={w.isBusy ? 'Working…' : w.isConfigured ? 'Build' : 'Set up & build'} onPress={() => void setupAndBuild($)} />
            {!w.hasOwnBuildspec && <Button key="spec-toggle" hotkey="s" label={w.showBuildspec ? 'Hide buildspec' : 'Show buildspec'} onPress={() => void update($, wizardAtom, x => (x === null ? x : { ...x, showBuildspec: !x.showBuildspec }))} />}
            <Button key="cancel" hotkey="x" label="Close" role="dismiss" onPress={() => void $.ui.close({ id: PANE })} />
          </Box>
        </Box>
      )
    }

    const log = await read($, logAtom)
    const isRunning = !isDone(build)
    const color = build.status === 'SUCCEEDED' ? 'green' : isRunning ? 'yellow' : 'red'
    const glyph = (status: string) => (status === 'SUCCEEDED' ? '✓' : status === 'IN_PROGRESS' ? (isRunning ? '◐' : '✓') : '✗')
    const phases = shownPhases(build).map(p => `${glyph(p.status)} ${p.name.toLowerCase().replace(/_/g, ' ')}${p.seconds ? ` ${p.seconds}s` : ''}`).join('  ')
    const rows = e.props.placement === 'dock' ? Math.max(4, e.props.scroll.bodyRows - 9) : 14
    return (
      <Box flexDirection="column">
        <Text bold color={color}>{statusText(build, Date.now())}</Text>
        <Text dimColor wrap="truncate-end">{`${build.project} · started by ${build.startedBy}${build.failure ? ` · ${build.failure}` : ''}`}</Text>
        <Text wrap="wrap">{phases || 'submitted'}</Text>
        <Box flexDirection="column">
          {(log.length === 0 ? ['(waiting for logs…)'] : usefulLog(build, log).slice(-rows)).map((line, i) => (
            <Text key={`l${i}`} dimColor wrap="truncate-end">{line.slice(0, width)}</Text>
          ))}
        </Box>
        <Box flexDirection="row" columnGap={1}>
          {isRunning && <Button key="stop" hotkey="s" label="Stop" onPress={() => void stopBuild($)} />}
          {!isRunning && build.status !== 'SUCCEEDED' && <Button key="fix" variant="primary" hotkey="f" label="Ask Claude to fix" onPress={() => void askClaudeToFix($)} />}
          {!isRunning && <Button key="again" hotkey="b" label="Build again" onPress={() => void (active ? launch($, active.config, 'you').then(() => followBuild($)) : Promise.resolve())} />}
          <Button key="settings" hotkey="p" label="Settings" onPress={() => void openWizard($, active?.config.repo ?? '')} />
          <Button key="close" hotkey="x" label="Close" role="dismiss" onPress={() => void $.ui.close({ id: PANE })} />
        </Box>
        <Link href={build.consoleUrl} label="Open in the AWS console" />
      </Box>
    )
  })
}
