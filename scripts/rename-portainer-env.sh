#!/usr/bin/env bash
# Ensure the local Portainer environment (endpoint) is named 'production'.
#
# Portainer auto-creates the local Docker environment as 'local' on first boot.
# This is purely a UI label on Portainer's pointer to the single homelab host;
# bosun deploys via Docker directly and never touches it. Renaming makes the
# environment dropdown reflect the prod role of the Mini. (bd: CC-4b5)
#
# Idempotent: re-running when already 'production' is a no-op. Requires the admin
# account to be initialised first (scripts/save-portainer-admin.sh + admin/init).
set -euo pipefail

PURL="${PORTAINER_URL:-https://portainer.worldwidewebb.co}"
TARGET_NAME="production"

command -v jq >/dev/null || { echo "FATAL: jq is required" >&2; exit 1; }

log() { printf '[rename-env] %s\n' "$*"; }

U=$(op read "op://Homelab/Portainer Admin/username")
P=$(op read "op://Homelab/Portainer Admin/password")

JWT=$(curl -sS -X POST "$PURL/api/auth" -H 'Content-Type: application/json' \
  -d "$(jq -n --arg u "$U" --arg p "$P" '{username:$u,password:$p}')" \
  | jq -r '.jwt // empty')

if [ -z "$JWT" ]; then
  log "Could not authenticate to Portainer ($PURL)."
  log "Initialise the admin account first (scripts/save-portainer-admin.sh,"
  log "then POST /api/users/admin/init), then re-run this script."
  exit 1
fi

# Target the local Docker environment (Type 1 == Docker local socket).
EP=$(curl -sS "$PURL/api/endpoints" -H "Authorization: Bearer $JWT")
ID=$(printf '%s' "$EP" | jq -r 'map(select(.Type==1)) | .[0].Id // empty')
CUR=$(printf '%s' "$EP" | jq -r 'map(select(.Type==1)) | .[0].Name // empty')

[ -n "$ID" ] || { log "FATAL: no local Docker environment found"; exit 1; }

if [ "$CUR" = "$TARGET_NAME" ]; then
  log "Environment $ID already named '$TARGET_NAME' — nothing to do."
  exit 0
fi

log "Renaming environment $ID from '$CUR' to '$TARGET_NAME'"
NEW=$(curl -sS -X PUT "$PURL/api/endpoints/$ID" \
  -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' \
  -d "$(jq -n --arg n "$TARGET_NAME" '{name:$n}')" \
  | jq -r '.Name // empty')

[ "$NEW" = "$TARGET_NAME" ] || { log "FATAL: rename did not stick (got '$NEW')"; exit 1; }
log "ok — environment $ID is now '$TARGET_NAME'"
