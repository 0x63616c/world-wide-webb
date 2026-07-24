#!/usr/bin/env bash
#
# Schedules scripts/drift-check.sh on homelab as a per-user LaunchAgent. Run ON
# homelab, as calum (NOT sudo , the checks it runs are per-user: `orb config` and
# the com.homeassistant.os LaunchAgent both live in this GUI session):
#
#   ./scripts/install-drift-check.sh
#
# Idempotent. Runs every DC_INTERVAL seconds (default 6h) FROM THE REPO CHECKOUT
# at ~/code/github.com/0x63616c/world-wide-webb , unlike the watchdogs this is
# not copied into ~/.local/bin, because the whole point is to compare the box
# against a freshly pulled main. See docs/homelab-host.md.
#
# Uninstall:  launchctl bootout gui/$(id -u)/co.worldwidewebb.drift-check
#             rm ~/Library/LaunchAgents/co.worldwidewebb.drift-check.plist

set -euo pipefail

[ "$(id -u)" -ne 0 ] || { echo "FATAL: run as calum, NOT sudo (orb config is per-user)" >&2; exit 1; }

DC_INTERVAL="${DC_INTERVAL:-21600}" # 6h
LABEL="co.worldwidewebb.drift-check"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
STATE_DIR="$HOME/.local/state/drift-check"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$REPO/scripts/drift-check.sh"

[ -x "$SCRIPT" ] || { echo "FATAL: $SCRIPT not found or not executable" >&2; exit 1; }

mkdir -p "$STATE_DIR" "$(dirname "$PLIST")"

cat >"$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$SCRIPT</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>DC_LOG</key><string>$STATE_DIR/drift.log</string>
    <key>PATH</key><string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>StartInterval</key><integer>$DC_INTERVAL</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$STATE_DIR/launchd.out</string>
  <key>StandardErrorPath</key><string>$STATE_DIR/launchd.err</string>
</dict>
</plist>
PLIST_EOF
echo "wrote LaunchAgent → $PLIST (every ${DC_INTERVAL}s)"

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "loaded $LABEL"
echo
echo "Drift shows up two ways:"
echo "  launchctl list | grep drift-check     # non-zero status = drift"
echo "  tail $STATE_DIR/drift.log"
