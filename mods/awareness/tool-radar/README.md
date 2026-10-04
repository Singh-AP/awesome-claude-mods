# 📡 tool-radar

> Mission control for what Claude is doing: every tool call, live, with its status, arguments, duration and why it failed.

```text
╭─ Tool radar ──────────────────────────────────────────────╮
│ 42 calls · 3 failed · 1 running · avg 1.2s · Bash 20 Edit 12 Read 8
│ [ Clear ] [ Errors only ] [ Close ]                        │
│ ◐ Bash         npm run test -- --watch=false            …  │
│ ✓ Edit         hooks/register.ts                     38ms  │
│ ✗ Bash         pytest -q — exit code 1: 2 failed     4.1s  │
│ ✓ ↳ Read       src/auth.ts                           12ms  │
│ ⊘ Bash         git push --force — blocked by policy   0ms  │
│ ✓ mcp:github   search_issues is:open label:bug       1.9s  │
╰────────────────────────────────────────────────────────────╯
```

When Claude is a few dozen tool calls into a task, the transcript scrolls by too fast to follow. tool-radar keeps one compact, newest-first list of every call: what it ran, how long it took, and which calls failed or were denied. It covers subagents and MCP tools too.

## Features

- **Live pane** (`/radar`): one row per call with a status glyph (`◐` running, `✓` done, `✗` failed, `⊘` denied), the tool, a short look at its arguments (the command, the file, the pattern, the URL, the subagent's task, the MCP tool), and the duration.
- **Header summary**: total calls, failures, denials, how many are running, the average duration, and your busiest tools.
- **Errors only** toggle (`e`) shows just the failed and denied calls, with the reason inline. **Clear** (`c`) starts over and **Close** (`x`) closes the pane.
- **Subagents marked**: a call a subagent made shows `↳` before the tool.
- **`/radar summary`** prints a text report: counts per tool, the recent failures with their reasons, and the five slowest calls.
- Fits the pane: rows are sized to the pane's width, and a docked pane shows as many rows as it has room for.

## Install

```shell
/plugin marketplace add Singh-AP/awesome-claude-mods
/plugin install tool-radar@awesome-claude-mods
```

Requires Claude Code 2.1.287 or later.

## Usage

| Command | What it does |
| --- | --- |
| `/radar` | Open the pane. Works mid-turn. |
| `/radar summary` | Print counts, failures and the slowest calls |
| `/radar clear` | Forget every call so far |
| `/radar close` | Close the pane |

In the pane, press `ctrl+x tab` to give it the keyboard, then `c`, `e` or `x`.

## Configuration

| Option | Default | What it does |
| --- | --- | --- |
| `autoOpen` | `false` | Open the pane when a session starts. Claude Code only seats a pane it wasn't asked for in a terminal at least 144 columns wide (110 once you've opened it yourself). |

## How it works

| Event / API | Why |
| --- | --- |
| `tool.call` (every tool) | Records the call before `next(e)` and its outcome after: `deny`, `isError`, or done |
| `$.clock.now` | Times each call |
| `$.state` (`calls`, `totals`, `errorsOnly`) | Holds the list across hot reloads, redraws the pane on every change, and resets on `/clear` |
| `ui.render` on `Pane` | Draws the list |
| `command.run` | `/radar` and its subcommands |

The pane keeps the latest 300 calls. The totals count every call.

## Test it

```shell
claude plugin test mods/awareness/tool-radar   # 20 tests
```

## Limitations

- A call's duration includes any time it waited on your permission prompt.
- A running call shows `…`, not a ticking timer. The pane redraws when a call starts or ends.
- `$.state` resets on `/clear`, `/resume` and `/branch`, so the radar starts empty there too.
