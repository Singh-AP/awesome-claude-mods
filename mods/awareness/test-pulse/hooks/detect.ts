// Which Bash commands are test runs. Pure: no `$`.

// Words that run the rest of the line as a command.
const WRAPPERS = new Set(['npx', 'bunx', 'pnpx', 'time', 'timeout', 'nice', 'env', 'nohup', 'command', 'exec', 'sudo', 'xvfb-run', 'dotenv', 'caffeinate'])
const TWO_WORD_WRAPPERS = new Set(['pnpm exec', 'pnpm dlx', 'yarn dlx', 'yarn exec', 'npm exec', 'uv run', 'poetry run', 'pipenv run', 'pdm run', 'hatch run', 'bundle exec', 'rye run', 'mise exec', 'doppler run', 'op run'])

// The runners, matched against the command once wrappers are gone.
const RUNNERS: ReadonlyArray<readonly [label: string, pattern: RegExp]> = [
  ['claude plugin test', /^claude plugin test\b/],
  ['node --test', /^node\b.*\s--test\b/],
  ['npm test', /^npm (?:run(?:-script)? )?(?:test|t)(?::[\w:-]+)?\b/],
  ['pnpm test', /^pnpm (?:run )?test(?::[\w:-]+)?\b/],
  ['yarn test', /^yarn (?:run )?test(?::[\w:-]+)?\b/],
  ['bun test', /^bun (?:run )?test\b/],
  ['deno test', /^deno test\b/],
  ['vitest', /^vitest\b/],
  ['jest', /^jest\b/],
  ['mocha', /^mocha\b/],
  ['ava', /^ava\b/],
  ['playwright', /^playwright test\b/],
  ['cypress', /^cypress run\b/],
  ['pytest', /^(?:pytest|py\.test)\b/],
  ['pytest', /^python[\d.]* -m pytest\b/],
  ['unittest', /^python[\d.]* -m unittest\b/],
  ['tox', /^(?:tox|nox)\b/],
  ['go test', /^go test\b/],
  ['cargo test', /^cargo (?:test|nextest run)\b/],
  ['maven', /^(?:mvn|\.\/mvnw|mvnw)\b.*\b(?:test|verify)\b/],
  ['gradle', /^(?:gradle|\.\/gradlew|gradlew)\b.*\b(?:test|check)\b/],
  ['rspec', /^rspec\b/],
  ['rails test', /^(?:rails|bin\/rails|rake) test\b/],
  ['phpunit', /^(?:phpunit|vendor\/bin\/phpunit|\.\/vendor\/bin\/phpunit)\b/],
  ['phpunit', /^php artisan test\b/],
  ['dotnet test', /^dotnet test\b/],
  ['mix test', /^mix test\b/],
  ['swift test', /^swift test\b/],
  ['ctest', /^ctest\b/],
  ['make test', /^make (?:\S+ )*(?:test|check)\b/],
  ['just test', /^just test\b/],
]

/** Splits at `&&`, `||`, `;`, `|` and newlines outside quotes. */
function parts(command: string): string[] {
  const out: string[] = []
  let current = ''
  let quote: string | null = null
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!
    if (quote !== null) {
      if (ch === quote) quote = null
      current += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      current += ch
      continue
    }
    if (ch === ';' || ch === '\n' || ch === '|' || (ch === '&' && command[i + 1] === '&')) {
      out.push(current)
      current = ''
      if (command[i + 1] === ch) i++
      continue
    }
    current += ch
  }
  out.push(current)
  return out.map(p => p.trim()).filter(p => p !== '')
}

/** Drops `VAR=x`, `cd dir` prefixes and wrappers such as `npx` or `uv run`. */
function unwrap(part: string): string {
  let words = part.split(/\s+/)
  for (;;) {
    const head = words[0]
    if (head === undefined) break
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(head)) {
      words = words.slice(1)
      continue
    }
    const pair = `${head} ${words[1] ?? ''}`
    if (TWO_WORD_WRAPPERS.has(pair)) {
      words = words.slice(2)
      continue
    }
    if (WRAPPERS.has(head)) {
      words = words.slice(1)
      // the wrapper's own flags and a timeout's duration
      while (words[0] !== undefined && (words[0].startsWith('-') || /^\d+[smhd]?$/.test(words[0]))) words = words.slice(1)
      continue
    }
    break
  }
  return words.join(' ')
}

/** The runner a Bash command invokes (`pytest`, `npm test`...), or undefined when it runs no tests. */
export function testRunner(command: string): string | undefined {
  for (const part of parts(command)) {
    const bare = unwrap(part)
    for (const [label, pattern] of RUNNERS) if (pattern.test(bare)) return label
  }
  return undefined
}
