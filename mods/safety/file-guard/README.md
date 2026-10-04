# 🚧 file-guard

> Keeps Claude's file edits inside the project. Writes outside it are refused (symlinks resolved), `.git` internals are off limits, and lockfiles, CI workflows, migrations and secrets ask first.

```text
● Write(/Users/me/.zshrc)
  ⎿  Error: file-guard refused to change this file: ~/.zshrc is outside this
     project (~/code/shop). Keep your work inside the project. If this file
     really has to be touched, tell the user why and let them do it, or ask
     them to add the folder to file-guard's extraRoots option.

╭─ file-guard ─────────────────────────────────────────────────╮
│ file-guard: .github/workflows/deploy.yml is protected        │
│ (matches .github/workflows/**).                              │
│                                                              │
│   Edit .github/workflows/deploy.yml                          │
│                                                              │
│ Allow this change?                                           │
│ ❯ 1. Allow once                                              │
│   2. Allow this file for the session                         │
│   3. Block it                                                │
╰──────────────────────────────────────────────────────────────╯
```

An agent that can edit any file you can is one bad path away from your dotfiles, another repo, or `~/.claude/settings.json`. file-guard checks every `Read`, `Edit`, `Write` and `NotebookEdit` call, including subagents' calls, *below* the permission system, so it holds in bypass mode too.

## Features

- **The fence.** A write must land inside the project root (the folder the session started in, or where `/cd` moved it), or in a folder you allow. Every path is resolved first: `..`, relative paths and **symlinks**. So `src/../../etc/hosts` and a link pointing out of the repo are caught, and files that don't exist yet are placed through their nearest existing folder.
- **Sensible exceptions.** `/tmp`, `/var/tmp` and `$TMPDIR` are writable, and so are Claude Code's own memory, plan, todo and session-mod folders under `~/.claude`. `~/.claude/settings.json` is not.
- **`.git` is off limits.** No tool writes into `.git/` (hooks, config, refs). Git commands still work.
- **Protected files ask first:** CI workflows, migrations, lockfiles, `.env*` (but not `.env.example`), keys. You can allow a change once or for the whole session. With nobody to ask (`-p`), the change is refused.
- **Deny messages tell the model what to do instead**, so it stops and asks you rather than hunting for a workaround.
- **`/file-guard`** shows the fence, the protected patterns and what was blocked. **`/file-guard check <path>`** dry-runs any path and shows where it really lands.
- Reads outside the project are allowed by default. Turn on `fenceReads` to fence them too.

## Install

```shell
/plugin marketplace add Singh-AP/awesome-claude-mods
/plugin install file-guard@awesome-claude-mods
```

Requires Claude Code 2.1.287 or later. Pairs well with [bash-guard](../bash-guard), which covers the shell.

## Configuration

Set these in `/config`, or under `pluginConfigs` in `settings.json`.

| Option | Default | What it does |
| --- | --- | --- |
| `protect` | workflows, migrations, lockfiles, `.env*`, keys, `.git/**` | Comma-separated globs inside the project that ask before a write. `**` crosses folders, `*` and `?` stay in one, a pattern without `/` matches the file name anywhere, and `!glob` exempts. |
| `extraRoots` | empty | Comma-separated folders outside the project that Claude may write, e.g. `~/notes, ~/work/shared-config`. |
| `allowTemp` | `true` | Allow `/tmp`, `/var/tmp` and `$TMPDIR`. |
| `allowClaudeDirs` | `true` | Allow `~/.claude/projects`, `plans`, `todos` and `dev-mods`. |
| `fenceReads` | `false` | Also refuse `Read` outside the fence. |

## How it works

| Event / API | Why |
| --- | --- |
| `tool.call` (Read, Edit, Write, NotebookEdit, MultiEdit) | Resolves the target, judges it, and returns `{ deny }`, asks with `$.ui.ask`, or runs `next(e)` |
| `$.fs.stat(path, { resolve: true })` | Where a path really lands, links followed. This is the allow-list-on-`realPath` pattern the mods API recommends. |
| `$.session.root()`, `$.session.cwd()`, `$.env.get('HOME' / 'TMPDIR')` | The fence and its exceptions |
| `command.run` | `/file-guard` status and dry-run |
| `$.store` | The all-time blocked count |

Path logic and the glob matcher (`hooks/paths.ts`, `hooks/verdict.ts`) are pure TypeScript with no `$`.

## Test it

```shell
claude plugin test mods/safety/file-guard   # 48 tests
```

## Limitations

- It guards Claude Code's file tools, not the shell. `echo x > ~/.zshrc` in Bash is [bash-guard](../bash-guard)'s job, and a full sandbox's.
- Paths are POSIX (macOS, Linux, WSL). Windows drive paths aren't fenced.
- A hard link inside the project that points at a file outside it keeps its own spelling, so it can't be detected. Symlinks are caught.
