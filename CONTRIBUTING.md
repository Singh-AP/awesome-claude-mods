# Contributing

Two ways to add to Awesome Claude Mods:

1. **List a mod that lives elsewhere.** Open a [Submit a mod](https://github.com/Singh-AP/awesome-claude-mods/issues/new?template=submit-a-mod.yml) issue. That's all.
2. **Add a mod to this repo.** Open a pull request, as below. It gets tested in CI against every new Claude Code release and is installable from this marketplace.

## The bar

A mod gets in when it is:

- **A mod.** `hooks/hooks.json` lists `modules`. Skills, agents and shell hooks alone belong in other lists.
- **Useful or delightful,** in one line a stranger understands.
- **Quiet.** No toasts on every tool call, no timers while idle, no surprises.
- **Honest.** The README says what it does and what it can't do. No telemetry. Network calls only when the feature needs them, and the README says which.
- **Tested.** `claude plugin test` covers the behaviour the README promises.

## Add a mod to this repo

```shell
git clone https://github.com/Singh-AP/awesome-claude-mods && cd awesome-claude-mods
npm install
cp -R templates/mod-template mods/<category>/<your-mod>
```

Categories: `safety`, `cost`, `awareness`, `productivity`, `notifications`, `fun`.

1. Rename it in `.claude-plugin/plugin.json` (the name must not start with `claude-`) and write `hooks/register.ts`. The [practical guide](docs/writing-mods.md) has the patterns and the gotchas.
2. Write tests in `tests/*.test.ts`, then run `claude plugin test mods/<category>/<your-mod>`.
3. Try it for real with `claude --plugin-dir mods/<category>/<your-mod>`.
4. Write `README.md`, following [bash-guard's](mods/safety/bash-guard/README.md): what it looks like, features, install, options, the events it uses, limitations.
5. Add an entry to `registry.json` (`name`, `category`, `emoji`, `tagline`), then run `npm run readme`. This regenerates `README.md` and `.claude-plugin/marketplace.json`, so don't edit those two by hand.
6. Run `npm run check` and open the PR.

`npm run check` runs exactly what CI runs:

| Step | Command |
| --- | --- |
| Generated files are fresh | `node scripts/build-readme.mjs --check` |
| Types | `npm run types` writes `.types/` from your Claude Code binary, then `npm run typecheck` runs strict TypeScript against it |
| Static analysis | `claude plugin validate --strict` on the marketplace and every mod |
| Tests | `claude plugin test` on every mod |

## Updating a mod

Bump `version` in its `plugin.json`. Installed copies are cached by version, so users only get the change after a bump.

## Code style

Match the surrounding code: TypeScript, two-space indent, no semicolons, single quotes. Pure logic goes in its own file with no `$`, so it can be unit-tested. Comments explain *why*, not *what*.

## Featured? Show it off

If your mod is in the list, add this badge to its README:

```markdown
[![Featured in Awesome Claude Mods](https://img.shields.io/badge/featured%20in-awesome--claude--mods-D97757?logo=anthropic&logoColor=white)](https://github.com/Singh-AP/awesome-claude-mods)
```

[![Featured in Awesome Claude Mods](https://img.shields.io/badge/featured%20in-awesome--claude--mods-D97757?logo=anthropic&logoColor=white)](https://github.com/Singh-AP/awesome-claude-mods)
