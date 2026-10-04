# 🛡️ bash-guard

> A seatbelt for YOLO mode. Blocks the shell commands nobody means to run, and asks before the ones you might regret, **even with `--dangerously-skip-permissions`**.

<img src="../../../assets/screens/bash-guard.svg" alt="bash-guard in a real Claude Code session" width="100%">

```text
● Bash(rm -rf ~/)
  ⎿  Error: bash-guard blocked this command because it recursively deletes ~/.

╭─ bash-guard ────────────────────────────────────────────────╮
│ bash-guard: this command force-pushes over a protected       │
│ branch.                                                      │
│                                                              │
│   $ git push --force origin main                             │
│                                                              │
│ Run it?                                                      │
│ ❯ 1. Run it                                                  │
│   2. Block it                                                │
╰──────────────────────────────────────────────────────────────╯
```

Permission prompts get tuned out, and bypass mode turns them off. bash-guard is a mod: it sits on every `Bash` tool call (subagents included) *below* the permission system, so it holds even when nothing else does.

## Features

- **Blocks outright** (the model gets the reason, so it stops and asks you):
  `rm -rf` on `/`, `~`, `$HOME` or system dirs · `rm --no-preserve-root` · `mkfs` · `dd of=/dev/disk…` · `> /dev/sda` · fork bombs · `chmod/chown -R` on system dirs · `shutdown`/`reboot` · `kill -9 -1` · `find / -delete` · `diskutil erase…` · `gh repo delete`
- **Asks first** (a real dialog; a headless run refuses):
  force-push · `reset --hard` · `clean -f` · `checkout -- .` · `stash clear` · `branch -D` · history rewrites · `curl … | sh` · `DROP TABLE` / `TRUNCATE` / `DELETE` without `WHERE` · `FLUSHALL` · `terraform destroy` · `kubectl delete` · `helm uninstall` · cloud `delete-*` / `terminate-*` · `docker system prune` · `npm|cargo publish` · `sudo` · `rm -rf *` / `.git` · `crontab -r` · overwriting `~/.zshrc`
- **Understands shell**, not just regexes: quotes, `&&`/`;`/`|` chains, `$(…)` and backticks, `bash -c "…"`, `eval`, `sudo`/`env`/`xargs`/`nohup` wrappers. `git commit -m "rm -rf /"` is fine; `echo $(rm -rf ~)` is not.
- **Your own rules**: a block pattern and a confirm pattern (regular expressions).
- **`/bash-guard <command>`** dry-runs any command against the rules; **`/bash-guard`** shows what it blocked this session and all time.

## Install

```shell
/plugin marketplace add Singh-AP/awesome-claude-mods
/plugin install bash-guard@awesome-claude-mods
```

Requires Claude Code 2.1.287 or later.

## Configuration

Set these in `/config`, or under `pluginConfigs` in `settings.json`.

| Option | Default | What it does |
| --- | --- | --- |
| `risky` | `confirm` | Risky commands: `confirm` asks you, `block` refuses, `allow` runs them. Catastrophic commands are always blocked. |
| `customBlock` | empty | Regex. Matching commands are always blocked, e.g. `deploy\.sh.*--prod`. |
| `customConfirm` | empty | Regex. Matching commands ask first. |

## How it works

| Event | Why |
| --- | --- |
| `tool.call` on `Bash` | Parses the command, returns `{ deny }` for a block, asks with `$.ui.ask` for a confirm, else `next(e)` |
| `command.run` | `/bash-guard` status and dry-run |
| `$.store` | Keeps the all-time blocked count |

The analyzer (`hooks/analyze.ts`) is pure TypeScript with no `$`, so you can import it into your own mod.

## Test it

```shell
claude plugin test mods/safety/bash-guard   # 101 tests
```

## Limitations

- It reads the command text. A script file the model writes and then runs (`./cleanup.sh`) is checked by name, not by contents.
- It's a seatbelt, not a sandbox. For real isolation, run Claude Code in a container or VM.
