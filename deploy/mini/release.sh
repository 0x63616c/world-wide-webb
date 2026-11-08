#!/usr/bin/env bash
# Runs on macOS. Only manages the www-control-center Compose project.
set -euo pipefail
export PATH="$PATH:/usr/local/bin:/opt/homebrew/bin"
root="${WWW_ROOT:-$HOME/www-control-center}"
code="${WWW_CODE_DIR:-$root}"
image="${1:?image digest required}"
revision="${2:?commit SHA required}"
generation="${3:?monotonic workflow run number required}"
[[ "$image" =~ ^ghcr.io/0x63616c/www-control-center-mini@sha256:[0-9a-f]{64}$ ]] || exit 64
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || exit 64
[[ "$generation" =~ ^[0-9]{1,12}$ ]] || exit 64
generation=$((10#$generation))
test -f "$root/runtime.env"
test -f "$code/compose.yaml"
mkdir -p "$root/releases"
if ! mkdir "$root/deploy.lock" 2>/dev/null; then
  echo 'Another deployment holds the lock; retry after it finishes.' >&2
  exit 75
fi
trap 'rmdir "$root/deploy.lock"' EXIT
last=0
if [[ -f "$root/generation" ]]; then last=$(cat "$root/generation"); fi
[[ "$last" =~ ^[0-9]+$ ]] || exit 65
if (( generation <= last )); then
  echo 'Release already deployed or superseded.'
  exit 0
fi
# Keep the immutable release and previous pointer for explicit rollback.
release="$root/releases/$generation-$revision.env"
umask 077
printf 'WWW_IMAGE=%s\n' "$image" > "$release"
compose() {
  docker compose --env-file "$root/runtime.env" --env-file "$release" \
    -f "$code/compose.yaml" "$@"
}
compose config --quiet
compose pull www
observed=$(docker run --rm --read-only --network none --entrypoint www-server "$image" version)
[[ "$observed" == "$revision" ]] || { echo 'Image revision does not match the requested release.' >&2; exit 1; }
# A deployment must never create a fresh production DB because of a wrong path.
compose config --format json | python3 "$code/sqlite_preflight.py"
legacy_pg_id=""
if [[ -f "$root/compose.yaml" ]] && grep -q '^  postgres:' "$root/compose.yaml"; then
  test -f "$root/.sqlite-import-verified.json" || { echo 'Finish and verify the frozen-writer SQLite import before the first Rust release.' >&2; exit 1; }
  legacy_pg_id=$(docker compose --env-file "$root/runtime.env" --env-file "$release" -f "$root/compose.yaml" ps -q postgres)
fi
if [[ -f "$root/current.env" ]]; then cp "$root/current.env" "$root/previous.env"; fi
# Ensure only one cycle owner runs; never bring the entire project down.
compose stop www
mkdir -p "$root/backups"
if ! python3 "$code/sqlite_snapshot.py" --container www-control-center-www-1 \
  "$root/backups/before-release-$generation-$revision-$(date -u +%Y%m%dT%H%M%SZ)-$$.sqlite"; then
  # A failed backup must not leave the previously running app stopped.
  docker --context orbstack start www-control-center-www-1 >/dev/null
  exit 1
fi
compose up -d --no-deps --wait --wait-timeout 180 www
compose exec -T -e EXPECTED_REVISION="$revision" www www-server healthcheck
python3 "$code/tailscale_serve.py"
if [[ "$code" != "$root" ]]; then
  for name in release.sh recover.sh compose.yaml sqlite_preflight.py sqlite_snapshot.py tailscale_serve.py backup.py nas-upload.py publish-apple-release.py; do
    cp "$code/$name" "$root/$name.tmp"
    mv "$root/$name.tmp" "$root/$name"
  done
  backup_root="${WWW_BACKUP_ROOT:-$HOME/homelab-backups}"
  test -d "$backup_root"
  for name in backup.py nas-upload.py sqlite_snapshot.py; do
    cp "$code/$name" "$backup_root/$name.tmp"
    mv "$backup_root/$name.tmp" "$backup_root/$name"
  done
fi
if [[ -n "$legacy_pg_id" ]]; then docker stop "$legacy_pg_id" >/dev/null; fi
cp "$release" "$root/current.env.tmp"
mv "$root/current.env.tmp" "$root/current.env"
printf '%s\n' "$generation" > "$root/generation.tmp"
mv "$root/generation.tmp" "$root/generation"
echo "Verified release $revision"
