#!/usr/bin/env bash
#
# Installs the Home Assistant Core watchdog as a per-user LaunchAgent on homelab.
# Run ON homelab, as calum (NOT sudo , it must share the GUI session that owns
# the com.homeassistant.os LaunchAgent it kickstarts):
#
#   ./scripts/install-ha-watchdog.sh
#
# Idempotent. Probes :8123 every HAW_INTERVAL seconds; after HAW_THRESHOLD
# consecutive failures it restarts the HAOS guest CLEANLY (stop-haos.sh → ACPI,
# then launchctl kickstart), rate-limited to once per HAW_COOLDOWN. See
# scripts/ha-watchdog.sh for the logic and scripts/test-ha-watchdog.sh for the
# hermetic tests.
#
# Uninstall:  launchctl bootout gui/$(id -u)/co.worldwidewebb.ha-watchdog
#             rm ~/Library/LaunchAgents/co.worldwidewebb.ha-watchdog.plist

set -euo pipefail

[ "$(id -u)" -ne 0 ] || { echo "FATAL: run as calum, NOT sudo (LaunchAgent must be in your GUI session)" >&2; exit 1; }

HAW_INTERVAL="${HAW_INTERVAL:-60}"
LABEL="co.worldwidewebb.ha-watchdog"
BIN_DIR="$HOME/.local/bin"
WRAPPER="$BIN_DIR/ha-watchdog.sh"
LIB_DIR="$BIN_DIR/lib"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
STATE_DIR="$HOME/.local/state/ha-watchdog"
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$HERE/ha-watchdog.sh"
LIB_SRC="$HERE/lib/watchdog-decide.sh"

[ -f "$SRC" ] || { echo "FATAL: $SRC not found" >&2; exit 1; }
[ -f "$LIB_SRC" ] || { echo "FATAL: $LIB_SRC not found" >&2; exit 1; }

mkdir -p "$BIN_DIR" "$LIB_DIR" "$STATE_DIR" "$(dirname "$PLIST")"
install -m 0755 "$SRC" "$WRAPPER"
# ha-watchdog.sh sources lib/watchdog-decide.sh RELATIVE to itself, so the lib
# has to be installed alongside it, not just left in the repo.
install -m 0755 "$LIB_SRC" "$LIB_DIR/watchdog-decide.sh"
echo "installed watchdog → $WRAPPER (+ lib/watchdog-decide.sh)"

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
    <key>HAW_STATE_DIR</key><string>$STATE_DIR</string>
    <key>HAW_STATE_FILE</key><string>$STATE_DIR/state</string>
    <key>HAW_LOG</key><string>$STATE_DIR/watchdog.log</string>
    <key>HAW_STOP</key><string>$HOME/homeassistant-os/stop-haos.sh</string>
    <key>PATH</key><string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>StartInterval</key><integer>$HAW_INTERVAL</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardErrorPath</key><string>$STATE_DIR/launchd.err</string>
</dict>
</plist>
PLIST_EOF
echo "wrote LaunchAgent → $PLIST (every ${HAW_INTERVAL}s)"

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "loaded $LABEL , tail $STATE_DIR/watchdog.log to watch it"
