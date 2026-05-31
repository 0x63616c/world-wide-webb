#!/usr/bin/env bash
# Live status board for the ship-p0p1 workflow, designed to run inside a cmux Dock
# control. Shows P0/P1 ticket progress (from beads, the shared mission state),
# recent commits, and the tail of the newest workflow log. Re-renders every few
# seconds so it doubles as a "what's it on / what's done / count" dashboard.
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO" || exit 1

TXN_GLOB="$HOME/.claude/projects/-Users-calum-code-github-com-0x63616c-control-center/*/subagents/workflows"

render() {
  clear
  printf '\033[1m control-center · ship-p0p1 status\033[0m   %s\n' "$(date '+%H:%M:%S')"
  printf '────────────────────────────────────────────────────────\n'

  # P0/P1 ticket counts straight from beads (ground truth).
  bd list --json 2>/dev/null | python3 "$REPO/scripts/ship-status.py" 2>/dev/null || echo " (bd unavailable)"

  printf '────────────────────────────────────────────────────────\n'
  printf '\033[1m recent commits\033[0m\n'
  git log --oneline -6 2>/dev/null | sed 's/^/  /'

  # Newest workflow log tail, if a run is live.
  local newest
  newest="$(ls -t $TXN_GLOB/*/narrator.log 2>/dev/null | head -1)"
  if [ -n "${newest:-}" ]; then
    printf '────────────────────────────────────────────────────────\n'
    printf '\033[1m workflow activity\033[0m\n'
    tail -n 6 "$newest" 2>/dev/null | sed 's/^/  /'
  fi
}

# One-shot if --once, else live loop.
if [ "${1:-}" = "--once" ]; then
  render
else
  while true; do render; sleep 3; done
fi
