# ⎇ git-pulse

> Git status at a glance, kept fresh while Claude edits. Know the branch, what's dirty, and when a turn made commits.

```text
╭──────────────────────────────────────────────────────────────╮
│ >                                                            │
╰──────────────────────────────────────────────────────────────╯
  ⎇ feat/login ↑2 ↓1 ●3 +1 ?2

                                ┌ git-pulse ───────────────────┐
                                │ 2 new commits on feat/login  │
                                │ this turn                    │
                                └──────────────────────────────┘

> /git-pulse
  Branch: feat/login
  Upstream: origin/feat/login (2 ahead, 1 behind)
  Working tree: 1 staged, 3 modified, 2 untracked
  Stash: 1 entry

  Last commits:
    a1b2c3d Add login redirect (4 minutes ago)
    d4e5f6a Extract session helper (9 minutes ago)
```

## Features

- **Status line**: `⎇ branch ↑ahead ↓behind ✖conflicts ●modified +staged ?untracked`, or `⎇ main ✓` when clean and in sync. A detached HEAD shows `@a1b2c3d`; a new repo shows `(no commits)`.
- **Fresh without the cost**: refreshes at session start, at each turn start and end, and after `Bash`, `Edit`, `Write` and `NotebookEdit` calls. A burst of edits settles into one `git status`, not twenty.
- **Heads-ups**: a toast when the branch changes under you (`branch changed: main → feat/login`), and when a turn ends having made commits (`2 new commits on feat/login this turn`).
- **`/git-pulse`**: branch, upstream sync, working-tree counts, stash and the last three commits.
- **Quiet when it should be**: outside a repo the status line stays empty. If git is missing or keeps timing out, the mod stops trying.

## Install

```shell
/plugin marketplace add Singh-AP/awesome-claude-mods
/plugin install git-pulse@awesome-claude-mods
```

Requires Claude Code 2.1.287 or later, and `git` on your `PATH`.

## Configuration

None. It reads the repository the session runs in.

## How it works

| Event / API | Why |
| --- | --- |
| `session.start`, `turn.start`, `turn.complete` | Refresh; compare HEAD at turn start and end, then `git rev-list --count` the new commits |
| `tool.call` on `Bash` / `Edit` / `Write` / `NotebookEdit` | Schedule a refresh 750 ms after the last change (`$.clock.after`) |
| `$.process.run` | `git --no-optional-locks status --porcelain=v2 --branch`, which never takes the index lock from under Claude's own git calls |
| `$.ui.status`, `$.ui.toast` | The line and the heads-ups |
| `command.run` | `/git-pulse` |

The parser (`hooks/status.ts`) is pure TypeScript with no `$`, so you can import it into your own mod.

## Test it

```shell
claude plugin test mods/awareness/git-pulse   # 17 tests
```

## Limitations

- Ahead/behind is relative to the last fetch; git-pulse never runs `git fetch` for you.
- It follows the session's working directory. A `cd` inside a Bash command doesn't move it.
- In very large repositories, untracked-file scanning can make `git status` slow. git-pulse gives each run 5 seconds and goes quiet after three misses.
