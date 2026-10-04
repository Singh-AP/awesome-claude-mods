# 💸 cost-meter

> Always know what a session costs: live spend, context and rate limits on the status line, the price of every turn, and a budget that asks before spending more.

```text
✻ Baked for 1m 35s · $0.31

╭──────────────────────────────────────────────────────────────╮
│ >                                                            │
╰──────────────────────────────────────────────────────────────╯
  💸 $4.12 · ctx 71% · 5h 38% · 7d 12%

                                ┌ cost-meter ──────────────────┐
                                │ context 85% full: /compact   │
                                │ soon                         │
                                └──────────────────────────────┘
```

## Features

- **Status line** that shows only what your session actually reports: session cost, context fill, and your 5-hour / 7-day rate-limit windows (subscription plans). Nothing unknown is printed, so you never see `NaN` or `undefined`.
- **Per-turn cost.** The line that closes each turn (`Baked for 1m 35s`) gets that turn's cost appended, subagents included.
- **Context warnings** at 70%, 85% and 95%. Each mark toasts once, and the marks re-arm after a `/compact`.
- **Budget (optional).** Each time the session passes another multiple of your budget, the next tool call asks *Keep going / Stop here*. On Stop, the tool call is refused and the model is told to wrap up. A new prompt is held once and put back in the box, so pressing Enter again means "yes, keep going". Long turns are checked call by call, not only between turns. Headless runs stop.
- **`/spend`** shows the session total, context, rate limits with reset times, the most expensive turn, and your last 10 turns with cost and duration. `/spend budget 5` sets a budget for this session; `/spend budget off` clears it.

## Install

```shell
/plugin marketplace add Singh-AP/awesome-claude-mods
/plugin install cost-meter@awesome-claude-mods
```

Requires Claude Code 2.1.287 or later.

## Configuration

| Option | Default | What it does |
| --- | --- | --- |
| `budgetUsd` | `0` (off) | Ask before spending more each time the session passes another multiple of this many US dollars. |
| `showTurnCost` | `true` | Append the turn's cost to the line that closes it. |
| `contextWarnings` | `true` | Toast at 70% / 85% / 95% context. |

## How it works

| Event / API | Why |
| --- | --- |
| `session.measure` | Pushed after each turn and on rate-limit moves: the status line and the warnings. No polling. |
| `$.session.usage()` | Free reads at turn start and end (per-turn delta), and per tool call while a budget is set |
| `ui.render` on `TurnDuration` | Draws the engine's own line, then ` · $0.31` beside it |
| `tool.call`, `prompt.submit` | The budget gate (`$.ui.ask`, `{ deny }`, `{ drop }` + `$.prompt.fill`) |
| `command.run` | `/spend` (Claude Code's built-in `/cost` name is reserved) |

## Test it

```shell
claude plugin test mods/cost/cost-meter   # 29 tests
```

## Limitations

- Cost is the session's own ledger, as `/cost` reports it. On a subscription it's what the usage would cost at API prices, not a bill.
- Rate-limit windows only appear once an API response has reported them (subscription plans).
- Per-turn cost needs the mod loaded when the turn starts, so turns from before an install or a `--resume` show no cost.
- The turn-cost suffix only appears in the terminal; Claude Code doesn't draw that line elsewhere.
