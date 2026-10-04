import { expect, mock, test } from 'claude-code/testing'

const NOW = Date.parse('2026-10-04T00:00:00Z')
const BASH_OK = { result: { stdout: 'added 1 package', stderr: '', interrupted: false } }
const TYPED = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } } as const

type Reply = { status: number; body?: unknown }

// A registry in memory: each URL's answer, and every request made.
function registry(routes: Record<string, Reply>) {
  const calls: string[] = []
  const answer = (url: string, method: string) => {
    calls.push(`${method} ${url}`)
    const hit = routes[url] ?? { status: 404, body: { error: 'Not found' } }
    return {
      value: {
        status: hit.status,
        ok: hit.status >= 200 && hit.status < 300,
        headers: {},
        text: method === 'HEAD' || hit.body === undefined ? '' : JSON.stringify(hit.body),
      },
    }
  }
  return { calls, answer }
}

const POPULAR: Record<string, Reply> = {
  'https://registry.npmjs.org/react': { status: 200, body: { name: 'react' } },
  'https://api.npmjs.org/downloads/point/last-week/react': { status: 200, body: { downloads: 222767611 } },
}
const FRESH: Record<string, Reply> = {
  'https://registry.npmjs.org/shiny-new-thing': {
    status: 200,
    body: { name: 'shiny-new-thing', versions: { '0.0.1': {} }, time: { created: '2026-10-02T09:00:00Z' } },
  },
  'https://api.npmjs.org/downloads/point/last-week/shiny-new-thing': { status: 200, body: { downloads: 4 } },
}

test('a package that does not exist is blocked before npm runs', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on)
  const toasts: string[] = []
  on('ui.toast', ($, e) => (toasts.push(e.text), { value: undefined }))
  const reg = registry({})
  on('http.fetch', ($, e) => reg.answer(e.url, e.init?.method ?? 'GET'))
  let ran = 0
  on('tool.call', () => (ran++, BASH_OK))

  const out = await $.tool.call({ tool: 'Bash', command: 'npm install react-hooks-super-utils-acm' })

  expect(out.deny).toMatch(/no package named "react-hooks-super-utils-acm" exists on npm/)
  expect(out.deny).toMatch(/slopsquatting/)
  expect(ran).toBe(0)
  expect(toasts[0]).toMatch(/blocked "react-hooks-super-utils-acm" \(npm\): no such package/)
})

test('a popular package runs, checked by HEAD and downloads alone', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on)
  const reg = registry(POPULAR)
  on('http.fetch', ($, e) => reg.answer(e.url, e.init?.method ?? 'GET'))
  let ran = 0
  on('tool.call', () => (ran++, BASH_OK))

  const out = await $.tool.call({ tool: 'Bash', command: 'npm i react' })

  expect(out.deny).toBeUndefined()
  expect(ran).toBe(1)
  expect(reg.calls.sort()).toEqual([
    'GET https://api.npmjs.org/downloads/point/last-week/react',
    'HEAD https://registry.npmjs.org/react',
  ])
})

test('a brand-new, unused package asks first, and runs when you say so', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on)
  const reg = registry(FRESH)
  on('http.fetch', ($, e) => reg.answer(e.url, e.init?.method ?? 'GET'))
  const asked: string[] = []
  let ran = 0
  on('tool.call', ($, e) => {
    if (e.tool === 'AskUserQuestion') {
      const q = e.questions[0]!.question
      asked.push(q)
      return { result: { questions: e.questions, answers: { [q]: 'Install anyway' } } }
    }
    ran++
    return BASH_OK
  })

  const out = await $.tool.call({ tool: 'Bash', command: 'npm install shiny-new-thing' })

  expect(out.deny).toBeUndefined()
  expect(ran).toBe(1)
  expect(asked[0]).toMatch(/shiny-new-thing \(npm\): it was first published 1 day ago; it has only 4 downloads a week/)
})

test('a risky package is refused when you block it', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on)
  const reg = registry(FRESH)
  on('http.fetch', ($, e) => reg.answer(e.url, e.init?.method ?? 'GET'))
  let ran = 0
  on('tool.call', ($, e) => {
    if (e.tool === 'AskUserQuestion') {
      const q = e.questions[0]!.question
      return { result: { questions: e.questions, answers: { [q]: 'Block it' } } }
    }
    ran++
    return BASH_OK
  })

  const out = await $.tool.call({ tool: 'Bash', command: 'npm install shiny-new-thing' })

  expect(out.deny).toMatch(/blocked this install after a risk check/)
  expect(ran).toBe(0)
})

test('an unreachable registry lets the install run, with one toast', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on)
  const toasts: string[] = []
  on('ui.toast', ($, e) => (toasts.push(e.text), { value: undefined }))
  on('http.fetch', () => ({ deny: 'offline' }))
  let ran = 0
  on('tool.call', () => (ran++, BASH_OK))

  await $.tool.call({ tool: 'Bash', command: 'pip install requests' })
  await $.tool.call({ tool: 'Bash', command: 'pip install httpx' })

  expect(ran).toBe(2)
  expect(toasts).toEqual(['slopsquat-guard could not reach PyPI, so requests was not checked'])
})

test('a verdict is cached: the second install asks the registry nothing', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on)
  const reg = registry(POPULAR)
  on('http.fetch', ($, e) => reg.answer(e.url, e.init?.method ?? 'GET'))
  on('tool.call', () => BASH_OK)

  await $.tool.call({ tool: 'Bash', command: 'npm i react' })
  const before = reg.calls.length
  await $.tool.call({ tool: 'Bash', command: 'pnpm add react' })

  expect(reg.calls.length).toBe(before)
})

test('allowList skips the check entirely', { options: { allowList: 'acme-internal, @acme/ui' } }, async ($, on) => {
  const reg = registry({})
  on('http.fetch', ($, e) => reg.answer(e.url, e.init?.method ?? 'GET'))
  let ran = 0
  on('tool.call', () => (ran++, BASH_OK))

  await $.tool.call({ tool: 'Bash', command: 'npm install acme-internal @acme/ui' })

  expect(ran).toBe(1)
  expect(reg.calls).toEqual([])
})

test('npx of a binary the project already has is not checked', async ($, on) => {
  on('fs.exists', ($, e) => ({ value: e.path.endsWith('node_modules/.bin/tsc') }))
  const reg = registry({})
  on('http.fetch', ($, e) => reg.answer(e.url, e.init?.method ?? 'GET'))
  let ran = 0
  on('tool.call', () => (ran++, BASH_OK))

  await $.tool.call({ tool: 'Bash', command: 'npx tsc --noEmit' })

  expect(ran).toBe(1)
  expect(reg.calls).toEqual([])
})

test('commands that install nothing are never checked', async ($, on) => {
  const reg = registry({})
  on('http.fetch', ($, e) => reg.answer(e.url, e.init?.method ?? 'GET'))
  on('tool.call', () => BASH_OK)

  for (const command of ['npm install', 'npm test', 'pip install -r requirements.txt', 'cargo build', 'git status']) {
    await $.tool.call({ tool: 'Bash', command })
  }

  expect(reg.calls).toEqual([])
})

test('/slopsquat checks a package by hand', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on, { blockedTotal: 3 })
  const reg = registry({ ...POPULAR, ...FRESH })
  on('http.fetch', ($, e) => reg.answer(e.url, e.init?.method ?? 'GET'))

  const popular = await $.command.run({ command: 'slopsquat', args: 'npm react', ...TYPED })
  expect(popular.text).toBe('OK: react exists on npm (222,767,611 downloads a week)')

  const fresh = await $.command.run({ command: 'slopsquat', args: 'node shiny-new-thing', ...TYPED })
  expect(fresh.text).toMatch(/^RISKY: shiny-new-thing on npm: it was first published 1 day ago/)

  const missing = await $.command.run({ command: 'slopsquat', args: 'pip not-a-real-pkg-acm', ...TYPED })
  expect(missing.text).toBe('MISSING: no package named "not-a-real-pkg-acm" exists on PyPI')

  const usage = await $.command.run({ command: 'slopsquat', args: '', ...TYPED })
  expect(usage.text).toMatch(/^Usage: \/slopsquat/)
  expect(usage.text).toMatch(/0 installs this session, 3 all time/)
})
