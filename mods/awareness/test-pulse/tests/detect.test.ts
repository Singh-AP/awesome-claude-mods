import { describe, expect, test } from 'claude-code/testing'

import { testRunner } from '../hooks/detect'

describe('spots test runs', () => {
  const cases: Array<[string, string]> = [
    ['npm test', 'npm test'],
    ['npm t', 'npm test'],
    ['npm run test:unit -- --watch=false', 'npm test'],
    ['cd web && npm test 2>&1 | tail -30', 'npm test'],
    ['pnpm test', 'pnpm test'],
    ['yarn test --ci', 'yarn test'],
    ['bun test', 'bun test'],
    ['npx vitest run', 'vitest'],
    ['pnpm exec jest src/', 'jest'],
    ['CI=1 npx jest --coverage', 'jest'],
    ['npx mocha test/', 'mocha'],
    ['pytest -q', 'pytest'],
    ['uv run pytest tests/test_api.py -x', 'pytest'],
    ['poetry run pytest', 'pytest'],
    ['python3 -m pytest', 'pytest'],
    ['python -m unittest discover', 'unittest'],
    ['go test ./...', 'go test'],
    ['cargo test --all', 'cargo test'],
    ['cargo nextest run', 'cargo test'],
    ['mvn -q test', 'maven'],
    ['./gradlew test', 'gradle'],
    ['bundle exec rspec spec/models', 'rspec'],
    ['bin/rails test', 'rails test'],
    ['vendor/bin/phpunit', 'phpunit'],
    ['dotnet test', 'dotnet test'],
    ['deno test -A', 'deno test'],
    ['mix test', 'mix test'],
    ['make test', 'make test'],
    ['node --test', 'node --test'],
    ['node --test test/', 'node --test'],
    ['claude plugin test mods/safety/bash-guard', 'claude plugin test'],
    ['timeout 300 go test ./pkg/...', 'go test'],
  ]
  for (const [command, runner] of cases) {
    test(command, () => expect(testRunner(command)).toBe(runner))
  }
})

describe('ignores commands that only mention tests', () => {
  const cases = [
    'ls tests/',
    'cat jest.config.js',
    'grep -r "pytest" .',
    'echo "npm test"',
    'npm install',
    'git commit -m "fix go test flake"',
    'node script.js',
    'npm run build',
    'vim test_api.py',
  ]
  for (const command of cases) {
    test(command, () => expect(testRunner(command)).toBeUndefined())
  }
})
