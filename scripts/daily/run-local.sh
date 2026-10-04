#!/usr/bin/env bash
# The daily job on your own machine, with your own Claude Code sign-in: run the
# maintainer, check the paths it touched, run every CI check, then commit and
# push. Nothing is committed unless all of that passes.
#
#   scripts/daily/run-local.sh [--no-push]
#
# Same environment as run-agent.sh (CLAUDE_AGENT_BIN, CLAUDE_BIN, DAILY_MODEL,
# DAILY_BUDGET_USD). To run it every morning, see automation/README.md.

set -euo pipefail
cd "$(dirname "$0")/../.."

PUSH=true
[ "${1:-}" = "--no-push" ] && PUSH=false

if [ -n "$(git status --porcelain)" ]; then
  echo "✘ The working tree has changes; commit or stash them first." >&2
  exit 1
fi
git checkout --quiet main
git pull --quiet --ff-only origin main

scripts/daily/run-agent.sh || echo "(the agent exited with an error; checking what it left)"

node scripts/daily/check-paths.mjs
if [ -z "$(git status --porcelain)" ]; then
  echo "Nothing changed today."
  exit 0
fi

echo "── every CI check"
npm run check
node scripts/each-mod.mjs validate --write-capabilities
git diff --exit-code docs/capabilities.md >/dev/null || { echo "✘ docs/capabilities.md is stale" >&2; exit 1; }

title="$(head -n 1 automation/last-run.md | cut -c1-72)"
[ -n "$title" ] || title="daily: $(date -u +%F)"
git add -A
{ echo "$title"; echo; tail -n +3 automation/last-run.md; echo; echo "Co-Authored-By: Claude <noreply@anthropic.com>"; } | git commit --quiet -F -
echo "✔ committed: $title"

if [ "$PUSH" = true ]; then
  git push --quiet origin main
  echo "✔ pushed; the site redeploys on its own"
fi
