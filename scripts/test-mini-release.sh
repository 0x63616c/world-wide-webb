#!/usr/bin/env bash
set -euo pipefail
repo=$(cd "$(dirname "$0")/.." && pwd)
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
mkdir -p "$scratch/bin" "$scratch/runtime"
export WWW_ROOT="$scratch/runtime" MINI_TEST_LOG="$scratch/log"
export PATH="$scratch/bin:$PATH"
touch "$WWW_ROOT/runtime.env" "$WWW_ROOT/compose.yaml"
cat > "$scratch/bin/docker" <<'SH'
#!/usr/bin/env bash
echo "$*" >> "$MINI_TEST_LOG"
case "$*" in
  *'ps -q postgres'*) [[ "${MISSING_DB:-0}" == 1 ]] || echo test-db ;;
  *'exec -T -e EXPECTED_REVISION='*) exit "${HEALTH_FAILURE:-0}" ;;
esac
exit 0
SH
chmod +x "$scratch/bin/docker"
image="ghcr.io/0x63616c/www-control-center-mini@sha256:$(printf '%064d' 1)"
revision=$(printf '%040d' 2)
run() { bash "$repo/deploy/mini/release.sh" "$image" "$revision" "$1"; }
# Mutable images must be rejected before Docker is invoked.
if bash "$repo/deploy/mini/release.sh" ghcr.io/0x63616c/www-control-center-mini:main "$revision" 1; then exit 1; fi
test ! -f "$MINI_TEST_LOG"
# A wrong data/project location must not stop the working application.
if MISSING_DB=1 run 1; then exit 1; fi
if grep -q 'stop www' "$MINI_TEST_LOG"; then exit 1; fi
test ! -d "$WWW_ROOT/deploy.lock"
run 2
test "$(cat "$WWW_ROOT/generation")" = 2
test -f "$WWW_ROOT/current.env"
cp "$WWW_ROOT/current.env" "$scratch/accepted.env"
before=$(wc -l < "$MINI_TEST_LOG")
run 1
test "$before" = "$(wc -l < "$MINI_TEST_LOG")"
# A failed post-start health/version check must not advance accepted release state.
if HEALTH_FAILURE=1 run 3; then exit 1; fi
test "$(cat "$WWW_ROOT/generation")" = 2
cmp "$WWW_ROOT/current.env" "$scratch/accepted.env"
test ! -d "$WWW_ROOT/deploy.lock"
mkdir "$WWW_ROOT/deploy.lock"
if run 4; then exit 1; fi
test -d "$WWW_ROOT/deploy.lock"
echo 'PASS: immutable releases, database guard, stale release, failed health and concurrent lock'
