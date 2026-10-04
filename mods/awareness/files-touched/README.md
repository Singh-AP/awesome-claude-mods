# ✎ files-touched

> Every file Claude changed this session, at a glance. One line above the prompt, a +/− table on demand, and one keypress to `@mention` a file.

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
  …
```

After a long session it's hard to say what Claude actually changed. files-touched keeps a running ledger of every successful `Edit`, `Write` and `NotebookEdit`: which files, how many edits, and how many lines added and removed.

## Features

- **Band above the prompt**: `✎ N files` plus the most recently changed files and their `+/−`, sized to the terminal's width. It ends in `+N more` when they don't all fit, and hides until a file is touched.
- **`/touched`**: a markdown table of every file, newest first, with created/modified, edit count, lines added and removed, and the last time it was touched.
- **`/touched pane`**: a pane with one button per file. Press one (or its digit, `1`–`9`) to insert `@path` into your prompt, so you can say "review @src/auth.ts" without typing the path. **Copy paths** (`y`) and **Clear** (`c`) are there too.
- **`/touched copy`**: puts the list of paths on your clipboard, one per line.
- **Accurate counts**: it reads the tool's own structured patch when there is one, so a rewritten file counts the lines that changed, not the whole file.
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
| `tool.call` | After `next(e)`, reads each successful `Edit`, `MultiEdit`, `Write` and `NotebookEdit` and its result's patch |
| `$.session.root` | Makes paths relative to the project |
| `$.state` (`files`) | Holds the list across hot reloads and redraws the band. Resets with `/clear`. |
| `ui.render` on `AbovePrompt` | The band. It keeps whatever other mods draw there below its own line. |
| `ui.render` on `Pane` | The pane of files |
| `$.prompt.fill`, `$.ui.copy` | `@mention` a file, copy the paths |

## Test it

```shell
claude plugin test mods/awareness/files-touched   # 25 tests
```

## Limitations

- It sees Claude's file tools only. A file a `Bash` command changes (`sed -i`, a code generator, `git checkout`) isn't counted.
- Notebook edits count the cell's source lines, not a diff.
- The list resets on `/clear`, `/resume` and `/branch`, like everything in `$.state`.
