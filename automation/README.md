# 🤖 The daily run

Every morning, Claude Code maintains this repo by itself:

1. **Keeps it green.** It runs every check, and when a Claude Code release has changed the mods API, fixing that comes first.
2. **Curates.** It reviews the newest mods the [index](../catalog/README.md) found (`automation/.work/candidates.md`), reads their code, and adds at most three that clear the [bar](../CONTRIBUTING.md#the-bar) to `data/community.json`. Ones it can vet (OSI license, safe code, passes the validator at a pinned commit) become installable from this marketplace. Every decision, yes or no, goes in `data/curation-log.json`.
3. **Builds one new mod.** It takes the top open [`idea` issue](https://github.com/Singh-AP/awesome-claude-mods/issues?q=is%3Aissue+is%3Aopen+label%3Aidea), or the next item in [ideas.md](ideas.md), and builds it like every other mod here: tests, README, strict validation.
4. **Reports.** It writes [last-run.md](last-run.md) and a [CHANGELOG](../CHANGELOG.md) entry.

Nothing is published unless a clean machine re-runs **every** CI check and agrees.

## How it's kept safe

| Risk | Guard |
| --- | --- |
| The agent weakens the checks that judge it | It may only change mods, curation data and generated docs ([`ALLOWED`](../scripts/daily/lib.mjs)). A change to workflows, `scripts/`, `site/` or the build config fails the run. |
| A broken or half-built mod ships | The `verify` job applies the change to a fresh checkout and runs `npm run check` (types, strict validation, every test, generated files). Only then does `publish` push. |
| A prompt injection in a third-party README | The agent job has a **read-only** token. It runs with this repo's own [injection-guard](../mods/safety/injection-guard), [net-guard](../mods/safety/net-guard) (only GitHub and package registries are reachable), [secret-shield](../mods/safety/secret-shield), [bash-guard](../mods/safety/bash-guard) and [file-guard](../mods/safety/file-guard) loaded. The guards are copied before the run, so the agent can't edit them. |
| The job that can push runs untrusted code | `publish` runs nothing from the change. It applies the patch, re-checks the paths, commits and pushes. |
| Runaway spend | `--max-budget-usd` caps each run (default $10). |

## Turn it on (GitHub Actions)

1. Add one secret, under **Settings → Secrets and variables → Actions**:
   - `ANTHROPIC_API_KEY`: an API key from the [Claude Console](https://console.anthropic.com/), or
   - `CLAUDE_CODE_OAUTH_TOKEN`: run `claude setup-token` to use a Claude subscription instead.

   ```shell
   gh secret set ANTHROPIC_API_KEY -R Singh-AP/awesome-claude-mods
   ```
2. Optionally, set repository variables:

   | Variable | Default | What it does |
   | --- | --- | --- |
   | `DAILY_MODEL` | your account's default | `opus` for the best mods, `sonnet` for cheaper runs |
   | `DAILY_BUDGET_USD` | `10` | spend cap per run |
   | `DAILY_MODE` | `push` | `pr` opens a pull request for you to merge instead of pushing to `main`. Needs **Settings → Actions → General → Allow GitHub Actions to create pull requests**. |

It runs at 05:45 UTC (07:45 in Central Europe), after the index refresh. To run it now:

```shell
gh workflow run daily-mods.yml -R Singh-AP/awesome-claude-mods -f budget=10
```

The site redeploys after each run that changes something.

## Or run it on your Mac

```shell
scripts/daily/run-local.sh --no-push       # once, to see what it does
scripts/daily/run-local.sh                 # once, and push
scripts/daily/install-launchd.sh 07:45     # every morning at 07:45 (launchd)
scripts/daily/install-launchd.sh --remove
```

It uses your own Claude Code sign-in and runs the same agent, the same path check and the same `npm run check` before committing. Set `CLAUDE_BIN` if your `claude` can't run `claude plugin test` (for example, a wrapper), and `DAILY_MODEL` or `DAILY_BUDGET_USD` as above.

## Steer it

- **Ideas:** open an issue with the [Mod idea](https://github.com/Singh-AP/awesome-claude-mods/issues/new?template=mod-idea.yml) form and label it `idea`, or edit [ideas.md](ideas.md).
- **Instructions:** [daily-prompt.md](daily-prompt.md) is everything the agent is told.
- **Curation history:** [`data/curation-log.json`](../data/curation-log.json) has what it looked at and why it said yes or no.
