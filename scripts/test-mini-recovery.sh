#!/usr/bin/env bash
set -euo pipefail
repo=$(cd "$(dirname "$0")/.." && pwd)
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
mkdir -p "$scratch/bin" "$scratch/runtime"
export WWW_ROOT="$scratch/runtime" MINI_TEST_LOG="$scratch/log"
export PATH="$scratch/bin:$PATH"
touch "$WWW_ROOT/runtime.env" "$WWW_ROOT/compose.yaml"
printf 'WWW_IMAGE=ghcr.io/0x63616c/www-control-center-mini@sha256:%064d\n' 1 > "$WWW_ROOT/previous.env"
printf 'WWW_IMAGE=ghcr.io/0x63616c/www-control-center-mini@sha256:%064d\n' 2 > "$WWW_ROOT/current.env"
cp "$WWW_ROOT/current.env" "$scratch/accepted.env"
echo 42 > "$WWW_ROOT/generation"
cat > "$scratch/bin/docker" <<'SH'
#!/usr/bin/env bash
echo "$*" >> "$MINI_TEST_LOG"
case "$*" in
  'run --rm --network none'*) exit "${IMAGE_FAILURE:-0}" ;;
  *'ps -q postgres'*) echo test-db ;;
  *'pg_dump '*) echo backup; exit "${DUMP_FAILURE:-0}" ;;
  *'exec -T -e EXPECTED_REVISION='*) exit "${HEALTH_FAILURE:-0}" ;;
esac
exit 0
SH
chmod +x "$scratch/bin/docker"
revision=$(printf '%040d' 1)
run() { bash "$repo/deploy/mini/recover.sh" "$1" "$revision" --database-compatible; }
if bash "$repo/deploy/mini/recover.sh" previous "$revision"; then exit 1; fi
test ! -f "$MINI_TEST_LOG"
if IMAGE_FAILURE=1 run previous; then exit 1; fi
if grep -q 'stop www' "$MINI_TEST_LOG"; then exit 1; fi
if DUMP_FAILURE=1 run previous; then exit 1; fi
if grep -q 'up -d' "$MINI_TEST_LOG"; then exit 1; fi
cmp "$WWW_ROOT/current.env" "$scratch/accepted.env"
if HEALTH_FAILURE=1 run previous; then exit 1; fi
cmp "$WWW_ROOT/current.env" "$scratch/accepted.env"
run previous
cmp "$WWW_ROOT/current.env" "$WWW_ROOT/previous.env"
cmp "$WWW_ROOT/recovery-from.env" "$scratch/accepted.env"
test "$(cat "$WWW_ROOT/generation")" = 42
run recovery-from
cmp "$WWW_ROOT/current.env" "$scratch/accepted.env"
test "$(cat "$WWW_ROOT/generation")" = 42
test ! -d "$WWW_ROOT/deploy.lock"
echo 'PASS: compatibility guard, image guard, backup failure, health failure, rollback and return without lowering CI generation'
