# 📎 snippets

> Your best prompts, one command away. `/snip review` drops your saved review prompt into the prompt box, with the branch, your selection and any extra text filled in.

```text
> /snip review the token refresh

╭──────────────────────────────────────────────────────────────╮
│ > Review the changes on branch feat/oauth: the uncommitted    │
│   ones and the commits not yet on the main branch.            │
│   Pay extra attention to: the token refresh                   │
│   Look for bugs first, then security problems, then needless  │
│   complexity. List each finding with file:line, ...           │
╰──────────────────────────────────────────────────────────────╯
                         ╭─ snippets ───────────────────────────────╮
                         │ /snip review is in the prompt: edit it   │
                         │ or press Enter                           │
                         ╰──────────────────────────────────────────╯
```

Snippets fill the prompt box and stop. Nothing is sent until you press Enter, so you can edit the text first. That's what makes them different from a custom slash command.

## Features

- **`/snip <name> [extra]`** expands the snippet into the prompt box. If you've typed a draft, it's inserted at the cursor instead.
- **Placeholders:**

  | Placeholder | Becomes |
  | --- | --- |
  | `{{args}}` | the text after the name (appended at the end if the snippet has no `{{args}}`) |
  | `{{selection}}` | what you last selected with the mouse (fullscreen terminal) |
  | `{{branch}}` | the current git branch |
  | `{{date}}` | today, `YYYY-MM-DD` |
  | `{{name\|default}}` | the value, or `default` when it's empty |

  A line whose placeholders all come out empty is dropped, so one snippet works with or without a selection.
- **Five starters** that are good out of the box: `review`, `explain`, `tests`, `commit-msg`, `plan`. Override one by saving your own under the same name; remove one with `/snip rm`.
- **Global:** snippets live in the mod's own store, so they follow you into every project.
- **Headless-safe:** where there's no prompt box (`claude -p`), the expanded text is printed instead.

## Install

```shell
/plugin marketplace add Singh-AP/awesome-claude-mods
/plugin install snippets@awesome-claude-mods
```

Requires Claude Code 2.1.287 or later.

## Commands

| Command | What it does |
| --- | --- |
| `/snip` | Lists snippets with a preview, starters marked |
| `/snip <name> [extra text]` | Expands it into the prompt box |
| `/snip save <name> <text>` | Saves or replaces one (names: letters, digits, `-`, `_`) |
| `/snip show <name>` | Prints the raw template |
| `/snip rm <name>` | Removes it; removing a starter keeps it from coming back |

Example: `/snip save bugfix Reproduce {{args}} with a failing test first, then fix it and show me the diff.`

## How it works

| Event or call | Why |
| --- | --- |
| `command.run` on `snip` | Parses the verb and reads or writes `$.store` |
| `$.prompt.read`, `$.prompt.fill` | Puts the expanded text in the box (`replace`, or `insert` at the cursor over a draft) |
| `$.ui.selection`, `$.process.run(git)`, `$.clock.now` | Fill `{{selection}}`, `{{branch}}` and `{{date}}`, each only when the snippet uses it |

## Test it

```shell
claude plugin test mods/productivity/snippets   # 15 tests
```

## Limitations

- `{{selection}}` needs the fullscreen terminal. Elsewhere it's empty, and its line is dropped.
- Line breaks you type after `/snip save <name>` (Shift+Enter, or `\` then Enter) are kept in the snippet. Larger edits are easiest in the store file, `~/.claude/plugins/store/snippets_*.json`.
