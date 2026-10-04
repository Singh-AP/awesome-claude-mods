# 📦 slopsquat-guard

> No more hallucinated packages. Every `npm`, `pip`, `uv`, `poetry`, `cargo` and `gem` install Claude runs is checked against its registry first: names that don't exist are blocked, and brand-new or lookalike packages ask you.

```text
● Bash(npm install react-hooks-super-utils)
  ⎿  Error: slopsquat-guard blocked this install: react-hooks-super-utils (npm):
     no package named "react-hooks-super-utils" exists on npm. The name may be
     hallucinated, and attackers register hallucinated names ("slopsquatting").

╭─ slopsquat ──────────────────────────────────────────────────╮
│ slopsquat-guard: these packages look risky:                   │
│   • reqests (PyPI): it was first published 2 days ago; it has │
│     only 4 downloads a week; its name is one letter away from │
│     the popular "requests"                                    │
│                                                               │
│ Install anyway?                                               │
│ ❯ 1. Install anyway                                           │
│   2. Block it                                                 │
╰───────────────────────────────────────────────────────────────╯
```

Models sometimes invent plausible package names, and attackers now register those names with malware inside ("slopsquatting"). Typosquats like `reqests` and `lodahs` work the same way. slopsquat-guard checks the registry before the install command runs.

## Features

- **Blocks packages that don't exist** on npm, PyPI, crates.io or RubyGems, and npm names that were unpublished. The model is told not to guess another spelling.
- **Asks before risky ones:** first published fewer than `minAgeDays` ago, fewer than `minWeeklyDownloads` a week, or one letter away from a popular package (swap, drop or add) while not popular itself. A headless run refuses.
- **Reads real install syntax.** `npm i/install/add`, `pnpm add`, `yarn add`, `bun add`, `npx`/`bunx`/`pnpm dlx` (which download and run straight away), `pip`/`pip3`/`python -m pip install`, `uv add`, `uv pip install`, `uvx`, `uv tool install`, `poetry`/`pdm`/`rye`/`hatch add`, `pipenv install`, `pipx install/run`, `cargo add/install`, `gem install`, `bundle add`. Versions, extras, scopes and aliases (`x@npm:real`) are handled; chains like `cd web && npm i axios` are handled.
- **Ignores what isn't a registry package:** bare `npm install`, `-r requirements.txt`, `-e .`, local paths, tarballs and wheels, `git+…`, `github:`, `file:`, `workspace:`. `npx tsc` is skipped when the project already has the binary. A command pointing at its own registry (`--registry`, `-i`, `--index-url`) is skipped too, since the guard can't vouch for a private index.
- **Fast and polite.** Popular npm/PyPI packages are cleared by a `HEAD` plus a tiny downloads lookup (no multi-megabyte metadata). Verdicts are cached for 24 h (1 h for "missing").
- **Never blocks you for being offline.** If a registry doesn't answer within `timeoutMs`, the install runs, and one toast says it went unchecked.
- **`/slopsquat <npm|pypi|crates|gem> <name>`** checks a package by hand, for example `OK: react exists on npm (222,767,611 downloads a week)`.

## Install

```shell
/plugin marketplace add Singh-AP/awesome-claude-mods
/plugin install slopsquat-guard@awesome-claude-mods
```

Requires Claude Code 2.1.287 or later.

## Configuration

| Option | Default | What it does |
| --- | --- | --- |
| `minAgeDays` | `14` | A package first published fewer days ago asks first. |
| `minWeeklyDownloads` | `50` | A package with fewer weekly downloads asks first. RubyGems is estimated from lifetime downloads. |
| `allowList` | empty | Comma-separated names that are never checked: your private and internal packages. |
| `timeoutMs` | `5000` | How long to wait for a registry before letting the install run unchecked. |

## How it works

| Event / API | Why |
| --- | --- |
| `tool.call` on `Bash` | Parses the command for installs, checks each package, returns `{ deny }` for missing ones, asks with `$.ui.ask` for risky ones, else `next(e)` |
| `$.http.fetch` | `registry.npmjs.org` and `api.npmjs.org`, `pypi.org` and `pypistats.org`, `crates.io`, `rubygems.org` |
| `$.store` | The verdict cache (newest 400, one week) and the all-time blocked count |
| `$.fs.exists` | Skips `npx <bin>` when `node_modules/.bin/<bin>` exists |
| `command.run` | `/slopsquat` |

The parser (`hooks/parse.ts`) and the verdict logic (`hooks/verdict.ts`) are pure TypeScript with no `$`.

## Test it

```shell
claude plugin test mods/safety/slopsquat-guard   # 88 tests
```

In a live headless run, Claude was asked to `npm install this-package-should-not-exist-acm-xyz`. Against the real npm registry the guard refused it with the message above, and the model stopped.

## Limitations

- It checks packages named on the command line. Dependencies pulled in by `package.json`, `requirements.txt`, lockfiles or transitively aren't checked.
- Existing isn't the same as safe. A long-lived, popular package can still be compromised. This guard targets the hallucinated-name and typosquat cases.
- Go modules, Maven/Gradle, NuGet, Composer and conda aren't covered yet.
- Each uncached package costs one to three small registry requests, which adds a beat before a fresh install.
