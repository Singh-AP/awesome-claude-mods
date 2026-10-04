#!/usr/bin/env bash
# Runs the daily maintainer: Claude Code, headless, on automation/daily-prompt.md,
# with this repo's own safety mods loaded as guardrails. Used by
# .github/workflows/daily-mods.yml and by scripts/daily/run-local.sh.
#
# Environment:
#   CLAUDE_AGENT_BIN   the claude that runs the agent (default: claude)
#   CLAUDE_BIN         the claude that validates and tests mods (default: claude)
#   DAILY_MODEL        model alias or id (default: your Claude Code default)
#   DAILY_BUDGET_USD   spend cap for the run (default: 10)
#
# It changes files only; it never commits. Its transcript goes to
# automation/.work/transcript.jsonl.

set -euo pipefail
cd "$(dirname "$0")/../.."

AGENT_BIN="${CLAUDE_AGENT_BIN:-claude}"
export CLAUDE_BIN="${CLAUDE_BIN:-claude}"
BUDGET="${DAILY_BUDGET_USD:-10}"
TODAY="$(date -u +%F)"
WORK="automation/.work"
mkdir -p "$WORK"

echo "── types and today's candidates"
npm run --silent types
node scripts/daily/candidates.mjs --limit 20

# Load the guards from a snapshot, so nothing the agent edits in mods/ changes them mid-run.
GUARDS="$(mktemp -d)"
trap 'rm -rf "$GUARDS"' EXIT
PLUGIN_ARGS=()
for guard in bash-guard file-guard secret-shield net-guard injection-guard slopsquat-guard; do
  cp -R "mods/safety/$guard" "$GUARDS/$guard"
  rm -rf "$GUARDS/$guard/tests" "$GUARDS/$guard/.claude-plugin/types"
  PLUGIN_ARGS+=(--plugin-dir "$GUARDS/$guard")
done

PROTECT='.github/**, scripts/**, site/**, templates/**, package.json, package-lock.json, tsconfig.json, automation/daily-prompt.md, data/mods.json, data/stats.json, data/candidates.json, catalog/**, **/migrations/**, **/*.lock, **/.env*, !**/.env.example, **/*.pem, **/id_rsa*, .git/**'
ALLOW='api.github.com, github.com, codeload.github.com, raw.githubusercontent.com, objects.githubusercontent.com, *.githubusercontent.com, registry.npmjs.org, pypi.org, files.pythonhosted.org, crates.io, rubygems.org, code.claude.com, docs.anthropic.com'
SETTINGS=$(node -e '
  const [protect, allow] = process.argv.slice(1)
  console.log(JSON.stringify({ pluginConfigs: {
    "bash-guard@inline": { options: { risky: "block" } },
    "file-guard@inline": { options: { protect } },
    "net-guard@inline": { options: { unknown: "deny", fetchUnknown: "deny", allow } },
    "injection-guard@inline": { options: { mode: "warn" } },
  } }))
' "$PROTECT" "$ALLOW")

MODEL_ARGS=()
[ -n "${DAILY_MODEL:-}" ] && MODEL_ARGS=(--model "$DAILY_MODEL")

PROMPT="$(cat automation/daily-prompt.md)

Today is $TODAY. CLAUDE_BIN=$CLAUDE_BIN is the binary for validate and test. Your spend cap is \$$BUDGET: finish and write the report before you run out."

echo "── agent (budget \$$BUDGET${DAILY_MODEL:+, model $DAILY_MODEL})"
set +e
"$AGENT_BIN" -p "$PROMPT" \
  ${MODEL_ARGS[@]+"${MODEL_ARGS[@]}"} \
  --max-budget-usd "$BUDGET" \
  --permission-mode bypassPermissions \
  --settings "$SETTINGS" \
  "${PLUGIN_ARGS[@]}" \
  --output-format stream-json --verbose > "$WORK/transcript.jsonl" 2> "$WORK/agent.stderr"
STATUS=$?
set -e

# The last result message: what the agent said it did, and what it cost.
node -e '
  const lines = require("fs").readFileSync(process.argv[1], "utf8").trim().split("\n")
  const result = lines.map(l => { try { return JSON.parse(l) } catch { return {} } }).filter(m => m.type === "result").pop()
  if (!result) { console.log("no result message (see automation/.work/agent.stderr)"); process.exit(0) }
  console.log(`agent: ${result.subtype}, ${result.num_turns} turns, $${(result.total_cost_usd ?? 0).toFixed(2)}`)
  console.log(String(result.result ?? "").slice(0, 2000))
' "$WORK/transcript.jsonl"
echo "── last-run.md"
cat automation/last-run.md
# A run that stopped early (budget, turn limit) can still leave good work;
# the checks that follow decide whether any of it is published.
echo "agent exit status: $STATUS"
exit 0
