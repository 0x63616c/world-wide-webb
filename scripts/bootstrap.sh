#!/usr/bin/env bash
# Idempotent bootstrap for the homelab Mac Mini.
# Run once (or re-run safely) after OrbStack + Tailscale are confirmed running.
# No sudo. No secret values. Every step is safe to re-run.
#
# Prerequisites — these creds must already live in 1Password (Homelab vault):
#   - GHCR pull token  → scripts/save-ghcr-pull-token.sh
#   - Portainer admin  → scripts/save-portainer-admin.sh
# Bootstrap fails fast with the save-script to run if either is missing.
set -euo pipefail

PORTAINER_VERSION="2.27.3"
PORTAINER_IMAGE="portainer/portainer-ce:${PORTAINER_VERSION}"
PORTAINER_PORT="9000"
# Host-local published port — reachable during bootstrap before cloudflared is up.
PORTAINER_LOCAL_URL="http://127.0.0.1:${PORTAINER_PORT}"
# Public route via cloudflared — the fallback for boxes whose portainer service
# predates the published port (so a re-run on an existing box still works).
PORTAINER_PUBLIC_URL="https://portainer.worldwidewebb.co"

log() { printf '[bootstrap] %s\n' "$*"; }

command -v jq >/dev/null || { log "FATAL: jq is required"; exit 1; }

# ── 1. Verify required credentials are in 1Password (fail fast) ────────────────
require_secret() {
  if ! op read "$1" >/dev/null 2>&1; then
    log "WARNING: missing secret $1"
    log "         Run $2 first, then re-run bootstrap."
    exit 1
  fi
}
require_secret "op://Homelab/Portainer Admin/password" "scripts/save-portainer-admin.sh"

# ── 2. Ensure Swarm is active ─────────────────────────────────────────────────
if docker info 2>/dev/null | grep -q "Swarm: active"; then
  log "Swarm already active — skipping init"
else
  log "Initialising Docker Swarm"
  docker swarm init
fi

# ── 3. Portainer (monitoring UI only — never deploys anything) ─────────────────
# Publishes a host-local port so bootstrap can drive its API before cloudflared
# is up; the public route is served separately by cloudflared over the overlay.
if docker service ls --format '{{.Name}}' | grep -q '^portainer$'; then
  log "Portainer service already exists — skipping create"
else
  log "Creating portainer_data volume"
  docker volume create portainer_data

  log "Starting Portainer ${PORTAINER_VERSION}"
  docker service create \
    --name portainer \
    --constraint 'node.role==manager' \
    --publish "published=${PORTAINER_PORT},target=9000" \
    --mount type=bind,src=/var/run/docker.sock,dst=/var/run/docker.sock \
    --mount type=volume,src=portainer_data,dst=/data \
    --label bosun.stack=infra \
    "${PORTAINER_IMAGE}"
fi

# ── 4. Wait for the Portainer API to be reachable ─────────────────────────────
# Prefer the host-local port (fresh-boot path); fall back to the public route
# (existing boxes whose service predates the published port).
log "Waiting for Portainer API"
PORTAINER_URL=""
for _ in $(seq 1 60); do
  for url in "$PORTAINER_LOCAL_URL" "$PORTAINER_PUBLIC_URL"; do
    if curl -fsS -o /dev/null --max-time 3 "$url/api/status" 2>/dev/null; then
      PORTAINER_URL="$url"; break 2
    fi
  done
  sleep 2
done
[ -n "$PORTAINER_URL" ] || { log "FATAL: Portainer API never became reachable"; exit 1; }
log "Portainer reachable at $PORTAINER_URL"

# ── 5. Create the admin account (within Portainer's ~5 min init window) ────────
# Portainer disables /api/users/admin/init shortly after first boot, so this must
# run promptly. Already-initialised boxes just fail the init and pass the auth check.
ADMIN_PW=$(op read "op://Homelab/Portainer Admin/password")
INIT_CODE=$(curl -sS -o /dev/null -w '%{http_code}' \
  -X POST "$PORTAINER_URL/api/users/admin/init" \
  -H 'Content-Type: application/json' \
  -d "$(jq -n --arg p "$ADMIN_PW" '{username:"admin",password:$p}')" || echo 000)
if [ "$INIT_CODE" = "200" ]; then
  log "Portainer admin created"
else
  log "Admin init returned HTTP $INIT_CODE (already initialised?) — verifying auth"
fi

# Verify we can authenticate, regardless of the init status code.
JWT=$(curl -sS -X POST "$PORTAINER_URL/api/auth" -H 'Content-Type: application/json' \
  -d "$(jq -n --arg p "$ADMIN_PW" '{username:"admin",password:$p}')" \
  | jq -r '.jwt // empty')
[ -n "$JWT" ] || { log "FATAL: cannot authenticate as Portainer admin"; exit 1; }
log "Portainer admin auth ok"

# ── 6. Name the Portainer environment 'production' (bd www-4b5) ─────────────────
PORTAINER_URL="$PORTAINER_URL" "$(dirname "$0")/rename-portainer-env.sh"

# ── 7. Confirm GHCR pull access before first bosun deploy ─────────────────────
# The GHCR_PULL_TOKEN docker secret must exist (created by scripts/save-ghcr-pull-token.sh).
# bosun reads it from 1Password and materialises it as a docker secret at deploy time.
if docker secret ls --format '{{.Name}}' | grep -q 'ghcr_pull_token'; then
  log "GHCR pull token secret present"
else
  log "WARNING: GHCR pull token docker secret not found."
  log "Run scripts/save-ghcr-pull-token.sh first, then re-run bootstrap."
  exit 1
fi

# ── 8. First bosun deploy ─────────────────────────────────────────────────────
log "Running bosun up (first deploy)"
# bosun resolves secrets from 1Password and deploys the full control-center stack.
# Requires: op session, swarm reachable, GHCR pull token in 1Password.
bun run bosun up

log "Bootstrap complete."
log "Next: verify OrbStack 'Start at login' is enabled."
