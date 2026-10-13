// Names, policies, parsing and wording for the codebuild mod. Pure: no `$`.

import type { BuildView } from '../types'

export type Target = { profile: string; region: string; account: string }

export type Config = Target & { repo: string; project: string; bucket: string; role: string }


export const ROLE = 'claude-codebuild-service-role'
export const TAG = { Key: 'created-by', Value: 'claude-codebuild-mod' }

// On-demand Linux prices per minute, us-east-1. An estimate, not a bill.
export const PRICE_PER_MINUTE: Record<string, number> = {
  BUILD_GENERAL1_SMALL: 0.005,
  BUILD_GENERAL1_MEDIUM: 0.01,
  BUILD_GENERAL1_LARGE: 0.02,
}

export const bucketName = (account: string, region: string) => `claude-codebuild-${account}-${region}`

/** `claude-<repo folder>-<6 hex of the path>`: stable per repo, unique across same-named folders. */
export function projectName(repo: string): string {
  const base = (repo.replace(/\/+$/, '').split('/').pop() || 'repo').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'repo'
  let hash = 2166136261
  for (const ch of repo) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619) >>> 0
  return `claude-${base}-${hash.toString(16).padStart(8, '0').slice(0, 6)}`
}

export const trustPolicy = (account: string) => ({
  Version: '2012-10-17',
  Statement: [{
    Effect: 'Allow',
    Principal: { Service: 'codebuild.amazonaws.com' },
    Action: 'sts:AssumeRole',
    Condition: { StringEquals: { 'aws:SourceAccount': account } },
  }],
})

/** Logs for claude-* projects, and read access to their uploaded sources: nothing else. */
export const rolePolicy = (account: string) => ({
  Version: '2012-10-17',
  Statement: [
    {
      Effect: 'Allow',
      Action: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
      Resource: [`arn:aws:logs:*:${account}:log-group:/aws/codebuild/claude-*`, `arn:aws:logs:*:${account}:log-group:/aws/codebuild/claude-*:*`],
    },
    {
      Effect: 'Allow',
      Action: ['s3:GetObject', 's3:GetObjectVersion'],
      Resource: [`arn:aws:s3:::claude-codebuild-${account}-*/sources/*`],
    },
    {
      Effect: 'Allow',
      Action: ['s3:GetBucketLocation', 's3:GetBucketAcl'],
      Resource: [`arn:aws:s3:::claude-codebuild-${account}-*`],
    },
  ],
})

export const lifecycle = {
  Rules: [{ ID: 'expire-claude-sources', Status: 'Enabled', Filter: { Prefix: 'sources/' }, Expiration: { Days: 7 } }],
}

export function projectInput(c: Config, options: { computeType: string; image: string; privileged: boolean }) {
  return {
    name: c.project,
    description: `Builds ${c.repo} from Claude Code (codebuild mod)`,
    source: { type: 'NO_SOURCE', buildspec: 'version: 0.2\nphases:\n  build:\n    commands:\n      - echo "Started without a source: run it from Claude Code with /codebuild."\n' },
    artifacts: { type: 'NO_ARTIFACTS' },
    environment: { type: 'LINUX_CONTAINER', image: options.image, computeType: options.computeType, privilegedMode: options.privileged },
    serviceRole: `arn:aws:iam::${c.account}:role/${ROLE}`,
    timeoutInMinutes: 30,
    logsConfig: { cloudWatchLogs: { status: 'ENABLED', groupName: `/aws/codebuild/${c.project}` } },
    tags: [{ key: TAG.Key, value: TAG.Value }],
  }
}

export const consoleUrl = (c: Config, buildId: string) =>
  `https://${c.region}.console.aws.amazon.com/codesuite/codebuild/${c.account}/projects/${c.project}/build/${encodeURIComponent(buildId)}/?region=${c.region}`

type RawPhase = { phaseType?: string; phaseStatus?: string; durationInSeconds?: number; contexts?: { message?: string }[] }
type RawBuild = {
  id?: string; buildNumber?: number; projectName?: string; buildStatus?: string; currentPhase?: string
  startTime?: string | number; endTime?: string | number; phases?: RawPhase[]
  logs?: { groupName?: string; streamName?: string }
}

const time = (t: string | number | undefined) => (t === undefined ? undefined : typeof t === 'number' ? t * 1000 : Date.parse(t))

/** One build from `batch-get-builds`, as the pane draws it. */
export function parseBuild(raw: RawBuild, c: Config, startedBy: 'you' | 'claude'): BuildView {
  const phases = (raw.phases ?? []).map(p => ({ name: p.phaseType ?? '?', status: p.phaseStatus ?? 'IN_PROGRESS', seconds: p.durationInSeconds }))
  const failed = (raw.phases ?? []).find(p => p.phaseStatus !== undefined && !['SUCCEEDED', 'IN_PROGRESS'].includes(p.phaseStatus))
  const id = raw.id ?? ''
  return {
    id,
    number: raw.buildNumber ?? 0,
    project: raw.projectName ?? c.project,
    status: raw.buildStatus ?? 'IN_PROGRESS',
    phase: raw.currentPhase ?? 'SUBMITTED',
    phases,
    startedAt: time(raw.startTime) ?? 0,
    endedAt: time(raw.endTime),
    logGroup: raw.logs?.groupName,
    logStream: raw.logs?.streamName,
    consoleUrl: consoleUrl(c, id),
    startedBy,
    failure: failed === undefined ? undefined : `${failed.phaseType}: ${failed.contexts?.map(x => x.message).filter(Boolean).join('; ') || failed.phaseStatus}`,
  }
}

export const isDone = (b: BuildView) => b.status !== 'IN_PROGRESS'

// Phases worth a glance; the rest (queued, finalizing...) show only when they fail.
const MAIN_PHASES = ['PROVISIONING', 'DOWNLOAD_SOURCE', 'INSTALL', 'PRE_BUILD', 'BUILD', 'POST_BUILD']

/** The phases the pane lists: the main ones, plus any that failed. */
export const shownPhases = (b: BuildView) =>
  b.phases.filter(p => MAIN_PHASES.includes(p.name) || (p.status !== 'SUCCEEDED' && p.status !== 'IN_PROGRESS' && p.name !== 'COMPLETED'))

/**
 * The log lines that explain the outcome: for a failed build, everything up
 * to CodeBuild's "Command did not exit successfully" line, not the bookkeeping after it.
 */
export function usefulLog(b: BuildView, log: readonly string[]): readonly string[] {
  const lines = log.filter(line => !isBookkeeping(line))
  if (b.status === 'SUCCEEDED' || b.status === 'IN_PROGRESS') return lines
  const at = lines.findIndex(line => /Command did not exit successfully|Phase complete: \w+ State: FAILED/.test(line))
  return at < 0 ? lines : lines.slice(0, at + 1)
}

// CodeBuild's own housekeeping lines: kept in the console, left out of the pane and of Claude's report.
const BOOKKEEPING = /^\[Container\] \S+ \S+ (Phase context status code|Expanding|Assembling file list|Set report auto-discover|No matching auto-discover|Report auto-discover|Skip cleanup|Selecting|Processing environment|Moving to directory|Registering with agent|Waiting for agent|Phases found|Cache is not defined|Successfully updated|Waiting for DOWNLOAD_SOURCE|Entering phase|Phase complete: (?!BUILD State: FAILED))/

export const isBookkeeping = (line: string) => BOOKKEEPING.test(line)

export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
}

export const costOf = (ms: number, computeType: string) => (Math.max(1, Math.ceil(ms / 60_000)) * (PRICE_PER_MINUTE[computeType] ?? 0.005))

/** The status line: `☁️ #14 · BUILD · 1m 20s`, or the outcome. */
export function statusText(b: BuildView, now: number): string {
  const took = duration((b.endedAt ?? now) - (b.startedAt || now))
  if (b.status === 'SUCCEEDED') return `☁️ ✅ #${b.number} passed · ${took}`
  if (b.status === 'IN_PROGRESS') return `☁️ #${b.number} · ${b.phase} · ${took}`
  return `☁️ ❌ #${b.number} ${b.status.toLowerCase().replace('_', ' ')}${b.failure ? ` in ${b.failure.split(':')[0]}` : ''} · ${took}`
}

/** Files that never leave the machine, whatever .gitignore says. */
export function isSecretPath(path: string): boolean {
  const name = path.split('/').pop() ?? ''
  if (/^\.env(\..+)?$/.test(name)) return !/\.(example|sample|template|dist)$/.test(name)
  return /\.(pem|key|p12|pfx)$/.test(name) || /^id_(rsa|ed25519|ecdsa|dsa)/.test(name) || /^\.?(npmrc|netrc|pypirc)$/.test(name) || name === 'credentials'
}

/** Turns an AWS CLI failure into what the person should do. */
export function explainAwsError(stderr: string, profile: string): string {
  const text = stderr.trim()
  if (/could not be found/.test(text) && /profile/i.test(text)) return `AWS profile "${profile}" doesn't exist. Pick another, or create it with: aws configure --profile ${profile}`
  if (/Unable to locate credentials|NoCredentialProviders/.test(text)) return `Profile "${profile}" has no credentials. Run: aws configure --profile ${profile}  (or aws sso login --profile ${profile})`
  if (/Token has expired|SSO session|token.*expired|ExpiredToken|refresh failed|UnauthorizedSSOToken/i.test(text)) return `Your AWS session for "${profile}" expired. Run: aws sso login --profile ${profile}`
  const action = text.match(/not authorized to perform: ([\w:*-]+)/)?.[1]
  if (action !== undefined) return `Your AWS identity isn't allowed ${action}. Ask an admin to grant it, or use a profile with more access.`
  if (/AccessDenied/.test(text)) return `AWS refused the request (AccessDenied): ${text.split('\n')[0]?.slice(0, 200)}`
  return text.split('\n').filter(Boolean).slice(-2).join(' ').slice(0, 300) || 'the AWS CLI failed without saying why'
}

/** What Claude reads after a build: outcome, link, and the log lines that matter. */
export function reportForClaude(b: BuildView, log: readonly string[], computeType: string): string {
  const took = duration((b.endedAt ?? b.startedAt) - b.startedAt)
  const head = `CodeBuild build #${b.number} (${b.project}) ${b.status} after ${took}, about $${costOf((b.endedAt ?? b.startedAt) - b.startedAt, computeType).toFixed(3)}.`
  const lines = [head, `Console: ${b.consoleUrl}`]
  if (b.failure !== undefined) lines.push(`Failed phase: ${b.failure}`)
  const tail = usefulLog(b, log).slice(b.status === 'SUCCEEDED' ? -15 : -80)
  if (tail.length > 0) lines.push('', `Last ${tail.length} log lines:`, '```', ...tail, '```')
  return lines.join('\n')
}

/** What the person's AWS identity needs, for a sign-in request: every action, scoped to what the mod touches. */
export function requiredPermissions(account: string): string {
  const where = account === '' ? 'your account' : `account ${account}`
  const own = account === '' ? '<account>' : account
  return [
    `In ${where}, any region:`,
    '- sts:GetCallerIdentity',
    `- S3 on buckets claude-codebuild-${own}-*: ListBucket, CreateBucket, PutBucketPublicAccessBlock, PutLifecycleConfiguration, PutBucketTagging, GetBucketLocation, PutObject, GetObject, DeleteObject (under sources/claude-*), DeleteBucket`,
    `- IAM on role ${ROLE}: GetRole, CreateRole, TagRole, PutRolePolicy, PassRole (to codebuild.amazonaws.com), DeleteRolePolicy, DeleteRole`,
    '- CodeBuild on projects claude-*: BatchGetProjects, CreateProject, StartBuild, BatchGetBuilds, StopBuild, DeleteProject',
    '- CloudWatch Logs on log groups /aws/codebuild/claude-*: GetLogEvents, DescribeLogStreams, DeleteLogGroup',
  ].join('\n')
}

/** The request Claude gets when nobody is signed in: sign-in is the environment's business, so Claude picks the way. */
export function signInRequest(profiles: string, permissions: string): string {
  return [
    'I want to build this repo on AWS CodeBuild with the codebuild mod, but none of my AWS profiles has working credentials' + (profiles === '' ? '.' : ` (${profiles}).`),
    'Get me working credentials in an AWS profile, using whatever this environment provides for AWS sign-in (an AWS credentials tool if you have one, else tell me the exact command to run, such as aws sso login --profile <name> or aws configure).',
    'If you need an account ID, a role or a profile name and can\'t find them from my configured profiles, ask me.',
    'The profile needs these permissions:',
    permissions,
    'Don\'t start a build yourself; the mod checks the profiles again when you\'re done.',
  ].join('\n')
}
