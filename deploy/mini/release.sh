#!/usr/bin/env bash
# Runs on macOS. Only manages the www-control-center Compose project.
set -euo pipefail
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
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
# A deployment must never create a fresh production DB because of a wrong path.
dbid=$(compose ps -q postgres)
test -n "$dbid" || { echo 'Restore and start the database before deploying.' >&2; exit 1; }
docker exec "$dbid" pg_isready -U postgres -d control_center >/dev/null
if [[ -f "$root/current.env" ]]; then cp "$root/current.env" "$root/previous.env"; fi
# Ensure only one cycle owner runs; never bring the entire project down.
compose stop www
compose up -d --no-deps --wait --wait-timeout 180 www
compose exec -T -e EXPECTED_REVISION="$revision" www bun -e '
const health = await (await fetch("http://127.0.0.1:4201/healthz")).json();
if (health.database !== "ok" || health.stopping) throw new Error("Unhealthy database/lifecycle");
if (health.cycles.enabled !== (process.env.WORKER_CYCLES === "on")) throw new Error("Wrong cycle ownership");
const build = await (await fetch("http://127.0.0.1:4201/trpc/health.buildHash")).json();
const hash = build.result?.data?.json?.hash ?? build.result?.data?.hash;
if (hash !== process.env.EXPECTED_REVISION) throw new Error("Wrong deployed revision");
'
cp "$release" "$root/current.env.tmp"
mv "$root/current.env.tmp" "$root/current.env"
printf '%s\n' "$generation" > "$root/generation.tmp"
mv "$root/generation.tmp" "$root/generation"
echo "Verified release $revision"
