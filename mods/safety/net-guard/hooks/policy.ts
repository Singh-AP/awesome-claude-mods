// What to do about one request: no `$`, pure.

import { DEFAULT_ALLOW, DEFAULT_DENY, isLocal, isPrivate, matches, parseList } from './hosts'
import { carriesData, type Request } from './requests'

export type Mode = 'ask' | 'allow' | 'deny'
export type Action = 'allow' | 'ask' | 'deny'

export type Policy = {
  userAllow: string[]
  userDeny: string[]
  allow: string[]
  deny: string[]
  unknown: Mode
  fetchUnknown: Mode
  askUploads: 'unlisted' | 'always' | 'never'
  allowPrivate: boolean
}

export type Decision = { action: Action; why: string; host: string | null }

const mode = (value: unknown, fallback: Mode): Mode => (value === 'ask' || value === 'allow' || value === 'deny' ? value : fallback)

/** The policy the plugin's options describe. */
export function policyFrom(options: Readonly<Record<string, unknown>>): Policy {
  const useDefaults = options.useDefaultLists !== false
  const uploads = options.askUploads
  return {
    userAllow: parseList(String(options.allow ?? '')),
    userDeny: parseList(String(options.deny ?? '')),
    allow: useDefaults ? DEFAULT_ALLOW : [],
    deny: useDefaults ? DEFAULT_DENY : [],
    unknown: mode(options.unknown, 'ask'),
    fetchUnknown: mode(options.fetchUnknown, 'allow'),
    askUploads: uploads === 'always' || uploads === 'never' ? uploads : 'unlisted',
    allowPrivate: options.allowPrivate !== false,
  }
}

/**
 * The verdict for one request. Order: your deny list, your allow list, the
 * built-in deny list, then this machine, the built-in allow list and hosts
 * allowed this session, private networks, and last the unknown-host modes.
 */
export function decide(request: Request, policy: Policy, sessionHosts: ReadonlySet<string>): Decision {
  const target = request.target
  if (target === null) {
    const action = policy.unknown === 'allow' && !request.isUpload ? 'allow' : policy.unknown === 'deny' ? 'deny' : 'ask'
    return { action, why: `connects to a host only known when it runs (${request.raw})`, host: null }
  }
  const host = target.host
  const uploadVerb = request.isUpload ? 'sends data to' : 'connects to'

  if (policy.userDeny.some(p => matches(target, p))) return { action: 'deny', why: `${uploadVerb} ${host}, which is on your deny list`, host }
  const isUserAllowed = policy.userAllow.some(p => matches(target, p))
  if (!isUserAllowed && policy.deny.some(p => matches(target, p))) {
    return { action: 'deny', why: `${uploadVerb} ${host}, a paste, request-catcher or tunnel service often used to smuggle data out`, host }
  }
  if (isLocal(host)) return { action: 'allow', why: 'this machine', host }

  const isListed = isUserAllowed || sessionHosts.has(host) || policy.allow.some(p => matches(target, p)) || (policy.allowPrivate && isPrivate(host))
  if (request.isUpload && policy.askUploads === 'always') return { action: 'ask', why: `sends data to ${host}`, host }
  if (isListed) return { action: 'allow', why: 'allowed', host }

  if (request.isUpload && policy.askUploads === 'unlisted') {
    return { action: policy.unknown === 'deny' ? 'deny' : 'ask', why: `sends data to ${host}, which isn't on the allow list`, host }
  }
  if (request.tool === 'WebFetch') {
    if (policy.fetchUnknown !== 'deny' && carriesData(target)) return { action: 'ask', why: `fetches ${host} with what looks like data packed into the URL`, host }
    return { action: policy.fetchUnknown, why: `fetches ${host}, which isn't on the allow list`, host }
  }
  return { action: policy.unknown, why: `connects to ${host}, which isn't on the allow list`, host }
}

const RANK: Record<Action, number> = { allow: 0, ask: 1, deny: 2 }

/** The decisions for every request in a call, worst first. */
export function judge(requests: readonly Request[], policy: Policy, sessionHosts: ReadonlySet<string>): Array<{ request: Request; decision: Decision }> {
  return requests
    .map(request => ({ request, decision: decide(request, policy, sessionHosts) }))
    .sort((a, b) => RANK[b.decision.action] - RANK[a.decision.action])
}
