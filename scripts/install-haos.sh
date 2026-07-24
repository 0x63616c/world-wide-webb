#!/usr/bin/env bash
#
# Installs the Home Assistant OS guest's start/stop scripts and LaunchAgent onto
# the homelab Mac mini from the checked-in copies in infra/homelab/haos/.
# Run ON homelab, as calum (NOT sudo , the VM and its LaunchAgent belong to the
# user's GUI session, and the qcow2 lives under $HOME):
#
#   ./scripts/install-haos.sh           # apply
#   ./scripts/install-haos.sh --check   # report drift only, change nothing
#
# WHY: before 2026-07-24 these scripts existed ONLY on the box. They had been
# hand-edited over months (start-haos.sh had two stray .bak files next to it),
# nothing was reviewable, and nobody noticed that the "clean restart" path was in
# fact SIGTERM to QEMU. The repo is now the source of truth; --check is what makes
# that claim verifiable instead of aspirational.
#
# NOTE: installing does NOT restart the VM. QEMU flags only take effect on the
# next start, deliberately , this script must never be able to bounce Home
# Assistant as a side effect. Use infra/homelab/haos/stop-haos.sh + launchctl
# kickstart when you actually intend a restart.

set -euo pipefail

[ "$(id -u)" -ne 0 ] || { echo "FATAL: run as calum, NOT sudo (VM + LaunchAgent live in your session)" >&2; exit 1; }

CHECK_ONLY=0
[ "${1:-}" = "--check" ] && CHECK_ONLY=1

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="$ROOT/infra/homelab/haos"
HAOS_DIR="$HOME/homeassistant-os"
LABEL="com.homeassistant.os"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

[ -d "$SRC_DIR" ] || { echo "FATAL: $SRC_DIR not found" >&2; exit 1; }

# "<repo file>:<installed path>"
TARGETS=(
  "start-haos.sh:$HAOS_DIR/start-haos.sh"
  "stop-haos.sh:$HAOS_DIR/stop-haos.sh"
  "$LABEL.plist:$PLIST"
)

drift=0
for pair in "${TARGETS[@]}"; do
  src="$SRC_DIR/${pair%%:*}"
  dst="${pair#*:}"
  [ -f "$src" ] || { echo "FATAL: missing repo copy $src" >&2; exit 1; }

  if [ "$CHECK_ONLY" -eq 1 ]; then
    if [ ! -f "$dst" ]; then
      echo "MISSING  $dst"
      drift=1
    elif ! cmp -s "$src" "$dst"; then
      echo "DRIFTED  $dst"
      diff -u "$dst" "$src" | sed 's/^/    /' || true
      drift=1
    else
      echo "ok       $dst"
    fi
    continue
  fi

  mkdir -p "$(dirname "$dst")"
  # Scripts are executable; the plist is not.
  case "$dst" in
    *.plist) install -m 0644 "$src" "$dst" ;;
    *)       install -m 0755 "$src" "$dst" ;;
  esac
  echo "installed → $dst"
done

if [ "$CHECK_ONLY" -eq 1 ]; then
  [ "$drift" -eq 0 ] && { echo "in spec"; exit 0; }
  echo "OUT OF SPEC (run without --check to apply)"
  exit 1
fi

# Reload the LaunchAgent so plist edits take effect. This does NOT touch a
# running VM: start-haos.sh exits 0 early when the pidfile's process is alive.
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "loaded $LABEL"
echo
echo "NOTE: a running VM keeps its OLD QEMU flags until it is next restarted."
echo "      To restart deliberately:"
echo "        $HAOS_DIR/stop-haos.sh && launchctl kickstart -k gui/\$(id -u)/$LABEL"
