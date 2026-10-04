# 🔔 done-ding

> Go make coffee. done-ding pings you with a desktop notification and a chime when a long Claude turn finishes, or when Claude is waiting on you.

```text
┌──────────────────────────────────────────────┐
│ 🔔 Claude Code                                │
│ api                                           │
│ Done in 4m 12s · Refactored the auth module…  │
└──────────────────────────────────────────────┘
          ♪ ding-dong

┌──────────────────────────────────────────────┐
│ 🔔 Claude Code needs you                      │
│ api                                           │
│ Claude needs your permission to use Bash      │
└──────────────────────────────────────────────┘
```

Long turns are when you switch windows, and they're also when you miss the moment Claude finishes or stops to ask a question. done-ding only pings for turns that took a while. A 3-second answer you were watching stays silent.

## Features

- **Done pings**: a turn of at least `minSeconds` (30 by default) on the main thread gets a desktop notification with how long it took and the answer's first line, e.g. `Done in 2m 14s · Fixed the flaky test.` The subtitle is the project name.
- **Waiting pings**: permission prompts, the "waiting for your input" reminder and MCP input dialogs ping too, at most once a minute. The idle reminder right after a done ping is skipped.
- **Errors and refusals** say so: `An error ended the turn after 3m 2s`.
- **Sound**: a short two-note chime synthesized in code, so the mod ships no audio files. `say` speaks "Claude is done" instead, and `none` stays quiet.
- **Works where it can**: `osascript` on macOS, `notify-send` on Linux, otherwise a toast inside Claude Code. A missing notifier never errors.
- **Stays out of the way**: interrupted turns, subagent turns and headless `claude -p` runs don't ping. Headless runs can opt in.
- **`/ding test`** sends a sample, **`/ding mute`** and **`/ding unmute`** silence it for the session, and **`/ding`** shows the settings.
- **Phone pushes (optional).** Set `ntfyTopic` and every ping also lands on your phone through [ntfy](https://ntfy.sh): install the ntfy app, subscribe to a hard-to-guess topic, done. Works with a self-hosted ntfy server too.

## Install

```shell
/plugin marketplace add Singh-AP/awesome-claude-mods
/plugin install done-ding@awesome-claude-mods
```

Requires Claude Code 2.1.287 or later. On macOS, the first notification may ask you to allow notifications for Script Editor (`osascript`) in System Settings → Notifications.

## Configuration

Set these in `/config`, or under `pluginConfigs` in `settings.json`.

| Option | Default | What it does |
| --- | --- | --- |
| `minSeconds` | `30` | Only turns at least this long ping you. |
| `sound` | `chime` | `chime`, `say` (speaks a line), or `none`. |
| `desktop` | `true` | Show a desktop notification. Off: a toast inside Claude Code. |
| `notifyOnWaiting` | `true` | Also ping when Claude needs a permission or your input. |
| `inHeadless` | `false` | Also ping for `claude -p` and SDK runs. |
| `ntfyTopic` | empty | Your ntfy topic for phone pushes (letters, digits, `-`, `_`). Empty: no pushes. |
| `ntfyServer` | `https://ntfy.sh` | The ntfy server to publish to. |

## How it works

| Event / API | Why |
| --- | --- |
| `turn.complete` | Main-thread turns that weren't interrupted and ran at least `minSeconds` |
| `classic.Notification` | The settings `Notification` event: `permission_prompt`, `idle_prompt`, `elicitation_dialog` |
| `session.start` | Registers `/ding` and notes whether a person is at the prompt |
| `$.process.run` | `osascript` (argv, no shell quoting) or `notify-send` |
| `$.audio.play` / `$.audio.speak` | The synthesized WAV chime (`hooks/chime.ts`), or speech |
| `$.clock.after` | Sends the ping after the turn has finished, so it never delays the answer |
| `$.http.fetch` | Only with `ntfyTopic` set: one JSON POST to your ntfy server per ping |

## Test it

```shell
claude plugin test mods/notifications/done-ding   # 35 tests
```

## Limitations

- It can't tell whether you're looking at the terminal, so `minSeconds` is the only filter for done pings.
- Windows has no desktop notifier here yet, so it falls back to a toast.
- If you already have a settings `Notification` hook that notifies you, turn `notifyOnWaiting` off to avoid double pings.
- A phone push sends the ping's text (the turn's length, the first line of the answer, the project name) to your ntfy server. On the public ntfy.sh, anyone who guesses your topic can read it, so pick a long random one, or self-host.
