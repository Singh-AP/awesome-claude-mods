# 🎁 wrapped

> Spotify Wrapped for your Claude Code life: your stats, your streaks, your coding persona, and a share card that's one keypress away.

```text
✦ CLAUDE CODE WRAPPED · 2026 ✦

You are 🦉 The Night Owl
Your best ideas show up after dark. Peak hour: 11pm.

1,284               312                 96h
prompts             sessions            with Claude

18,422              41,200              128
tool calls          lines written       commits

Top tools
Bash  ████████████████████████████████ 6,201
Edit  █████████████████████▏           4,102
Read  ███████████████▊                 3,050
Grep  ██████▏                          1,200
Write ████▏                              800

🔥 14-day streak · best 31
🕐 busiest hour 11pm
⏱  longest turn 42m
📁 top project api-server
💸 $412.80 of tokens

[ Copy share card ]  [ Close ]
```

Run `/wrapped` for the card, then press `c` to copy a compact version for Slack or X:

```text
✦ My Claude Code Wrapped · 2026 ✦
🦉 The Night Owl
1,284 prompts · 312 sessions · 96h with Claude
18,422 tool calls · 41,200 lines written · 128 commits
Top tools: Bash · Edit · Read
🔥 Longest streak: 31 days
made with wrapped · github.com/Singh-AP/awesome-claude-mods
```

## Features

- **Counts what matters**: sessions, your prompts, turns and time with Claude, tool calls by tool, failed calls, unique files edited, lines written, commits, cost
- **Streaks**: your current and longest run of days with Claude Code
- **A coding persona** from your habits: 🦉 Night Owl, 🐦 Early Bird, 🏃 Marathoner, 🧙 Shell Wizard, 🔧 Refactorer, 📚 Reader, 🎼 Conductor, 🌊 Researcher, 🚢 Shipper, or ✨ Collaborator
- **Any year or all time**: `/wrapped 2025`, `/wrapped all`
- **Share card**: one button copies it, and `/wrapped text` prints it. Cost stays off the card unless you turn `shareCost` on.
- **Private by design**: aggregate counters only. No prompts, no transcripts, no file paths (files are counted by hash). Nothing leaves your machine unless you paste the card.
- **Safe with parallel sessions**: each session writes only its own record. Old records fold into one per year, so the store stays small.

## Install

```shell
/plugin marketplace add Singh-AP/awesome-claude-mods
/plugin install wrapped@awesome-claude-mods
```

Requires Claude Code 2.1.287 or later. It counts from the moment it's installed; it can't see sessions from before.

## Commands

| Command | What it does |
| --- | --- |
| `/wrapped` | Opens this year's card in a pane (`c` copies, `x` or Esc closes) |
| `/wrapped 2025` · `/wrapped all` | Another year, or your whole history |
| `/wrapped text [year\|all]` | Prints the share card into the transcript |
| `/wrapped reset` | Wipes every stat, after asking |

## Configuration

| Option | Default | What it does |
| --- | --- | --- |
| `shareCost` | `false` | Adds `💸 $… of tokens` to the copied share card. The pane always shows cost. |

## How it works

| Event / API | Why |
| --- | --- |
| `prompt.submit` | Counts your prompts (typed, Remote Control or SDK, but not plugin or notification prompts) and the hour you sent them |
| `tool.call` | After `next(e)`: counts the call by tool, failures, lines from `Edit`/`Write`, file hashes, successful `git commit`s |
| `turn.complete` | Main-loop turns, their duration, the day and the project; then writes this session's record |
| `session.start` · `session.end` | Registers `/wrapped`, folds old records, and writes the record on exit |
| `$.session.usage()` | Cost, counted as the ledger's rise so a reload never double-counts |
| `$.store` | `s:<session id>` per session, `y:<year>` for folded history |
| `ui.render` on `Pane` · `$.ui.copy` | The card and the share button |

The counting, streak and persona logic (`hooks/stats.ts`) is pure TypeScript with no `$`.

## Test it

```shell
claude plugin test mods/fun/wrapped   # 30 tests
```

## Limitations

- "Lines written" counts the lines in each `Edit`'s replacement text and each `Write`'s content, so it measures output, not net change.
- Unique files are counted by hash, capped at 500 per session and 20,000 per folded year, so huge years undercount slightly.
- Counts made in the last moments before a crash may be lost. Records are written at the end of each turn and on exit.
- Hours and days use the machine's local time zone.
