#!/usr/bin/env bash
#
# Hermetic tests for the OrbStack watchdog decision + probe logic (CC-sizh).
# No real docker / OrbStack: we source the watchdog (its `obw_main` is guarded so
# sourcing has no side effects) and exercise the pure functions directly, stubbing
# `docker` on PATH for the probe tests. Mirrors scripts/test-check-*.sh.

set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"

# Source the watchdog without running it (BASH_SOURCE guard).
# shellcheck source=/dev/null
source "$HERE/orbstack-watchdog.sh"

PASS=0
FAIL=0
check() { # check <desc> <expected> <actual>
  if [ "$2" = "$3" ]; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
    echo "FAIL: $1 — expected '$2', got '$3'"
  fi
}

# --- obw_decide matrix (consec, threshold, since_restart, cooldown) ----------
# threshold=3, cooldown=600 throughout
check "healthy → ok"            ok       "$(obw_decide 0 3 9999 600)"
check "1 hang below threshold"  watch    "$(obw_decide 1 3 9999 600)"
check "2 hangs below threshold" watch    "$(obw_decide 2 3 9999 600)"
check "threshold + cooled down" restart  "$(obw_decide 3 3 601 600)"
check "over threshold + cooled" restart  "$(obw_decide 5 3 600 600)"
check "threshold but in cooldown" cooldown "$(obw_decide 3 3 599 600)"
check "threshold, just restarted" cooldown "$(obw_decide 3 3 0 600)"
# anti-loop: a fresh restart (since=0) must NEVER immediately restart again
check "no back-to-back restart" cooldown "$(obw_decide 9 3 1 600)"

# --- obw_probe_docker with a stubbed `docker` on PATH ------------------------
STUBDIR="$(mktemp -d)"
trap 'rm -rf "$STUBDIR"' EXIT
export PATH="$STUBDIR:$PATH"
export OBW_PROBE_TIMEOUT=2

# healthy docker: returns instantly
cat >"$STUBDIR/docker" <<'EOF'
#!/usr/bin/env bash
echo "29.4.0"
EOF
chmod +x "$STUBDIR/docker"
obw_probe_docker && r=0 || r=1
check "probe: responsive docker → 0" 0 "$r"

# hung docker: sleeps far past the probe timeout (the wedged-engine signature)
cat >"$STUBDIR/docker" <<'EOF'
#!/usr/bin/env bash
sleep 30
EOF
chmod +x "$STUBDIR/docker"
START="$(date +%s)"
obw_probe_docker && r=0 || r=1
ELAPSED=$(( $(date +%s) - START ))
check "probe: hung docker → 1" 1 "$r"
# must give up at ~OBW_PROBE_TIMEOUT, not wait the full 30s sleep
check "probe: hung docker bounded by timeout" yes "$([ "$ELAPSED" -le 6 ] && echo yes || echo no)"

# erroring docker (daemon down, returns fast non-zero): treated as unhealthy
cat >"$STUBDIR/docker" <<'EOF'
#!/usr/bin/env bash
exit 1
EOF
chmod +x "$STUBDIR/docker"
obw_probe_docker && r=0 || r=1
check "probe: erroring docker → 1" 1 "$r"

echo "----"
echo "orbstack-watchdog: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
