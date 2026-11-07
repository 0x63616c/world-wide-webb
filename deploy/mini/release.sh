#!/usr/bin/env bash
# Runs on macOS. Only manages the www-control-center Compose project.
set -euo pipefail
export PATH="$PATH:/usr/local/bin:/opt/homebrew/bin"
root="${WWW_ROOT:-$HOME/www-control-center}"
image="${1:?image digest required}"
revision="${2:?commit SHA required}"
generation="${3:?monotonic workflow run number required}"
[[ "$image" =~ ^ghcr.io/0x63616c/www-control-center-mini@sha256:[0-9a-f]{64}$ ]] || exit 64
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || exit 64
[[ "$generation" =~ ^[0-9]{1,12}$ ]] || exit 64
generation=$((10#$generation))
test -f "$root/runtime.env"
test -f "$root/compose.yaml"
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
    -f "$root/compose.yaml" "$@"
}
compose config --quiet
compose pull www
observed=$(docker run --rm --read-only --network none --entrypoint www-server "$image" version)
[[ "$observed" == "$revision" ]] || { echo 'Image revision does not match the requested release.' >&2; exit 1; }
# A deployment must never create a fresh production DB because of a wrong path.
data_dir=$(compose config --format json | python3 "$root/sqlite_preflight.py")
if [[ -f "$root/current.env" ]]; then cp "$root/current.env" "$root/previous.env"; fi
# Ensure only one cycle owner runs; never bring the entire project down.
compose stop www
mkdir -p "$root/backups"
python3 "$root/sqlite_snapshot.py" "$data_dir/control-center.sqlite" \
  "$root/backups/before-release-$generation-$revision-$(date -u +%Y%m%dT%H%M%SZ)-$$.sqlite"
compose up -d --no-deps --wait --wait-timeout 180 www
compose exec -T -e EXPECTED_REVISION="$revision" www www-server healthcheck
cp "$release" "$root/current.env.tmp"
mv "$root/current.env.tmp" "$root/current.env"
printf '%s\n' "$generation" > "$root/generation.tmp"
mv "$root/generation.tmp" "$root/generation"
echo "Verified release $revision"
