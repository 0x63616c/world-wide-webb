#!/usr/bin/env bash
#
# Hermetic tests for the HA watchdog. No real VM, no real Home Assistant: we
# source the watchdog (its `haw_main` is guarded so sourcing has no side effects),
# exercise the decision matrix, stub `curl` on PATH for the probe, and stub both
# `stop-haos.sh` and `launchctl` to prove the restart path is CLEAN and rate
# limited. Mirrors scripts/test-orbstack-watchdog.sh.

set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"

# shellcheck source=/dev/null
source "$HERE/ha-watchdog.sh"

PASS=0
FAIL=0
check() { # check <desc> <expected> <actual>
  if [ "$2" = "$3" ]; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
    echo "FAIL: $1 , expected '$2', got '$3'"
  fi
}

# --- decision matrix (consec, threshold, since_restart, cooldown) ------------
# threshold=3, cooldown=900 throughout
check "healthy → ok"              ok       "$(wd_decide 0 3 9999 900)"
check "1 failure below threshold" watch    "$(wd_decide 1 3 9999 900)"
check "2 failures below threshold" watch   "$(wd_decide 2 3 9999 900)"
check "threshold + cooled down"   restart  "$(wd_decide 3 3 901 900)"
check "over threshold + cooled"   restart  "$(wd_decide 5 3 900 900)"
check "threshold but in cooldown" cooldown "$(wd_decide 3 3 899 900)"
check "threshold, just restarted" cooldown "$(wd_decide 3 3 0 900)"
# anti-loop: a fresh restart must NEVER immediately restart again. An HA guest
# takes ~35s to serve :8123, so without this the watchdog would restart it
# repeatedly while it was legitimately booting , and each unclean cycle risks the
# recorder rebuild this whole exercise exists to avoid.
check "no back-to-back restart"   cooldown "$(wd_decide 9 3 1 900)"

# --- haw_probe with a stubbed `curl` on PATH ---------------------------------
STUBDIR="$(mktemp -d)"
trap 'rm -rf "$STUBDIR"' EXIT
export PATH="$STUBDIR:$PATH"

mk_curl() { printf '#!/usr/bin/env bash\necho -n "%s"\n' "$1" >"$STUBDIR/curl"; chmod +x "$STUBDIR/curl"; }

mk_curl 200
haw_probe && check "200 → alive" alive alive || check "200 → alive" alive dead

mk_curl 401
haw_probe && check "401 still counts as alive" alive alive || check "401 still counts as alive" alive dead

mk_curl 502
haw_probe && check "502 still counts as alive" alive alive || check "502 still counts as alive" alive dead

mk_curl 000
haw_probe && check "000 (refused) → dead" dead alive || check "000 (refused) → dead" dead dead

printf '#!/usr/bin/env bash\necho -n ""\n' >"$STUBDIR/curl"; chmod +x "$STUBDIR/curl"
haw_probe && check "empty output → dead" dead alive || check "empty output → dead" dead dead

# --- full tick: restart path is clean, rate-limited, and persists state -------
export HAW_STATE_DIR="$STUBDIR/state"
export HAW_STATE_FILE="$HAW_STATE_DIR/state"
export HAW_LOG="$HAW_STATE_DIR/log"
export HAW_THRESHOLD=3
export HAW_COOLDOWN=900
export HAW_STOP="$STUBDIR/stop-haos.sh"
mkdir -p "$HAW_STATE_DIR"

printf '#!/usr/bin/env bash\necho "STOP-CALLED" >>"%s/calls"\n' "$STUBDIR" >"$HAW_STOP"
chmod +x "$HAW_STOP"
printf '#!/usr/bin/env bash\necho "LAUNCHCTL $*" >>"%s/calls"\n' "$STUBDIR" >"$STUBDIR/launchctl"
chmod +x "$STUBDIR/launchctl"

mk_curl 000   # HA is dead for every tick below

: >"$STUBDIR/calls"
echo "0 0" >"$HAW_STATE_FILE"
haw_main; check "tick 1 → consec=1"  "1 0" "$(cat "$HAW_STATE_FILE")"
haw_main; check "tick 2 → consec=2"  "2 0" "$(cat "$HAW_STATE_FILE")"
# NB: `grep -c` prints 0 AND exits non-zero on no-match, so never append `|| echo 0`.
check "no restart before threshold" 0 "$(grep -c STOP-CALLED "$STUBDIR/calls")"

haw_main   # tick 3 → threshold reached, last_restart=0 so cooldown has elapsed
check "restarted at threshold"      1 "$(grep -c STOP-CALLED "$STUBDIR/calls")"
check "used the CLEAN stop path"    1 "$(grep -c STOP-CALLED "$STUBDIR/calls")"
check "kicked the launchd label"    1 "$(grep -c 'LAUNCHCTL kickstart' "$STUBDIR/calls")"
check "consec reset after restart"  0 "$(awk '{print $1}' "$HAW_STATE_FILE")"

# Three more failures immediately after: must NOT restart again (cooldown).
haw_main; haw_main; haw_main
check "cooldown blocks a second restart" 1 "$(grep -c STOP-CALLED "$STUBDIR/calls")"

# Never kills QEMU directly , the whole point of the clean path.
check "never kills qemu" 0 "$(grep -c 'kill' "$STUBDIR/calls")"

# Recovery clears the streak.
mk_curl 200
haw_main
check "recovery resets consec" 0 "$(awk '{print $1}' "$HAW_STATE_FILE")"

echo "----"
echo "ha-watchdog: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
