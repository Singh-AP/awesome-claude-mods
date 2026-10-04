# 🧪 test-pulse

> Your test suite's heartbeat. Every test run Claude makes lands in the status line, a toast tells you the moment tests go red or green again, and `/tests` shows the trend and the flakes.

<img src="../../../assets/screens/test-pulse.svg" alt="test-pulse in a real Claude Code session" width="100%">

```text
  🧪 ❌ 1/2 passing · just now

╭──────────────────────────────────────╮
│ test-pulse                           │
│ tests went red: 1 failing · divides  │
╰──────────────────────────────────────╯

> /tests
  ⎿  test-pulse: Last 6 runs · pass rate ▁▅▅███ (oldest → newest)
       ✅ just now  44/44     npm test
       ✅ 3m ago    44/44     npm test
       ✅ 5m ago    43/43     npx vitest run src/auth
       ❌ 9m ago    41/44     npm test  ✗ login › rejects a bad password
       ...

     Possibly flaky (failed, then passed with no edits in between): checkout › retries payment
```

## Features

- **Status line, always current:** `🧪 ✅ 44/44 passing · 2m ago`, or `🧪 ❌ 41/44 passing · just now`. The age updates once a minute. A run with no recognised summary shows `tests passed` or `tests failed` from the exit status.
- **Toasts only when the colour changes:** `tests went red: 3 failing · login › rejects a bad password`, then `tests are green again 🎉 (44 passing)`.
- **Recognises the summaries of** jest, vitest, pytest, unittest, cargo, go test (with or without `-v`), mocha, rspec, mix, bun, `node --test` (spec and TAP), phpunit, dotnet, deno, maven, gradle, ctest, swift and `claude plugin test`. It names the first failing tests where the output does.
- **Spots test runs, not mentions of tests:** `cd web && npm test 2>&1 | tail`, `uv run pytest -x` and `timeout 300 go test ./...` count. `cat jest.config.js` and `git commit -m "fix go test"` don't.
- **`/tests`**: the last 20 runs in this project, newest first, with a pass-rate sparkline, failing names, and **likely flakes**: tests that failed and then passed on the same command with no file edited in between. `/tests clear` wipes the history.
- **Per project, across sessions.** The status line is back the next time you open the project.

## Install

```shell
/plugin marketplace add Singh-AP/awesome-claude-mods
/plugin install test-pulse@awesome-claude-mods
```

Requires Claude Code 2.1.287 or later.

## Configuration

None. If a future Claude Code build ships its own `/tests`, the command falls back to `/test-pulse`.

## How it works

| Event | Why |
| --- | --- |
| `tool.call` on `Bash` | Spots a test run, `await next(e)`, reads the summary from the output, records the run |
| `tool.call` on `Edit`, `Write`, `NotebookEdit` | Counts edits, so flake detection knows whether code changed between two runs |
| `session.start` | Loads this project's history and shows the last run |
| `command.run` | `/tests` |
| `$.ui.status`, `$.ui.toast`, `$.clock.every` | The status line, the colour-change toasts, the minute tick |
| `$.store` | Up to 20 runs per project root |

The detector (`hooks/detect.ts`) and the parsers (`hooks/parse.ts`) are pure TypeScript, so other mods can import them.

## Test it

```shell
claude plugin test mods/awareness/test-pulse   # 78 tests
```

## Limitations

- It only sees test runs Claude makes through the Bash tool, not runs in your own terminal or in CI.
- Background runs (`run_in_background`) aren't recorded.
- Flake detection is best effort. A file changed through Bash, such as `sed -i`, isn't counted as an edit.
- Without `-v`, `go test` reports packages rather than tests, so the counts are packages.
