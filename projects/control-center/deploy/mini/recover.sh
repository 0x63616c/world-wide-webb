#!/usr/bin/env bash
# Explicit application recovery only; never reverses database migrations.
set -euo pipefail
export PATH="$PATH:/usr/local/bin:/opt/homebrew/bin"
root="${WWW_ROOT:-$HOME/www-control-center}"
code="${WWW_CODE_DIR:-$root}"
target="${1:?previous or recovery-from required}"
revision="${2:?expected target commit SHA required}"
[[ "$target" == previous || "$target" == recovery-from ]] || exit 64
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || exit 64
[[ "${3:-}" == --database-compatible ]] || {
  echo 'Verify database compatibility before passing --database-compatible.' >&2
  exit 64
}
mkdir "$root/deploy.lock" 2> /dev/null || exit 75
trap 'rmdir "$root/deploy.lock"' EXIT
test -f "$root/current.env"
line=$(cat "$root/$target.env")
[[ "$line" =~ ^WWW_IMAGE=ghcr.io/0x63616c/www-control-center-mini@sha256:[0-9a-f]{64}$ ]] || exit 64
umask 077
stamp="$(date -u +%Y%m%dT%H%M%SZ)-$$"
mkdir -p "$root/releases" "$root/backups"
release="$root/releases/recovery-$stamp.env"
printf '%s\n' "$line" > "$release"
compose() {
  docker compose --env-file "$root/runtime.env" --env-file "$release" \
    -f "$code/compose.yaml" "$@"
}
compose config --quiet
compose pull www
observed=$(docker run --rm --read-only --network none --entrypoint www-server "${line#WWW_IMAGE=}" version)
[[ "$observed" == "$revision" ]] || {
  echo 'Image revision does not match the requested release.' >&2
  exit 1
}
# The rollback target may predate database-check. Keep validation on the
# currently accepted image, whose capability is checked before mounting data.
validator=$(docker --context orbstack inspect --format '{{.Config.Image}}' www-control-center-www-1)
compose config --format json | python3 "$code/sqlite_preflight.py" "$validator"
cp "$root/current.env" "$root/recovery-from.env"
python3 "$code/sqlite_snapshot.py" --prune "$root/backups"
compose stop www
# Capture a consistent recovery point with application writers stopped.
if ! python3 "$code/sqlite_snapshot.py" --container www-control-center-www-1 \
  "$root/backups/before-recovery-$stamp.sqlite"; then
  # A failed backup must not leave the previously running app stopped.
  docker --context orbstack start www-control-center-www-1 > /dev/null
  exit 1
fi
compose up -d --no-deps --wait --wait-timeout 180 www
compose exec -T -e EXPECTED_REVISION="$revision" www www-server healthcheck
python3 "$code/tailscale_serve.py"
cp "$release" "$root/current.env.tmp"
mv "$root/current.env.tmp" "$root/current.env"
# Keep the highest accepted CI generation so delayed old jobs stay rejected.
python3 "$code/sqlite_snapshot.py" --prune "$root/backups"
# Fire-and-forget: NAS replication belongs to the bounded background backup job.
if ! "${WWW_LAUNCHCTL_BIN:-/bin/launchctl}" kickstart "gui/$(id -u)/com.calum.control-center-hourly-backup"; then
  echo 'NAS replication will retry on the next hourly backup run.' >&2
fi
echo "Verified recovery to $revision; CI generation unchanged."
