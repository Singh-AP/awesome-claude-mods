# 🐱 buddy

> A tiny ASCII pet that lives above your prompt, reacts to everything Claude does, and levels up as you ship.

<img src="../../../assets/screens/hero.svg" alt="buddy in a real Claude Code session" width="100%">

```text
 /\_/\       Byte  Lv 4 cat
( o_o )      ███████████░░░░░░░░░ 412/500 XP
 > ^ <       ⚙️ running npm test

 /\_/\  ♪    Byte  Lv 4 cat
( ^w^ )      ███████████░░░░░░░░░ 423/500 XP
 > ^ <       ✅ tests are green!

 /\_/\  zZ   Byte  Lv 4 cat
( -.- )      ███████████░░░░░░░░░ 428/500 XP
 > ^ <       zZ… napping
```

Long agent runs are mostly you watching a spinner. buddy gives that wait a face: a little pet in the band above your prompt that reads files when Claude reads, types when Claude edits, panics when a command fails, throws a party when you commit, and dozes off when you walk away.

## Features

- **Reacts to real events**: 📖 reading `register.ts` · ✏️ editing · 📝 writing · ⚙️ running `npm test` · 🔍 searching · 🌐 browsing · 🤝 delegating to a subagent · 🙋 asking you a question
- **Moods**: thinking while a turn runs, startled when a tool fails, wary when a guard blocks a command, happy on a green test run (jest, vitest, pytest, cargo, go, bun, …), party on a successful `git commit`, napping after a quiet spell
- **Six species**: cat, dog, blob, robot, ghost and duck, each with a face for every mood
- **XP and levels**: +1 per tool call, +5 per finished turn, +10 per green test run, +20 per commit. Levels get further apart, and a toast announces each one: `🎉 Byte reached level 4!`
- **Persistent**: XP, lifetime counts, name and species live in the mod's store, so your pet survives restarts and `/clear` and gains XP from every session
- **Cheap**: the 2-frame animation runs only while Claude is working. An idle pet keeps one pending nap timer, and a sleeping pet runs nothing.
- **Fits anywhere**: three rows on a wide band, one line (`( o.o ) Byte 📖 reading…`) under 44 columns. It steps aside for surveys.

## Install

```shell
/plugin marketplace add Singh-AP/awesome-claude-mods
/plugin install buddy@awesome-claude-mods
```

Requires Claude Code 2.1.287 or later. The band shows in the terminal and the Desktop app.

## Commands

| Command | What it does |
| --- | --- |
| `/buddy` | Stats card: level, XP bar, lifetime tool calls, turns, commits, green test runs, oopsies |
| `/buddy name Mochi` | Renames your pet (`/buddy name` alone goes back to the configured name) |
| `/buddy species robot` | Swaps species: `cat`, `dog`, `blob`, `robot`, `ghost`, `duck` |
| `/buddy hide` · `/buddy show` | Tucks the pet away, or brings it back |

## Configuration

Set these in `/config`, or under `pluginConfigs` in `settings.json`.

| Option | Default | What it does |
| --- | --- | --- |
| `name` | `Byte` | Your pet's name |
| `species` | `cat` | `cat`, `dog`, `blob`, `robot`, `ghost` or `duck` |
| `sleepAfterSeconds` | `120` | Seconds without activity before your pet naps (10 to 3600) |

## How it works

| Event / API | Why |
| --- | --- |
| `ui.render` on `AbovePrompt` | Draws the pet, its XP bar and what it's up to |
| `turn.start` · `turn.complete` | Thinking while a turn runs; +5 XP and back to idle when it ends |
| `tool.call` | A tool-specific line while it runs; after `next(e)`, reads the result for errors, denies, green tests and commits |
| `$.state` | The mood, the animation frame and the pet, so the band redraws only when they change |
| `$.clock.every` · `$.clock.after` | The animation while working, the nap timer and fleeting moods |
| `$.store` | XP and lifetime counts, read fresh before each write so parallel sessions add up |
| `classic.SessionStart` | Reloads the pet after `/clear` resets `$.state` |

The art (`hooks/art.ts`) and the rules (`hooks/pet.ts`) are pure TypeScript with no `$`. Add a species by adding three rows to `ART`.

## Test it

```shell
claude plugin test mods/fun/buddy   # 33 tests
```

## Limitations

- Green tests and commits are recognized from the command and its output, so an unusual test runner may not count. A failing run never counts as green.
- XP earned in the last moments before a crash or kill may be lost. It's written to the store at the end of each turn and at session end.
- Emoji widths vary between terminals, which can shift the activity line by a cell.
