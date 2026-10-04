# 📝 standup

> Your standup, written for you. standup journals every Claude turn and turns the last working day and today into Yesterday / Today / Blockers with one command.

```text
> /standup

Friday
- [api] Fixed the login redirect loop; committed "Fix login redirect".
- [api] Added retry with backoff to the payments client and its tests.
- [web] Started the dark mode toggle in ui/theme.ts.

Today
- [web] Finished dark mode and wired it into settings; committed "Add dark mode".

Blockers
- [api] The flaky checkout test failed again after two attempts.

(/standup copy puts it on your clipboard)
```

You did the work, but at 9:58 you can't remember what it was. standup keeps a small journal as you work: the prompt you typed, the files Claude changed and the commits it made. `/standup` hands that journal to a fast model, which writes the standup.

## Features

- **Journals automatically**: every main-thread turn records the time, the project, your prompt, the files changed by successful `Edit`/`Write`/`NotebookEdit` calls, git commits (the subject comes from git's own output, or from `-m` and heredoc messages), and how long it took.
- **Works across projects**: one journal covers every repo you work in, grouped by project.
- **`/standup`** writes the last working day (Friday on a Monday) and today, plus blockers inferred only from the journal: repeated attempts, failing tests, interrupted turns. It never invents work.
- **`/standup raw [days]`** prints the journal itself, no model involved (the last 2 days by default, up to 14).
- **`/standup copy`** puts the last standup on your clipboard for Slack.
- **`/standup clear`** wipes the journal.
- **Small and local**: the journal stays on your machine in the mod's store and keeps 14 days, at most 80 turns a day, with every field size-capped. If the model is unavailable, `/standup` shows the raw journal instead.

## Install

```shell
/plugin marketplace add Singh-AP/awesome-claude-mods
/plugin install standup@awesome-claude-mods
```

Requires Claude Code 2.1.287 or later. The journal starts filling from the moment the mod is installed.

## Configuration

Set this in `/config`, or under `pluginConfigs` in `settings.json`.

| Option | Default | What it does |
| --- | --- | --- |
| `model` | `haiku` | The model that writes the standup: an alias (`haiku`, `sonnet`) or a full model id. |

## How it works

| Event / API | Why |
| --- | --- |
| `prompt.submit` | Records the prompt you typed (your own prompts only; slash commands and plugin prompts are skipped) |
| `tool.call` on `Edit`, `Write`, `NotebookEdit`, `Bash` | Records the files changed and `git commit` subjects of calls that succeeded |
| `turn.complete` | Writes the turn's entry to `$.store` under its day and drops days older than 14 |
| `command.run` | `/standup`, `raw`, `copy`, `clear` |
| `$.model.complete` | One call per `/standup` (~600 output tokens at most) |
| `$.ui.copy` | `/standup copy` |

## Test it

```shell
claude plugin test mods/productivity/standup   # 22 tests
```

## Limitations

- It only knows what happened through Claude: work you did by hand, or files changed by shell commands like `sed -i`, isn't in the journal.
- Each `/standup` costs one small model call. `/standup raw` is free.
- Two sessions finishing a turn at the same instant can race on that day's entry, so one turn may be lost.
