#!/usr/bin/env bash
# Runs a dev serve command under a health watchdog so Tilt self-heals.
#
# WHY: Tilt's readiness_probe only colors a resource red/green , it never
# restarts a local_resource serve_cmd. When Vite/the API comes up but isn't
# actually serving (hung, port race, dep not ready), the process stays alive
# and Tilt sits red until someone clicks Restart. On an unattended wall panel
# that's the real defect. This wrapper converts "unhealthy" into "exit
# non-zero", which Tilt's normal crash-restart (with backoff) then heals.
#
# Usage:
#   serve-with-watchdog.sh <health-url> <grace-secs> <fail-window-secs> -- <cmd...>
#
#   health-url        URL polled to decide liveness (e.g. http://localhost:4200/)
#   grace-secs        startup grace before polling begins (no restart during this)
#   fail-window-secs  sustained-unhealthy duration that triggers a restart
#
# Exit codes: child's own code if it exits first; 1 if the watchdog kills it.

set -euo pipefail

health_url="$1"; grace="$2"; fail_window="$3"
shift 3
[[ "$1" == "--" ]] && shift

poll_interval=2

# Launch the real serve command in its own process group so we can take the
# whole tree down (Vite/bun spawn children) on restart or Tilt shutdown.
set -m
"$@" &
child=$!

cleanup() {
  # Kill the child's process group, not just the child, so no orphans linger.
  kill -TERM -- "-$child" 2>/dev/null || true
  wait "$child" 2>/dev/null || true
}
trap 'cleanup; exit 143' TERM INT

# Startup grace: just watch for an early crash, don't health-check yet.
waited=0
while (( waited < grace )); do
  if ! kill -0 "$child" 2>/dev/null; then
    wait "$child"; exit $?
  fi
  sleep "$poll_interval"
  (( waited += poll_interval )) || true
done

# Steady state: poll health. Restart only after sustained failure.
unhealthy=0
while true; do
  if ! kill -0 "$child" 2>/dev/null; then
    # Process exited on its own , surface its code, let Tilt restart.
    wait "$child"; exit $?
  fi

  if curl -fsS -m 3 -o /dev/null "$health_url" 2>/dev/null; then
    unhealthy=0
  else
    (( unhealthy += poll_interval )) || true
    if (( unhealthy >= fail_window )); then
      echo "watchdog: $health_url unhealthy for ${fail_window}s , restarting" >&2
      cleanup
      exit 1
    fi
  fi

  sleep "$poll_interval"
done
