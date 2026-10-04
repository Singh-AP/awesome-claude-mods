# 💡 command-explainer

> Know what you're approving. A plain-English line on what a shell command will do, with its risk, right where Claude asks for permission.

<img src="../../../assets/screens/command-explainer.svg" alt="command-explainer in a real Claude Code session" width="100%">

```text
❯ clean up old temp files in the demo folder

  Deleting .tmp files older than 30 days in acm-demo
  ⎿  🛑 Danger: Permanently deletes every .tmp file under /tmp/acm-demo and its
     subdirectories last modified more than 30 days ago, with no confirmation.
────────────────────────────────────────────────────────────────────────────────
 Bash command
 find /tmp/acm-demo -name '*.tmp' -mtime +30 -delete

 Do you want to proceed?
 ❯ 1. Yes
   2. Yes, and switch to auto mode
   3. No
```

Permission prompts show you the command, and the command is often the hard part: `find … -exec`, `git push --force-with-lease`, a 300-character `awk` pipeline. command-explainer asks a small, fast model for one sentence about the command's concrete effect (which files, which remote, what gets deleted) and a risk level: 💡 Safe, ⚠️ Caution or 🛑 Danger.

## Features

- **Only when you're about to be asked.** It runs Claude Code's own permission check (`$.tool.check`) first. Commands your rules or mode already allow cost nothing.
- **Never slows the call.** The tool call goes ahead at once and the explanation appears when the model answers, usually within a few seconds, while the dialog is still open.
- **Skips the obvious.** Plain read-only commands (`ls`, `cat file`, `git status`, `git log`, …) are never sent to a model. Chains, pipes, redirects and substitutions always are.
- **Free repeats.** The last 200 explanations are cached by exact command.
- **Works under org model policies.** If your organization blocks the configured model, it falls back to the session's own model.
- **`/explain <command>`** explains any command on demand, including in `claude -p`.

## Install

```shell
/plugin marketplace add Singh-AP/awesome-claude-mods
/plugin install command-explainer@awesome-claude-mods
```

Requires Claude Code 2.1.287 or later.

## Configuration

Set these in `/config`, or under `pluginConfigs` in `settings.json`.

| Option | Default | What it does |
| --- | --- | --- |
| `model` | `haiku` | The model that writes the explanation. If it's refused, the session's model is used. |
| `minLength` | `0` | Skip commands shorter than this many characters. |

## How it works

| Event / API | Why |
| --- | --- |
| `tool.call` on `Bash` | Starts the explanation alongside the call, then `next(e)` immediately |
| `$.tool.check` | Explain only when the decision is `ask`, meaning a dialog is about to open |
| `$.model.complete` | One short, low-effort completion, 80 tokens at most, with a 15 s timeout |
| `ui.render` on `ToolGroup` / `ToolUse` | Draws the line under the call's own row, right above the dialog, until the call resolves |
| `$.state` | Hands the explanation to the drawing, which redraws when it lands |
| `$.ui.notice` | Also offered as the dialog's own notice line, for surfaces that draw one |
| `command.run` | `/explain` |

## Test it

```shell
claude plugin test mods/safety/command-explainer   # 41 tests
```

## Limitations

- Each new command at a permission prompt costs one small model call. Plain commands and repeats are free.
- The explanation comes from a model. It's a second pair of eyes, not a guarantee, so read the command too.
- A permission dialog doesn't have a render site of its own, so the line sits on the call's row just above the dialog. In this Claude Code release, `$.ui.notice` doesn't draw under the terminal's Bash permission dialog.
