#!/usr/bin/env bash
# Schedules scripts/daily/run-local.sh every morning on macOS (launchd).
#
#   scripts/daily/install-launchd.sh [HH:MM]     default 07:45
#   scripts/daily/install-launchd.sh --remove
#
# The Mac must be awake (or set to wake) at that time. Logs go to
# ~/Library/Logs/awesome-claude-mods-daily.log.

set -euo pipefail
LABEL="com.awesome-claude-mods.daily"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

if [ "${1:-}" = "--remove" ]; then
  launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  echo "✔ removed $LABEL"
  exit 0
fi

AT="${1:-07:45}"
HOUR=$((10#${AT%%:*}))
MINUTE=$((10#${AT##*:}))
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
LOG="$HOME/Library/Logs/awesome-claude-mods-daily.log"

mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string><string>-lc</string>
    <string>cd "$REPO" &amp;&amp; scripts/daily/run-local.sh</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>$HOUR</integer><key>Minute</key><integer>$MINUTE</integer></dict>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
PLIST

launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
printf '✔ scheduled daily at %02d:%02d: %s\n  log: %s\n  run now: launchctl kickstart gui/%s/%s\n' "$HOUR" "$MINUTE" "$PLIST" "$LOG" "$(id -u)" "$LABEL"
