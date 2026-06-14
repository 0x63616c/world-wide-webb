#!/usr/bin/env bash
# Set up a local dev workspace for control-center: start the Tilt dev stack
# (postgres + api + web + storybook), wait for the web app to be live, then
# surface the Tilt log UI and the app itself in cmux browser views.
#
# Idempotent: if Tilt is already running it just re-opens the views.
# Prereqs (the script checks and fails fast with the fix): docker running,
# tilt, bun, and an authenticated `op` (1Password) for `op inject` secrets.
set -euo pipefail

PORT_WEB=4200
PORT_API=4201
PORT_TILT=10350
TILT_LOG=/tmp/cc-tilt.log

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

log() { printf '[setup-workspace] %s\n' "$*"; }
fail() { log "FATAL: $*"; exit 1; }

# ── 1. Prereqs ────────────────────────────────────────────────────────────────
command -v tilt >/dev/null || fail "tilt not found , brew install tilt-dev/tap/tilt"
command -v bun  >/dev/null || fail "bun not found , see https://bun.sh"
command -v op   >/dev/null || fail "op (1Password CLI) not found"
docker info >/dev/null 2>&1 || fail "docker daemon not reachable , start OrbStack/Docker"
op whoami >/dev/null 2>&1 || fail "op not authenticated , run: eval \$(op signin)"

# ── 2. Start (or reuse) the Tilt stack ────────────────────────────────────────
if curl -fsS -o /dev/null --max-time 2 "http://localhost:${PORT_TILT}/" 2>/dev/null; then
  log "Tilt already running on :${PORT_TILT} , reusing"
else
  log "Starting Tilt dev stack (logs → ${TILT_LOG})"
  nohup tilt up --stream=true >"$TILT_LOG" 2>&1 &
  disown
fi

# ── 3. Wait for the web app to serve ──────────────────────────────────────────
log "Waiting for web app on :${PORT_WEB} (api boots + db migrates first; ~30-60s cold)"
for _ in $(seq 1 120); do
  if curl -fsS -o /dev/null --max-time 2 "http://localhost:${PORT_WEB}/" 2>/dev/null; then
    READY=1; break
  fi
  sleep 2
done
[ "${READY:-}" = "1" ] || fail "web app never came up , check: tail -f ${TILT_LOG}"
log "Web app is live on :${PORT_WEB}"

# ── 4. Surface the views in cmux ──────────────────────────────────────────────
if command -v cmux >/dev/null; then
  log "Opening Tilt UI + app in cmux browser views"
  cmux open "http://localhost:${PORT_TILT}" || true
  cmux open "http://localhost:${PORT_WEB}" || true
else
  log "cmux not found , open these manually:"
fi

cat <<EOF

  Control-center workspace is up:
    Web app      http://localhost:${PORT_WEB}    (board, fixed 1366x1024)
    API          http://localhost:${PORT_API}
    Tilt logs    http://localhost:${PORT_TILT}   (per-service logs + restart/db buttons)
    Storybook    http://localhost:6006
    Raw log      ${TILT_LOG}

  Hot reload is on (bun --watch for api, Vite HMR for web). Edit and see it live.
  Stop the stack with: tilt down
EOF
