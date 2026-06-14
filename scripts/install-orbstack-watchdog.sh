#!/usr/bin/env bash
#
# Installs the OrbStack docker-hang watchdog (www-sizh) as a per-user LaunchAgent
# on homelab. Run ON homelab, as calum (NOT sudo , a LaunchAgent must live in the
# user's GUI session so it can pgrep + `open -a OrbStack` the user's OrbStack):
#
#   ./scripts/install-orbstack-watchdog.sh
#
# Idempotent. Probes `docker info` every OBW_INTERVAL seconds; on a sustained hang
# (OBW_THRESHOLD consecutive hung probes) it hard-restarts OrbStack, rate-limited
# to once per OBW_COOLDOWN. See scripts/orbstack-watchdog.sh for the logic +
# scripts/test-orbstack-watchdog.sh for the hermetic tests.
#
# Uninstall:  launchctl bootout gui/$(id -u)/co.worldwidewebb.orbstack-watchdog
#             rm ~/Library/LaunchAgents/co.worldwidewebb.orbstack-watchdog.plist

set -euo pipefail

[ "$(id -u)" -ne 0 ] || { echo "FATAL: run as calum, NOT sudo (LaunchAgent must be in your GUI session)" >&2; exit 1; }

OBW_INTERVAL="${OBW_INTERVAL:-30}"
LABEL="co.worldwidewebb.orbstack-watchdog"
BIN_DIR="$HOME/.local/bin"
WRAPPER="$BIN_DIR/orbstack-watchdog.sh"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
STATE_DIR="$HOME/.local/state/orbstack-watchdog"
SRC="$(cd "$(dirname "$0")" && pwd)/orbstack-watchdog.sh"

[ -f "$SRC" ] || { echo "FATAL: $SRC not found" >&2; exit 1; }

mkdir -p "$BIN_DIR" "$STATE_DIR" "$(dirname "$PLIST")"
install -m 0755 "$SRC" "$WRAPPER"
echo "installed watchdog → $WRAPPER"

cat >"$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$WRAPPER</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>OBW_STATE_DIR</key><string>$STATE_DIR</string>
    <key>OBW_STATE_FILE</key><string>$STATE_DIR/state</string>
    <key>OBW_LOG</key><string>$STATE_DIR/watchdog.log</string>
    <key>PATH</key><string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>StartInterval</key><integer>$OBW_INTERVAL</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardErrorPath</key><string>$STATE_DIR/launchd.err</string>
</dict>
</plist>
PLIST_EOF
echo "wrote LaunchAgent → $PLIST (every ${OBW_INTERVAL}s)"

# Reload idempotently.
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "loaded $LABEL , tail $STATE_DIR/watchdog.log to watch it"
