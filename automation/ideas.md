# Mod ideas

The daily run builds the first idea under **Next** that isn't already covered by a mod here or in the curated list. GitHub issues labelled [`idea`](https://github.com/Singh-AP/awesome-claude-mods/issues?q=is%3Aissue+is%3Aopen+label%3Aidea) come first. Add ideas freely: one line each, `name (category): what the user gets, and the main API it needs`.

## Next

- [ ] ci-pulse (awareness): the latest GitHub Actions run for the current branch in the status line, with a toast when it turns red or green. `gh run list` via `$.process.run`, polled on a slow `$.clock.every` only while a turn ran recently.
- [ ] pr-pulse (awareness): the open PR for this branch in the status line (number, review state, checks), and `/pr` for details. `gh pr view --json`.
- [ ] keep-awake (productivity): stop the laptop sleeping while Claude works. On macOS, `caffeinate -i -w <pid>` spawned at `turn.start` and ended at `turn.complete`. Off on other platforms.
- [ ] readonly (safety): `/readonly` toggles a mode where every Edit, Write, NotebookEdit and mutating Bash command is refused, for review sessions. Band shows `🔒 read-only`.
- [ ] branch-guard (safety): refuse commits and pushes straight to main/master (configurable), and nudge Claude to make a branch first.
- [ ] license-guard (safety): before `npm install`/`pip install`, look up each package's license on its registry and ask before adding GPL/AGPL/unknown ones. `$.http.fetch`.
- [ ] big-file-guard (cost): stop Claude reading huge or binary files whole (lockfiles, minified bundles, images); suggest a range read instead. `$.fs.stat` on Read.
- [ ] token-diet (cost): flag tool results that blow up the context (a 40k-token Bash dump), toast the size and suggest a narrower command. `tool.call` result sizes.
- [ ] pomodoro (productivity): `/pomodoro` starts a 25/5 timer in the band; toasts at breaks; counts pomodoros per day.
- [ ] time-tracker (productivity): hours spent with Claude per project per day; `/timesheet [week]` prints a table you can paste into an invoice.
- [ ] deps-audit (safety): after a dependency install, run the ecosystem's audit (`npm audit --json`, `pip-audit`) and toast new high/critical advisories.
- [ ] autoformat (productivity): after Edit/Write, run the project's formatter on that file (prettier, ruff, gofmt, rustfmt) when one is configured; status line says what ran.
- [ ] port-watch (awareness): dev servers Claude started (listening ports), in a pane, with a button to stop each.
- [ ] scratchpad (productivity): a pane with your own notes for the session, kept per project; `/note <text>` appends.
- [ ] rate-limit-coach (cost): when the 5-hour window passes 80%, suggest switching to a cheaper model for simple turns and show when the window resets.

## Done

- bash-guard, secret-shield, slopsquat-guard, file-guard, command-explainer, net-guard, injection-guard, cost-meter, tool-radar, files-touched, git-pulse, test-pulse, aim, snippets, standup, tldr, done-ding, buddy, wrapped, spinner-packs (launch, 2026-10-04)

## Dropped

<!-- name: why, date -->
