#!/usr/bin/env bash
# Explicit application recovery only; never reverses database migrations.
set -euo pipefail
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
root="${WWW_ROOT:-$HOME/www-control-center}"
target="${1:?previous or recovery-from required}"
revision="${2:?expected target commit SHA required}"
[[ "$target" == previous || "$target" == recovery-from ]] || exit 64
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || exit 64
[[ "${3:-}" == --database-compatible ]] || {
  echo 'Verify database compatibility before passing --database-compatible.' >&2
  exit 64
}
mkdir "$root/deploy.lock" 2>/dev/null || exit 75
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
    -f "$root/compose.yaml" "$@"
}
compose config --quiet
compose pull www
docker run --rm --network none --entrypoint bun -e EXPECTED_REVISION="$revision" \
  "${line#WWW_IMAGE=}" -e 'process.exit(process.env.BUILD_HASH === process.env.EXPECTED_REVISION ? 0 : 1)'
dbid=$(compose ps -q postgres)
test -n "$dbid"
docker exec "$dbid" pg_isready -U postgres -d control_center >/dev/null
cp "$root/current.env" "$root/recovery-from.env"
compose stop www
# Capture a consistent recovery point with application writers stopped.
docker exec "$dbid" pg_dump -U postgres -d control_center -Fc \
  > "$root/backups/before-recovery-$stamp.dump.partial"
mv "$root/backups/before-recovery-$stamp.dump.partial" \
  "$root/backups/before-recovery-$stamp.dump"
compose up -d --no-deps --wait --wait-timeout 180 www
compose exec -T -e EXPECTED_REVISION="$revision" www bun -e '
const health = await (await fetch("http://127.0.0.1:4201/healthz")).json();
if (health.database !== "ok" || health.stopping) throw new Error("Unhealthy database/lifecycle");
if (health.cycles.enabled !== (process.env.WORKER_CYCLES === "on")) throw new Error("Wrong cycle ownership");
const build = await (await fetch("http://127.0.0.1:4201/trpc/health.buildHash")).json();
const hash = build.result?.data?.json?.hash ?? build.result?.data?.hash;
if (hash !== process.env.EXPECTED_REVISION) throw new Error("Wrong recovered revision");
'
cp "$release" "$root/current.env.tmp"
mv "$root/current.env.tmp" "$root/current.env"
# Keep the highest accepted CI generation so delayed old jobs stay rejected.
echo "Verified recovery to $revision; CI generation unchanged."
