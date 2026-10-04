import { expect, mock, test } from 'claude-code/testing'

const BASH_OK = { result: { stdout: 'ran', stderr: '', interrupted: false } }
// What the engine stamps on a typed command.
const TYPED = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } } as const

test('a catastrophic command never reaches the shell', async ($, on) => {
  mock.store(on)
  const toasts: string[] = []
  on('ui.toast', ($, e) => (toasts.push(e.text), { value: undefined }))
  let ran = 0
  on('tool.call', () => (ran++, BASH_OK))

  const out = await $.tool.call({ tool: 'Bash', command: 'rm -rf ~' })

  expect(out.deny).toMatch(/recursively deletes ~/)
  expect(ran).toBe(0)
  expect(toasts[0]).toMatch(/bash-guard blocked/)
})

test('an everyday command runs untouched', async ($, on) => {
  let seen = ''
  on('tool.call', ($, e) => {
    if (e.tool === 'Bash') seen = e.command
    return BASH_OK
  })

  const out = await $.tool.call({ tool: 'Bash', command: 'npm test' })

  expect(out.deny).toBeUndefined()
  expect(seen).toBe('npm test')
})

test('a risky command runs once the person says so', async ($, on) => {
  const asked: string[] = []
  let ran = 0
  on('tool.call', ($, e) => {
    if (e.tool === 'AskUserQuestion') {
      const question = e.questions[0]!.question
      asked.push(question)
      return { result: { questions: e.questions, answers: { [question]: 'Run it' } } }
    }
    ran++
    return BASH_OK
  })

  const out = await $.tool.call({ tool: 'Bash', command: 'git push --force origin main' })

  expect(out.deny).toBeUndefined()
  expect(ran).toBe(1)
  expect(asked[0]).toMatch(/force-pushes over a protected branch/)
})

test('a risky command is refused when the person blocks it', async ($, on) => {
  mock.store(on)
  on('ui.toast', () => ({ value: undefined }))
  let ran = 0
  on('tool.call', ($, e) => {
    if (e.tool === 'AskUserQuestion') {
      const question = e.questions[0]!.question
      return { result: { questions: e.questions, answers: { [question]: 'Block it' } } }
    }
    ran++
    return BASH_OK
  })

  const out = await $.tool.call({ tool: 'Bash', command: 'git reset --hard' })

  expect(out.deny).toMatch(/throws away uncommitted work/)
  expect(ran).toBe(0)
})

test('risky: block refuses without asking', { options: { risky: 'block' } }, async ($, on) => {
  mock.store(on)
  on('ui.toast', () => ({ value: undefined }))
  let asked = 0
  on('tool.call', ($, e) => {
    if (e.tool === 'AskUserQuestion') asked++
    return BASH_OK
  })

  const out = await $.tool.call({ tool: 'Bash', command: 'terraform destroy' })

  expect(out.deny).toMatch(/tears down infrastructure/)
  expect(asked).toBe(0)
})

test('risky: allow lets risky commands through but still blocks disasters', { options: { risky: 'allow' } }, async ($, on) => {
  mock.store(on)
  on('ui.toast', () => ({ value: undefined }))
  on('tool.call', () => BASH_OK)

  expect((await $.tool.call({ tool: 'Bash', command: 'git clean -fd' })).deny).toBeUndefined()
  expect((await $.tool.call({ tool: 'Bash', command: 'mkfs.ext4 /dev/sdb' })).deny).toMatch(/formats a disk/)
})

test('customBlock adds the person\'s own rule', { options: { customBlock: 'deploy\\.sh\\s+--prod' } }, async ($, on) => {
  mock.store(on)
  on('ui.toast', () => ({ value: undefined }))
  on('tool.call', () => BASH_OK)

  const out = await $.tool.call({ tool: 'Bash', command: './deploy.sh --prod' })

  expect(out.deny).toMatch(/customBlock/)
})

test('/bash-guard explains a command and reports the tally', async ($, on) => {
  mock.store(on, { blockedTotal: 41 })
  on('ui.toast', () => ({ value: undefined }))
  on('tool.call', () => BASH_OK)

  const probe = await $.command.run({ command: 'bash-guard', args: 'rm -rf /', ...TYPED })
  expect(probe.text).toMatch(/BLOCK +rm-system/)

  await $.tool.call({ tool: 'Bash', command: 'rm -rf /' })
  const status = await $.command.run({ command: 'bash-guard', args: '', ...TYPED })
  expect(status.text).toMatch(/This session: 1 blocked/)
  expect(status.text).toMatch(/All time: 42 blocked/)
})
