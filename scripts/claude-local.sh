#!/usr/bin/env bash
# This repo's own Claude Code, kept apart from any `claude` you already have:
# installed under .tools/ (not on PATH), with its own config directory and its
# auto-updater off, so it never writes to ~/.claude, ~/.claude.json or
# ~/.local. The repo's scripts use it for `claude plugin validate|test` when
# it is installed.
#
#   scripts/claude-local.sh --install [version]   install or update it (default: latest)
#   scripts/claude-local.sh <claude args...>      run it

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TOOLS="$ROOT/.tools"
BIN="$TOOLS/claude-code/node_modules/.bin/claude"

if [ "${1:-}" = "--install" ]; then
  mkdir -p "$TOOLS/claude-code"
  [ -f "$TOOLS/claude-code/package.json" ] || echo '{ "private": true }' > "$TOOLS/claude-code/package.json"
  npm install --silent --prefix "$TOOLS/claude-code" --no-save --no-audit --no-fund "@anthropic-ai/claude-code@${2:-latest}"
  exec "$0" --version
fi

if [ ! -x "$BIN" ]; then
  echo "This repo's Claude Code isn't installed: run scripts/claude-local.sh --install" >&2
  exit 127
fi

mkdir -p "$TOOLS/config" "$TOOLS/xdg/data" "$TOOLS/xdg/state" "$TOOLS/xdg/cache"
export CLAUDE_CONFIG_DIR="$TOOLS/config"
export DISABLE_AUTOUPDATER=1
export XDG_DATA_HOME="$TOOLS/xdg/data" XDG_STATE_HOME="$TOOLS/xdg/state" XDG_CACHE_HOME="$TOOLS/xdg/cache"
exec "$BIN" "$@"
