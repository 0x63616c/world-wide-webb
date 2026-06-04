#!/usr/bin/env bash
# Idempotent bootstrap for the homelab Mac Mini.
# Run once (or re-run safely) after OrbStack + Tailscale are confirmed running.
# No sudo. No secret values. Every step is safe to re-run.
set -euo pipefail

PORTAINER_VERSION="2.27.3"
PORTAINER_IMAGE="portainer/portainer-ce:${PORTAINER_VERSION}"

log() { printf '[bootstrap] %s\n' "$*"; }

# ── 1. Ensure Swarm is active ─────────────────────────────────────────────────
if docker info 2>/dev/null | grep -q "Swarm: active"; then
  log "Swarm already active — skipping init"
else
  log "Initialising Docker Swarm"
  docker swarm init
fi

# ── 2. Portainer (monitoring UI only — never deploys anything) ────────────────
if docker service ls --format '{{.Name}}' | grep -q '^portainer$'; then
  log "Portainer service already exists — skipping create"
else
  log "Creating portainer_data volume"
  docker volume create portainer_data

  log "Starting Portainer ${PORTAINER_VERSION}"
  docker service create \
    --name portainer \
    --constraint 'node.role==manager' \
    --mount type=bind,src=/var/run/docker.sock,dst=/var/run/docker.sock \
    --mount type=volume,src=portainer_data,dst=/data \
    --label bosun.stack=infra \
    "${PORTAINER_IMAGE}"
fi

# ── 3. Confirm GHCR pull access before first bosun deploy ─────────────────────
# The GHCR_PULL_TOKEN docker secret must exist (created by scripts/save-ghcr-pull-token.sh).
# bosun reads it from 1Password and materialises it as a docker secret at deploy time.
if docker secret ls --format '{{.Name}}' | grep -q 'ghcr_pull_token'; then
  log "GHCR pull token secret present"
else
  log "WARNING: GHCR pull token docker secret not found."
  log "Run scripts/save-ghcr-pull-token.sh first, then re-run bootstrap."
  exit 1
fi

# ── 4. First bosun deploy ─────────────────────────────────────────────────────
log "Running bosun up (first deploy)"
# bosun resolves secrets from 1Password and deploys the full control-center stack.
# Requires: op session, swarm reachable, GHCR pull token in 1Password.
bun run bosun up

# ── 5. Name the Portainer environment 'production' ────────────────────────────
# Portainer auto-creates the local Docker environment as 'local'; rename it so the
# UI reflects the host's prod role (bd www-4b5). Idempotent. Needs the admin account
# initialised first — warns (does not fail bootstrap) if it isn't set up yet.
if "$(dirname "$0")/rename-portainer-env.sh"; then
  :
else
  log "WARNING: Portainer environment not renamed (admin not initialised yet)."
  log "         After setting the admin password, run scripts/rename-portainer-env.sh."
fi

log "Bootstrap complete."
log "Next: verify OrbStack 'Start at login' is enabled, then set the Portainer admin"
log "      password via scripts/save-portainer-admin.sh."
