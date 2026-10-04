// Reads a test run's summary out of its output. Pure: no `$`.

export type Parsed = {
  passed: number
  failed: number
  skipped: number
  /** Failing test names, best effort, at most a few. */
  failing: string[]
  /** Which summary format matched. */
  format: string
}

const MAX_NAMES = 5

const num = (text: string | undefined): number => (text === undefined ? 0 : Number(text))

function count(line: string, word: RegExp): number {
  const m = line.match(new RegExp(`(\\d+) ${word.source}`))
  return num(m?.[1])
}

function names(text: string, pattern: RegExp, pick: (m: RegExpMatchArray) => string = m => m[1]!): string[] {
  const out: string[] = []
  for (const m of text.matchAll(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g'))) {
    const name = pick(m).trim().slice(0, 120)
    if (name !== '' && !out.includes(name)) out.push(name)
    if (out.length === MAX_NAMES) break
  }
  return out
}

type Parser = (text: string) => Parsed | undefined

const jest: Parser = text => {
  const line = text.match(/^Tests:\s+(.*\d+ total.*)$/m)?.[1]
  if (line === undefined) return undefined
  return {
    format: 'jest',
    passed: count(line, /passed/),
    failed: count(line, /failed/),
    skipped: count(line, /skipped/) + count(line, /todo/),
    failing: names(text, /^\s*● (?!Test suite failed to run)(.+›.+|[^\n]+)$/m),
  }
}

const vitest: Parser = text => {
  const line = text.match(/^\s*Tests\s{2,}(.+?)\s*\(\d+\)\s*$/m)?.[1]
  if (line === undefined) return undefined
  return {
    format: 'vitest',
    passed: count(line, /passed/),
    failed: count(line, /failed/),
    skipped: count(line, /skipped/) + count(line, /todo/),
    // `× suite > test 5ms`, or `FAIL  path/to.test.ts > suite > test`: the path dropped
    failing: names(text, /^\s*(?:FAIL|×|✗)\s+(?:\S+\.[cm]?[jt]sx? > )?(.+? > .+?)(?:\s+\d+m?s)?$/m),
  }
}

const pytest: Parser = text => {
  const lines = [...text.matchAll(/^=+ (.*?(?:passed|failed|error|skipped|xfailed|xpassed|no tests ran).*?) in [\d.]+s(?: \([^)]*\))? =+$/gm)]
  const line = lines.at(-1)?.[1]
  if (line === undefined) return undefined
  return {
    format: 'pytest',
    passed: count(line, /passed/) + count(line, /xpassed/),
    failed: count(line, /failed/) + count(line, /errors?/),
    skipped: count(line, /skipped/) + count(line, /xfailed/) + count(line, /deselected/),
    failing: names(text, /^(?:FAILED|ERROR) (\S+)/m),
  }
}

const unittest: Parser = text => {
  const ran = text.match(/^Ran (\d+) tests? in [\d.]+s/m)
  const verdict = text.match(/^(OK|FAILED)(?: \((.*)\))?\s*$/m)
  if (ran === null || verdict === null) return undefined
  const detail = verdict[2] ?? ''
  const pick = (key: string) => num(detail.match(new RegExp(`${key}=(\\d+)`))?.[1])
  const failed = pick('failures') + pick('errors')
  const skipped = pick('skipped') + pick('expected failures')
  return {
    format: 'unittest',
    passed: Math.max(0, num(ran[1]) - failed - skipped),
    failed,
    skipped,
    failing: names(text, /^(?:FAIL|ERROR): (\S+) \((\S+)\)/m, m => `${m[2]}.${m[1]}`),
  }
}

const cargo: Parser = text => {
  const results = [...text.matchAll(/^test result: (?:ok|FAILED)\. (\d+) passed; (\d+) failed; (\d+) ignored/gm)]
  if (results.length === 0) return undefined
  return {
    format: 'cargo',
    passed: results.reduce((n, m) => n + num(m[1]), 0),
    failed: results.reduce((n, m) => n + num(m[2]), 0),
    skipped: results.reduce((n, m) => n + num(m[3]), 0),
    failing: names(text, /^test (\S+) \.\.\. FAILED$/m),
  }
}

const goTest: Parser = text => {
  const verbosePass = text.match(/^--- PASS: /gm)?.length ?? 0
  const fails = text.match(/^--- FAIL: /gm)?.length ?? 0
  const failing = names(text, /^--- FAIL: (\S+)/m)
  if (verbosePass > 0) {
    return { format: 'go', passed: verbosePass, failed: fails, skipped: text.match(/^--- SKIP: /gm)?.length ?? 0, failing }
  }
  const okPackages = text.match(/^ok\s+\S+/gm)?.length ?? 0
  const failPackages = text.match(/^FAIL\s+\S+\s+[\d.]+s$/gm)?.length ?? text.match(/^FAIL\s+\S+/gm)?.length ?? 0
  if (okPackages + failPackages === 0) return undefined
  // Without -v, go reports packages; failing tests still name themselves.
  return { format: 'go (packages)', passed: okPackages, failed: Math.max(failPackages, fails > 0 ? 1 : 0), skipped: 0, failing }
}

const mocha: Parser = text => {
  const passing = text.match(/^\s*(\d+) passing\b/m)
  if (passing === null) return undefined
  return {
    format: 'mocha',
    passed: num(passing[1]),
    failed: num(text.match(/^\s*(\d+) failing\b/m)?.[1]),
    skipped: num(text.match(/^\s*(\d+) pending\b/m)?.[1]),
    failing: names(text, /^\s{2}\d+\) (.+?):?$/m),
  }
}

const rspecLike: Parser = text => {
  const m = text.match(/^(\d+) (examples?|tests?), (\d+) failures?(?:, (\d+) (?:pending|skipped|excluded))?/m)
  if (m === null) return undefined
  const total = num(m[1])
  const failed = num(m[3])
  const skipped = num(m[4])
  return {
    format: m[2]!.startsWith('example') ? 'rspec' : 'mix',
    passed: Math.max(0, total - failed - skipped),
    failed,
    skipped,
    failing: names(text, /^rspec \S+ # (.+)$/m),
  }
}

// bun, `claude plugin test` and other bun-style reporters
const bun: Parser = text => {
  const pass = text.match(/^\s*(\d+) pass\s*$/m)
  const fail = text.match(/^\s*(\d+) fail\s*$/m)
  if (pass === null || fail === null) return undefined
  return {
    format: 'bun',
    passed: num(pass[1]),
    failed: num(fail[1]),
    skipped: num(text.match(/^\s*(\d+) skip\s*$/m)?.[1]) + num(text.match(/^\s*(\d+) todo\s*$/m)?.[1]),
    failing: names(text, /^\(fail\) (.+?)(?: \[[\d.]+m?s\])?$/m),
  }
}

const nodeTest: Parser = text => {
  const spec = text.match(/^ℹ pass (\d+)/m)
  const tap = text.match(/^# pass (\d+)/m)
  if (spec === null && tap === null) return undefined
  const key = spec !== null ? 'ℹ' : '#'
  const read = (word: string) => num(text.match(new RegExp(`^${key} ${word} (\\d+)`, 'm'))?.[1])
  const failing = spec !== null
    ? names(text, /^✖ (?!failing tests:)(.+?)(?: \([\d.]+m?s\))?$/m)
    : names(text, /^not ok \d+ - (.+)$/m)
  return { format: 'node --test', passed: read('pass'), failed: read('fail'), skipped: read('skipped') + read('skip') + read('todo'), failing }
}

const phpunit: Parser = text => {
  const ok = text.match(/^OK \((\d+) tests?, \d+ assertions?\)/m)
  if (ok !== null) return { format: 'phpunit', passed: num(ok[1]), failed: 0, skipped: 0, failing: [] }
  const line = text.match(/^Tests: (\d+), Assertions: \d+.*$/m)
  if (line === null) return undefined
  const pick = (key: string) => num(line[0].match(new RegExp(`${key}: (\\d+)`))?.[1])
  const failed = pick('Failures') + pick('Errors')
  const skipped = pick('Skipped') + pick('Incomplete')
  return { format: 'phpunit', passed: Math.max(0, num(line[1]) - failed - skipped), failed, skipped, failing: names(text, /^\d+\) (\S+::\S+)/m) }
}

const dotnet: Parser = text => {
  const runs = [...text.matchAll(/(?:Passed|Failed)!\s+-\s+Failed:\s+(\d+),\s+Passed:\s+(\d+),\s+Skipped:\s+(\d+)/g)]
  if (runs.length === 0) return undefined
  return {
    format: 'dotnet',
    passed: runs.reduce((n, m) => n + num(m[2]), 0),
    failed: runs.reduce((n, m) => n + num(m[1]), 0),
    skipped: runs.reduce((n, m) => n + num(m[3]), 0),
    failing: names(text, /^\s*Failed (\S+) \[/m),
  }
}

const deno: Parser = text => {
  const m = text.match(/^(?:ok|FAILED) \| (\d+) passed(?: \([^)]*\))? \| (\d+) failed(?: \| (\d+) ignored)?/m)
  if (m === null) return undefined
  return { format: 'deno', passed: num(m[1]), failed: num(m[2]), skipped: num(m[3]), failing: names(text, /^(.+?) \.\.\. FAILED/m) }
}

const maven: Parser = text => {
  const lines = [...text.matchAll(/Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)(, Time elapsed)?/g)]
  if (lines.length === 0) return undefined
  const summary = lines.filter(m => m[5] === undefined).at(-1)
  const picked = summary !== undefined ? [summary] : lines
  const total = picked.reduce((n, m) => n + num(m[1]), 0)
  const failed = picked.reduce((n, m) => n + num(m[2]) + num(m[3]), 0)
  const skipped = picked.reduce((n, m) => n + num(m[4]), 0)
  return { format: 'maven', passed: Math.max(0, total - failed - skipped), failed, skipped, failing: names(text, /^\[ERROR\]\s{2,}(\w[\w$.]*\.\w+)(?::\d+)?\b/m) }
}

const gradle: Parser = text => {
  const m = text.match(/(\d+) tests? completed, (\d+) failed(?:, (\d+) skipped)?/)
  if (m === null) return undefined
  const failed = num(m[2])
  const skipped = num(m[3])
  return { format: 'gradle', passed: Math.max(0, num(m[1]) - failed - skipped), failed, skipped, failing: names(text, /^(\S+ > .+?) FAILED$/m) }
}

const ctest: Parser = text => {
  const m = text.match(/\d+% tests passed, (\d+) tests? failed out of (\d+)/)
  if (m === null) return undefined
  const failed = num(m[1])
  return { format: 'ctest', passed: num(m[2]) - failed, failed, skipped: 0, failing: names(text, /^\s*\d+ - (\S+) \((?:Failed|SEGFAULT|Timeout)\)/m) }
}

const swift: Parser = text => {
  const all = [...text.matchAll(/Executed (\d+) tests?, with (\d+) failures?(?: \((\d+) unexpected\))?/g)]
  const m = all.at(-1)
  if (m === undefined) return undefined
  const failed = num(m[2])
  return { format: 'swift', passed: num(m[1]) - failed, failed, skipped: 0, failing: names(text, /error: -\[(\S+ \S+)\]/m) }
}

// Most specific first.
const PARSERS: readonly Parser[] = [jest, vitest, pytest, cargo, nodeTest, bun, deno, dotnet, phpunit, maven, gradle, ctest, swift, unittest, mocha, rspecLike, goTest]

export function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r/g, '')
}

/** The run's counts, or undefined when no known summary is in the output. */
export function parseOutput(output: string): Parsed | undefined {
  const text = stripAnsi(output)
  for (const parser of PARSERS) {
    const parsed = parser(text)
    if (parsed !== undefined && parsed.passed + parsed.failed + parsed.skipped > 0) return parsed
    if (parsed !== undefined && parser === pytest) return parsed
  }
  return undefined
}
