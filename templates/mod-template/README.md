# 🧩 my-mod

> A starting point for your own Claude Code mod: a status line, a tool-call hook, a slash command, an option and tests.

## Try it

```shell
npx degit Singh-AP/awesome-claude-mods/templates/mod-template my-mod
cd my-mod
claude plugin validate --strict .   # what it hooks and calls
claude plugin test .                # run the tests
claude --plugin-dir .               # load it in a session
```

Edit `hooks/register.ts` while the session runs: the mod hot-reloads when you save.

## Next

- Read [Writing mods: the practical guide](../../docs/writing-mods.md) for the patterns and gotchas.
- When it's ready, add it to the list: see [CONTRIBUTING.md](../../CONTRIBUTING.md).
