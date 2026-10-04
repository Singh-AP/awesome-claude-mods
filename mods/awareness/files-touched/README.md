# ✎ files-touched

> Every file Claude changed this session, at a glance. One line above the prompt, a +/− table on demand, and one keypress to `@mention` a file.

<img src="../../../assets/screens/hero.svg" alt="files-touched in a real Claude Code session" width="100%">

```text
✎ 4 files · register.ts +12 −3 · README.md +40 · a/index.ts +2 · +1 more
╭──────────────────────────────────────────────────────────────╮
│ > _                                                          │
╰──────────────────────────────────────────────────────────────╯

/touched
  4 files changed · +57 −5 · 7 edits
  | File              | Status   | Edits | Added | Removed | Last  |
  | hooks/register.ts | modified |     3 |   +12 |      −3 | 14:52 |
  | README.md         | created  |     1 |   +40 |      −0 | 14:50 |
  | gen/schema.ts     | modified (bash) | 1 | +9 |      −2 | 14:49 |
  …
```

After a long session it's hard to say what Claude actually changed. files-touched keeps a running ledger of every successful `Edit`, `Write` and `NotebookEdit`, and, in a git repo, of every file a `Bash` command changed (`cat > f <<EOF`, `sed -i`, `printf >>`, codegen, formatters): which files, how many edits, and how many lines added and removed.

## Features

- **Band above the prompt**: `✎ N files` plus the most recently changed files and their `+/−`, sized to the terminal's width. It ends in `+N more` when they don't all fit, and hides until a file is touched.
- **`/touched`**: a markdown table of every file, newest first, with created/modified, edit count, lines added and removed, and the last time it was touched.
- **`/touched pane`**: a pane with one button per file. Press one (or its digit, `1`–`9`) to insert `@path` into your prompt, so you can say "review @src/auth.ts" without typing the path. **Copy paths** (`y`) and **Clear** (`c`) are there too.
- **`/touched copy`**: puts the list of paths on your clipboard, one per line.
- **Accurate counts**: it reads the tool's own structured patch when there is one, so a rewritten file counts the lines that changed, not the whole file.
- **Bash changes too**: in a git repo it compares the dirty files (`git status`, `git hash-object`, `git diff --numstat`) before and after each Bash command, so heredocs, `sed -i`, formatters and generators show up, marked `(bash)`. A command Bash ran read-only reuses the last look, so a turn of `ls` and `grep` runs git once. Committing or staging a file doesn't count as changing it.
- **Honest**: failed, denied and held (staged) edits don't count. Paths are relative to your project root.

## Install

```shell
/plugin marketplace add Singh-AP/awesome-claude-mods
/plugin install files-touched@awesome-claude-mods
```

Requires Claude Code 2.1.287 or later.

## Usage

| Command | What it does |
| --- | --- |
| `/touched` | Print the table |
| `/touched pane` | Open the pane of files, each pressable to `@mention` it |
| `/touched copy` | Copy the paths to the clipboard |
| `/touched clear` | Start the list over |

## Configuration

| Option | Default | What it does |
| --- | --- | --- |
| `band` | `true` | Show the one-line list above the prompt |

## How it works

| Event / API | Why |
| --- | --- |
| `tool.call` | After `next(e)`, reads each successful `Edit`, `MultiEdit`, `Write` and `NotebookEdit` and its result's patch. Around each `Bash` call, compares git's view of the dirty files |
| `$.process.run` (`git`) | `git --no-optional-locks status --porcelain=v2`, `hash-object --stdin-paths` and `diff --numstat`, 3 s timeout each, never taking the index lock |
| `turn.start` | Forgets the last look at the tree, since you may have edited files between turns |
| `$.session.root` | Makes paths relative to the project |
| `$.state` (`files`) | Holds the list across hot reloads and redraws the band. Resets with `/clear`. |
| `ui.render` on `AbovePrompt` | The band. It keeps whatever other mods draw there below its own line. |
| `ui.render` on `Pane` | The pane of files |
| `$.prompt.fill`, `$.ui.copy` | `@mention` a file, copy the paths |

## Test it

```shell
claude plugin test mods/awareness/files-touched   # 41 tests
```

## Limitations

- Bash changes are only seen inside a git repo, and only for the first 200 changed paths. A command started in the background (`run_in_background`) is checked when it returns, so later writes are missed.
- Line counts for Bash changes are measured against HEAD, so they're approximate when a file was already dirty. Across a checkout, reset or rebase that moves HEAD, a change counts as an edit with +0 −0. Your own edits made during a running turn can be attributed to Claude's next Bash command.
- Notebook edits count the cell's source lines, not a diff.
- The list resets on `/clear`, `/resume` and `/branch`, like everything in `$.state`.
