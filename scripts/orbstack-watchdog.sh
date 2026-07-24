#!/usr/bin/env bash
#
# OrbStack docker-hang watchdog (www-sizh). Runs ON homelab, invoked every
# OBW_INTERVAL seconds by the LaunchDaemon installed by install-orbstack-watchdog.sh.
#
# WHY: twice now the whole prod stack has gone down because the OrbStack VM /
# docker engine WEDGED , once from an OOM RCU-stall (a runaway container), once
# from stuck NFS bind-mount ops jamming dockerd's task-create path. The signature
# is identical and recognisable: docker ACCEPTS a command but never returns (a
# hang, not an error), so `cloudflared` can't run → the tunnel drops → Cloudflare
# 1033 / HTTP 530. Recovery is always the same manual dance: hard-kill OrbStack's
# vmgr + app and relaunch. This watchdog automates exactly that, turning a
# multi-hour manual outage into a ~60s self-heal. It is deliberately CONSERVATIVE
# (acts only on a sustained hang, rate-limited) so it can never become the cause.
#
# Each invocation does ONE probe → updates a small state file → maybe restarts.
# The decision is a pure function (`obw_decide`) so it is unit-tested hermetically
# by scripts/test-orbstack-watchdog.sh with NO real docker / OrbStack.

set -uo pipefail # NOT -e: probe failure is expected control flow, not a script error.

# --- tunables (env-overridable; the test harness overrides them) -------------
OBW_THRESHOLD="${OBW_THRESHOLD:-3}"        # consecutive hung probes before acting
OBW_COOLDOWN="${OBW_COOLDOWN:-600}"        # min seconds between restarts (anti-loop)
OBW_PROBE_TIMEOUT="${OBW_PROBE_TIMEOUT:-12}" # seconds to wait for `docker info`
OBW_STATE_DIR="${OBW_STATE_DIR:-/usr/local/var/orbstack-watchdog}"
OBW_STATE_FILE="${OBW_STATE_FILE:-$OBW_STATE_DIR/state}"   # "<consec> <last_restart_epoch>"
OBW_LOG="${OBW_LOG:-$OBW_STATE_DIR/watchdog.log}"

# --- pure decision logic (TESTABLE , no side effects) ------------------------
# Now shared with scripts/ha-watchdog.sh , see scripts/lib/watchdog-decide.sh for
# why. obw_decide is kept as a thin alias so this script (and its existing test
# matrix) read unchanged.
# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/watchdog-decide.sh"
obw_decide() { wd_decide "$@"; }

# --- docker probe (macOS has no `timeout`; background + bounded wait + kill) --
# Returns 0 if `docker info` answers within OBW_PROBE_TIMEOUT, 1 if it hangs or errors.
obw_probe_docker() {
  ( docker info --format '{{.ServerVersion}}' >/dev/null 2>&1 ) &
  local pid=$! waited=0
  while kill -0 "$pid" 2>/dev/null; do
    sleep 1
    waited=$((waited + 1))
    if [ "$waited" -ge "$OBW_PROBE_TIMEOUT" ]; then
      kill -9 "$pid" 2>/dev/null
      return 1
    fi
  done
  wait "$pid"
}

# --- recovery: hard-restart OrbStack by exact PID, then relaunch -------------
# Mirrors the proven manual recovery. Targets ONLY the OrbStack app + its vmgr
# helper by exact PID (never a loose pkill , this box is shared).
obw_restart_orbstack() {
  local app vmgr
  vmgr="$(pgrep -f 'Helper vmgr -build-id' | head -1)"
  app="$(pgrep -f 'MacOS/OrbStack$' | head -1)"
  [ -n "$vmgr" ] && kill -9 "$vmgr" 2>/dev/null
  [ -n "$app" ] && kill -9 "$app" 2>/dev/null
  sleep 3
  open -a OrbStack 2>/dev/null
}

obw_log() { echo "$(date '+%Y-%m-%dT%H:%M:%S%z') $*" >>"$OBW_LOG" 2>/dev/null; }

# --- one watchdog tick -------------------------------------------------------
obw_main() {
  mkdir -p "$OBW_STATE_DIR" 2>/dev/null
  local consec last_restart now
  read -r consec last_restart 2>/dev/null <"$OBW_STATE_FILE" || true
  consec="${consec:-0}"
  last_restart="${last_restart:-0}"
  now="$(date +%s)"

  if obw_probe_docker; then
    consec=0
  else
    consec=$((consec + 1))
  fi

  local action
  action="$(obw_decide "$consec" "$OBW_THRESHOLD" "$((now - last_restart))" "$OBW_COOLDOWN")"

  case "$action" in
    restart)
      obw_log "docker hung ${consec}x (>= ${OBW_THRESHOLD}) , hard-restarting OrbStack"
      obw_restart_orbstack
      consec=0
      last_restart="$now"
      obw_log "OrbStack relaunched"
      ;;
    cooldown)
      obw_log "docker hung ${consec}x but within ${OBW_COOLDOWN}s cooldown , holding"
      ;;
    watch)
      obw_log "docker hung ${consec}x (< ${OBW_THRESHOLD}) , watching"
      ;;
    ok) ;; # healthy: stay quiet
  esac

  printf '%s %s\n' "$consec" "$last_restart" >"$OBW_STATE_FILE"
}

# Run only when executed directly, so tests can source obw_decide/obw_probe_docker.
if [ "${BASH_SOURCE[0]:-$0}" = "${0}" ]; then
  obw_main "$@"
fi
