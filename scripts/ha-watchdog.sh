#!/usr/bin/env bash
#
# Home Assistant Core watchdog. Runs ON homelab, invoked every HAW_INTERVAL
# seconds by the LaunchAgent installed by install-ha-watchdog.sh.
#
# WHY: on 2026-07-24 HA Core died at 07:52:58 and simply stayed dead. Nothing
# noticed. The supervisor was healthy and answering on :4357, so its own watchdog
# saw no problem; launchd's KeepAlive is {SuccessfulExit:false} and start-haos.sh
# had already exited 0 eleven days earlier, so launchd was not watching either.
# The outage ran until a human looked. That gap , a dead Core inside a healthy
# guest under a healthy launchd job , is exactly what this closes.
#
# Probes the thing that actually matters (Core answering on :8123), not the guest
# and not the supervisor, because this incident had both of those green while
# Core was gone.
#
# Deliberately CONSERVATIVE, so it can never become the outage:
#   - acts only on HAW_THRESHOLD consecutive failures (default 3 → ~3 min)
#   - never restarts twice within HAW_COOLDOWN (default 900s)
#   - restarts CLEANLY via stop-haos.sh (ACPI), never by killing QEMU: repeated
#     unclean shutdowns corrupt HA's recorder DB, which once cost a ~55min
#     rebuild. A watchdog that power-cuts the guest on a flap would manufacture
#     that outage on a schedule.
#
# Each invocation does ONE probe → updates a small state file → maybe restarts.
# The decision is the shared pure function `wd_decide` (scripts/lib/), unit-tested
# hermetically by scripts/test-ha-watchdog.sh with NO real VM.

set -uo pipefail # NOT -e: probe failure is expected control flow, not an error.

# --- tunables (env-overridable; the test harness overrides them) -------------
HAW_URL="${HAW_URL:-http://192.168.0.38:8123/}"
HAW_THRESHOLD="${HAW_THRESHOLD:-3}"          # consecutive failed probes before acting
HAW_COOLDOWN="${HAW_COOLDOWN:-900}"          # min seconds between restarts (anti-loop)
HAW_PROBE_TIMEOUT="${HAW_PROBE_TIMEOUT:-10}" # seconds to wait for :8123
HAW_STATE_DIR="${HAW_STATE_DIR:-$HOME/.local/state/ha-watchdog}"
HAW_STATE_FILE="${HAW_STATE_FILE:-$HAW_STATE_DIR/state}" # "<consec> <last_restart_epoch>"
HAW_LOG="${HAW_LOG:-$HAW_STATE_DIR/watchdog.log}"
HAW_STOP="${HAW_STOP:-$HOME/homeassistant-os/stop-haos.sh}"
HAW_LABEL="${HAW_LABEL:-com.homeassistant.os}"

# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/watchdog-decide.sh"

# --- probe -------------------------------------------------------------------
# 0 if Core answers with ANY HTTP status, 1 if the connection fails or times out.
# Any status counts as alive on purpose: 401/403/302 all prove Core is serving.
# The failure we care about is "nothing is listening", which curl reports as 000.
haw_probe() {
  local code
  code="$(curl -s -o /dev/null -m "$HAW_PROBE_TIMEOUT" -w '%{http_code}' "$HAW_URL" 2>/dev/null)"
  [ -n "$code" ] && [ "$code" != "000" ]
}

haw_log() { echo "$(date '+%Y-%m-%dT%H:%M:%S%z') $*" >>"$HAW_LOG" 2>/dev/null; }

# --- recovery (CLEAN: ACPI shutdown, then let launchd start it again) ---------
haw_restart_ha() {
  if [ -x "$HAW_STOP" ]; then
    "$HAW_STOP" >>"$HAW_LOG" 2>&1
  else
    haw_log "WARNING: $HAW_STOP missing/not executable , cannot stop cleanly"
  fi
  launchctl kickstart -k "gui/$(id -u)/$HAW_LABEL" >>"$HAW_LOG" 2>&1
}

# --- one watchdog tick -------------------------------------------------------
haw_main() {
  mkdir -p "$HAW_STATE_DIR" 2>/dev/null
  local consec last_restart now action
  read -r consec last_restart 2>/dev/null <"$HAW_STATE_FILE" || true
  consec="${consec:-0}"
  last_restart="${last_restart:-0}"
  now="$(date +%s)"

  if haw_probe; then
    consec=0
  else
    consec=$((consec + 1))
  fi

  action="$(wd_decide "$consec" "$HAW_THRESHOLD" "$((now - last_restart))" "$HAW_COOLDOWN")"

  case "$action" in
    restart)
      haw_log "HA unreachable ${consec}x , restarting the guest cleanly"
      haw_restart_ha
      consec=0
      last_restart="$now"
      haw_log "HA guest restart issued"
      ;;
    cooldown)
      haw_log "HA unreachable ${consec}x but within ${HAW_COOLDOWN}s cooldown , holding"
      ;;
    watch)
      haw_log "HA unreachable ${consec}x (< ${HAW_THRESHOLD}) , watching"
      ;;
    ok) ;; # healthy: stay quiet
  esac

  echo "$consec $last_restart" >"$HAW_STATE_FILE" 2>/dev/null
}

# Only run when executed, not when sourced by the test harness.
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  haw_main
fi
