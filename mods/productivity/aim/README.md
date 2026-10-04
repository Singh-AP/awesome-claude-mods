# 🎯 aim

> Pin one goal for the session. It sits above the prompt with a timer, and Claude is told to stay on it and flag unrelated work instead of drifting.

```text
  🎯 fix the login redirect bug · 12m  [ Done ]  [ Clear ]
╭──────────────────────────────────────────────────────────────╮
│ > also the footer looks off on mobile                        │
╰──────────────────────────────────────────────────────────────╯

● Fixed the redirect: the callback now keeps `?next=` through the
  OAuth round-trip (auth/callback.ts:42).

  Outside the current focus: the footer overlaps on narrow screens.
  Want me to look at it after this?
```

Long sessions drift: one fix becomes a refactor, which becomes a dependency upgrade. `aim` gives the session one written goal that you can both see. It's pinned in the band above the prompt with the time spent so far, and it goes into Claude's system prompt, telling Claude to stay on the goal and mention side quests in one line instead of doing them.

## Features

- **`/aim <goal>`** pins a goal. The band shows `🎯 <goal> · <elapsed>` with **Done** and **Clear** buttons.
- **The goal reaches Claude** as a section at the end of the system prompt, after the cached part, so the prompt cache isn't broken. Claude is told to keep to it, to mention unrelated work in one line instead of doing it, and to say when a request moves away from the goal.
- **`/aim done`** finishes the goal, shows a toast (`Aim done in 34m 🎉`) and records it. **`/aim history`** lists recent goals and how long each took.
- **The goal is kept per project** and survives `/clear`, `/resume` and restarts.
- **`/aim`** alone shows the goal and its elapsed time. **`/aim clear`** drops it without recording it.
- **Plays well with other mods:** whatever other mods draw in the band stays visible underneath.

## Install

```shell
/plugin marketplace add Singh-AP/awesome-claude-mods
/plugin install aim@awesome-claude-mods
```

Requires Claude Code 2.1.287 or later.

## Commands

| Command | What it does |
| --- | --- |
| `/aim <goal>` | Pins the goal, replacing any current one |
| `/aim` | Shows the goal and the time spent so far |
| `/aim done` | Finishes it: toast, history entry, band cleared |
| `/aim clear` | Drops it without recording it |
| `/aim history` | The last 10 finished goals, newest first |

The command is `/aim` because `/focus` and `/goal` are built into Claude Code.

## How it works

| Event | Why |
| --- | --- |
| `command.run` on `aim` | Sets, finishes, clears and lists goals |
| `prompt.compose` | Appends a `session`-scoped `aim:goal` section to the system prompt while a goal is set |
| `ui.render` on `AbovePrompt` | Draws the band, followed by whatever `await next(e)` returns |
| `session.start`, `classic.SessionStart` (`clear`/`resume`/`fork`) | Loads this project's goal from `$.store` into `$.state` |
| `$.clock.every` | Redraws the band once a minute so the elapsed time stays current |

## Test it

```shell
claude plugin test mods/productivity/aim   # 11 tests
```

## Limitations

- The goal shapes Claude's behaviour but doesn't enforce it: Claude still does what you ask, and says when it's off-goal.
- Goals are kept per project root, so two sessions in the same repo share one goal.
