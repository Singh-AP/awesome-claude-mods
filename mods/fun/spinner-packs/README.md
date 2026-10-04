# 🏴‍☠️ spinner-packs

> Claude isn't "Sautéing…" anymore. It's **Charting a course…**, then **Charted a course for 51s**. Ten themed word packs for the spinner, or your own words.

```text
✳ Charting a course… (12s · thinking)

● Here's the poem…

✻ Charted a course for 51s · done 3:23 PM
```

Captured from a real session with the pirate pack. The spinner keeps its word for the whole turn, and the line that closes the turn uses the same word in the past tense.

## Features

- **Ten packs, 27 words each**, every one with a past form for the closing line:

  | Pack | A taste |
  | --- | --- |
  | 🏴‍☠️ `pirate` | Plundering · Keelhauling bugs · Counting doubloons |
  | 🎭 `shakespeare` | Soliloquizing · Perchancing · Consulting the witches |
  | 💼 `corporate` | Synergizing · Circling back · Boiling the ocean |
  | 🧙 `wizard` | Conjuring · Polishing the orb · Hexing bugs |
  | 👩‍🍳 `chef` | Deglazing · Julienning · Tempering chocolate |
  | 🚀 `space` | Calibrating thrusters · Engaging hyperdrive · Splashing down |
  | 🕵️ `noir` | Dusting for prints · Rounding up the usual suspects · Smelling a rat |
  | ✨ `genz` | Cooking · Locking in · Understanding the assignment |
  | 🍃 `zen` | Raking the gravel · Sipping tea · Returning to stillness |
  | 💾 `retro` | Dialing up · Reticulating splines · Downloading more RAM |

- **`random`** (the default) picks a pack each session.
- **Your own words** with the `custom` option. Write `Frobbing|Frobbed` to theme the closing line too.
- **`/spinner <pack>`** switches mid-turn and remembers the choice. Also `/spinner random`, `/spinner off`, and `/spinner reset` (back to your setting). **`/spinner`** lists every pack with samples.
- **Leaves status messages alone.** While Claude Code shows a state such as compacting, its own text stays. On the desktop app, the row's step text ("Creating notes.md") stays and only its idle "Working" is themed.

## Install

```shell
/plugin marketplace add Singh-AP/awesome-claude-mods
/plugin install spinner-packs@awesome-claude-mods
```

Requires Claude Code 2.1.287 or later.

## Configuration

| Option | Default | What it does |
| --- | --- | --- |
| `pack` | `random` | `random`, one of the ten packs, or `off` (Claude Code's own words). A `/spinner` choice wins over this until `/spinner reset`. |
| `custom` | empty | Comma-separated words that replace every pack, e.g. `Frobbing\|Frobbed, Yak shaving\|Shaved yaks`. |
| `themeClosingLine` | `true` | Also theme the line that closes a turn ("Plundered for 1m 3s"). Terminal only. |

## How it works

| Event | Why |
| --- | --- |
| `ui.render` on `Spinner` | Rewrites `props.word` with `next({ ...e, props })`, so the engine still draws the glyph, timer and tokens |
| `ui.render` on `TurnDuration` | Rewrites the past-tense `word` to match the spinner word that turn showed |
| `turn.start` | Moves to the next word and redraws |
| `command.run` | `/spinner` |
| `$.store` | Remembers your `/spinner` choice |

It rewrites props rather than drawing its own tree, so it stacks with other mods on the same sites, such as [cost-meter](../../cost/cost-meter)'s turn cost.

## Test it

```shell
claude plugin test mods/fun/spinner-packs   # 26 tests
```

## Limitations

- The closing line is terminal-only, because the desktop app draws its own footer.
- Closing lines drawn before the mod loaded, such as a resumed transcript, get a word from the pack but not necessarily the one their spinner showed.
