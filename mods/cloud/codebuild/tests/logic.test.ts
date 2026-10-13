import { describe, expect, test } from 'claude-code/testing'

import { explainAwsError, isSecretPath, parseBuild, projectName, rolePolicy, shownPhases, statusText, trustPolicy, usefulLog, type Config } from '../hooks/aws'
import { planBuild, yamlString } from '../hooks/buildspec'

const C: Config = { profile: 'dev', region: 'us-west-2', account: '123456789012', repo: '/work/app', project: 'claude-app-abc123', bucket: 'claude-codebuild-123456789012-us-west-2', role: 'claude-codebuild-service-role' }

describe('buildspec generation', () => {
  test('npm with a lockfile, build and test scripts', () => {
    const plan = planBuild({ names: ['package.json', 'package-lock.json'], packageJson: { scripts: { build: 'tsc', test: 'vitest run' } }, nodeVersion: 'v20.11.0' })
    expect(plan.stack).toEqual(['node (npm)'])
    expect(plan.yaml).toContain('nodejs: 20')
    expect(plan.yaml).toContain('- npm ci')
    expect(plan.yaml).toContain('- npm run build')
    expect(plan.yaml).toContain('- npm test')
  })
  test('the npm placeholder test script is skipped, pnpm and yarn are detected', () => {
    expect(planBuild({ names: ['package.json'], packageJson: { scripts: { test: 'echo "Error: no test specified" && exit 1' } } }).yaml).not.toContain('npm test')
    expect(planBuild({ names: ['package.json', 'pnpm-lock.yaml'], packageJson: { scripts: { test: 'jest' } } }).yaml).toContain('pnpm install --frozen-lockfile')
    expect(planBuild({ names: ['package.json', 'yarn.lock', '.yarnrc.yml'] }).yaml).toContain('yarn install --immutable')
  })
  test('an unsupported runtime version is left to the image default', () => {
    expect(planBuild({ names: ['package.json'], nodeVersion: '16' }).yaml).not.toContain('runtime-versions')
  })
  test('python, go, rust, gradle, make and docker', () => {
    const py = planBuild({ names: ['pyproject.toml', 'tests'], pythonVersion: '3.12.1' })
    expect(py.yaml).toContain('python: 3.12')
    expect(py.yaml).toContain('python -m pytest')
    expect(planBuild({ names: ['go.mod'] }).yaml).toContain('go test ./...')
    expect(planBuild({ names: ['Cargo.toml'] }).yaml).toContain('cargo test --locked')
    expect(planBuild({ names: ['build.gradle.kts', 'gradlew'] }).yaml).toContain('./gradlew build')
    expect(planBuild({ names: ['Makefile'], makefile: 'all:\n\tcc x.c\ntest:\n\t./t\n' }).yaml).toContain('make test')
    const docker = planBuild({ names: ['Dockerfile'] })
    expect(docker.needsDocker).toBe(true)
    expect(docker.yaml).toContain('docker build')
  })
  test('nothing recognisable still gives a valid buildspec that says what to do', () => {
    const plan = planBuild({ names: ['notes.txt'] })
    expect(plan.stack).toEqual(['unknown'])
    expect(plan.yaml).toMatch(/version: 0\.2[\s\S]*build:[\s\S]*buildspec\.yml/)
  })
  test('commands YAML would misread are quoted', () => {
    expect(yamlString('npm ci')).toBe('npm ci')
    expect(yamlString('echo "a: b"')).toBe(JSON.stringify('echo "a: b"'))
    expect(yamlString('. "$HOME/.cargo/env"')).toBe(JSON.stringify('. "$HOME/.cargo/env"'))
  })
})

describe('aws helpers', () => {
  test('project names are stable, valid and unique per path', () => {
    expect(projectName('/work/My App')).toMatch(/^claude-my-app-[0-9a-f]{6}$/)
    expect(projectName('/work/My App')).toBe(projectName('/work/My App'))
    expect(projectName('/a/api')).not.toBe(projectName('/b/api'))
  })
  test('secret files never leave the machine', () => {
    for (const path of ['.env', 'api/.env.local', '.env.production', 'certs/server.pem', 'deploy.key', '.ssh/id_ed25519', '.npmrc', 'credentials']) expect(isSecretPath(path)).toBe(true)
    for (const path of ['.env.example', 'src/env.ts', 'README.md', 'keys.ts', 'src/credentials.ts']) expect(isSecretPath(path)).toBe(false)
  })
  test('the role trusts only CodeBuild for this account and reaches only claude-* resources', () => {
    expect(trustPolicy('123456789012').Statement[0]!.Condition.StringEquals['aws:SourceAccount']).toBe('123456789012')
    const resources = rolePolicy('123456789012').Statement.flatMap(s => s.Resource)
    expect(resources.every(r => r.includes('claude-'))).toBe(true)
  })
  test('AWS CLI failures become something to do', () => {
    expect(explainAwsError('Error when retrieving token from sso: Token has expired and refresh failed', 'dev')).toMatch(/aws sso login --profile dev/)
    expect(explainAwsError('The config profile (nope) could not be found', 'nope')).toMatch(/doesn't exist/)
    expect(explainAwsError('An error occurred (AccessDenied) ... is not authorized to perform: iam:CreateRole on resource', 'dev')).toMatch(/isn't allowed iam:CreateRole/)
    expect(explainAwsError('Unable to locate credentials. You can configure credentials by running "aws configure".', 'dev')).toMatch(/aws configure --profile dev/)
  })
  test('a failed build names its phase and reason', () => {
    const view = parseBuild({
      id: 'claude-app:1', buildNumber: 7, buildStatus: 'FAILED', currentPhase: 'COMPLETED', startTime: '2026-10-13T10:00:00Z', endTime: '2026-10-13T10:02:05Z',
      phases: [{ phaseType: 'INSTALL', phaseStatus: 'SUCCEEDED', durationInSeconds: 20 }, { phaseType: 'BUILD', phaseStatus: 'FAILED', durationInSeconds: 95, contexts: [{ message: 'COMMAND_EXECUTION_ERROR: npm test exit status 1' }] }],
    }, C, 'you')
    expect(view.failure).toBe('BUILD: COMMAND_EXECUTION_ERROR: npm test exit status 1')
    expect(statusText(view, 0)).toBe('☁️ ❌ #7 failed in BUILD · 2m 05s')
    expect(view.consoleUrl).toContain('us-west-2.console.aws.amazon.com/codesuite/codebuild/123456789012/projects/claude-app-abc123/build/claude-app%3A1')
  })
})

test('a failed build shows the lines that explain it, not the bookkeeping after', () => {
  const view = parseBuild({ buildStatus: 'FAILED', phases: [
    { phaseType: 'QUEUED', phaseStatus: 'SUCCEEDED' }, { phaseType: 'INSTALL', phaseStatus: 'SUCCEEDED' },
    { phaseType: 'BUILD', phaseStatus: 'FAILED' }, { phaseType: 'FINALIZING', phaseStatus: 'SUCCEEDED' }, { phaseType: 'COMPLETED' },
  ] }, C, 'you')
  expect(shownPhases(view).map(p => p.name)).toEqual(['INSTALL', 'BUILD'])
  const log = ['npm test', 'not ok 1 - totals', '[Container] Command did not exit successfully npm test exit status 1', '[Container] Entering phase POST_BUILD', '[Container] Expanding **/*']
  expect(usefulLog(view, log).at(-1)).toMatch(/did not exit successfully/)
  expect(usefulLog({ ...view, status: 'SUCCEEDED' }, log)).toEqual(log)
})

test('CodeBuild bookkeeping is left out, commands and output stay', () => {
  const view = parseBuild({ buildStatus: 'SUCCEEDED' }, C, 'you')
  const log = [
    '[Container] 2026/10/13 09:57:30.1 Running command npm test',
    '# pass 1',
    '[Container] 2026/10/13 09:57:43.9 Phase complete: BUILD State: SUCCEEDED',
    '[Container] 2026/10/13 09:57:43.9 Phase context status code:  Message:',
    '[Container] 2026/10/13 09:57:44.0 Expanding **/*',
  ]
  expect(usefulLog(view, log)).toEqual(log.slice(0, 2))
})
