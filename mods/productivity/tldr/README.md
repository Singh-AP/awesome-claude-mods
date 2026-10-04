# 📝 tldr

> A one-line TL;DR under every long answer, written by a small, fast model, so you can skim a wall of text in two seconds.

```text
● A trie stores strings as paths of shared character nodes: each edge is
  one character, and a word is the path from the root to a marked node.
  Lookups cost O(m) for a key of length m, independent of how many keys
  … (300 more words) …

  TL;DR: A trie is a tree for fast prefix lookups, at the cost of more memory than a hash table.
```

When an answer runs past `minWords` words of prose (code blocks don't count), `tldr` asks a small model (Haiku by default) for one sentence of at most 25 words that leads with the outcome. Claude Code shows that line under the answer. The answer itself, and what the model remembers of it, stay untouched.

## Features

- **Automatic** on main-thread answers of 200+ words. Subagent turns, interrupted turns and API errors are skipped.
- **`/tldr`** summarizes the last answer on demand, whatever its length.
- **`/tldr off`** and **`/tldr on`** switch the automatic line; the setting is kept across sessions. **`/tldr status`** shows it.
- **Cheap and bounded:** one low-effort call with a ~120-token cap and a 15-second timeout. Long answers are cut to their head and tail before sending.
- **Never in the way:** if the call fails, times out or returns nothing, the answer shows as usual. Headless `-p` runs skip the automatic call, since they don't print the line.
- **Plays well with others:** if another mod already put a line under the answer, the TL;DR goes beneath it.

## Install

```shell
/plugin marketplace add Singh-AP/awesome-claude-mods
/plugin install tldr@awesome-claude-mods
```

Requires Claude Code 2.1.287 or later.

## Configuration

| Option | Default | What it does |
| --- | --- | --- |
| `minWords` | `200` | Answers with at least this many words of prose (20–5000) get a TL;DR |
| `model` | `haiku` | The model that writes it: an alias or a full model id |

## How it works

| Event or call | Why |
| --- | --- |
| `turn.complete` | After `next(e)`, returns `{ text: 'TL;DR: …' }`, which Claude Code draws beneath the answer |
| `$.model.complete` | One tool-less completion through your session's own credentials |
| `command.run` on `tldr` | On-demand summary (from `$.session.messages()`), plus on/off/status |
| `$.store` | Keeps the on/off switch |

## Test it

```shell
claude plugin test mods/productivity/tldr   # 12 tests
```

## Limitations

- Each TL;DR is an extra small model call, billed like any other request.
- The line shows in the interactive UI only; `claude -p` prints the answer alone.
