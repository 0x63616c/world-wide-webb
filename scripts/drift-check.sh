#!/usr/bin/env bash
#
# Runs every homelab --check in one pass and reports drift. Invoked on a schedule
# by the LaunchAgent from install-drift-check.sh, and safe to run by hand:
#
#   ./scripts/drift-check.sh
#
# WHY: the --check modes already existed and already worked. The 2026-07-24
# outage happened anyway, because nothing ever RAN them , there was no repo
# checkout on the mini at all, so provision-orbstack.sh --check had never once
# executed on the machine it describes, and a 1GB memory drift sat there unseen
# for an unknown length of time. A check nobody runs is not a check.
#
# Exits non-zero if ANY check reports drift, so `launchctl list` shows a non-zero
# status for the job and the log says which one.

set -uo pipefail # NOT -e: we want to run EVERY check, not stop at the first.

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
DC_LOG="${DC_LOG:-$HOME/.local/state/drift-check/drift.log}"
DC_PULL="${DC_PULL:-1}" # set 0 to check the working tree as-is (tests, offline)

mkdir -p "$(dirname "$DC_LOG")" 2>/dev/null
log() { echo "$(date '+%Y-%m-%dT%H:%M:%S%z') $*" | tee -a "$DC_LOG"; }

# Compare against what main actually says, not a stale local checkout ,
# otherwise the check drifts along with the box and reports "in spec" forever.
if [ "$DC_PULL" = "1" ]; then
  git -C "$REPO" pull --quiet 2>>"$DC_LOG" || log "WARNING: git pull failed, checking possibly-stale checkout"
fi
log "checking against $(git -C "$REPO" log --oneline -1 2>/dev/null || echo 'unknown revision')"

failed=0
run_check() { # run_check <label> <script> [args...]
  local label="$1"; shift
  local out rc
  out="$("$@" 2>&1)"; rc=$?
  if [ "$rc" -eq 0 ]; then
    log "OK    $label"
  else
    failed=1
    log "DRIFT $label (exit $rc)"
    echo "$out" | sed 's/^/          /' | tee -a "$DC_LOG"
  fi
}

run_check "orbstack sizing" "$HERE/provision-orbstack.sh" --check
run_check "haos scripts"    "$HERE/install-haos.sh" --check

if [ "$failed" -eq 0 ]; then
  log "all checks in spec"
  exit 0
fi
log "DRIFT DETECTED , see above; re-run the offending script without --check to apply"
exit 1
