#!/usr/bin/env bash
# Hermetic rollout scenarios. No cluster, Pulumi backend, credentials or network.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
mkdir -p "$scratch/bin"
cat > "$scratch/bin/kubectl" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
printf 'kubectl %s\n' "$*" >> "$SCENARIO_LOG"
case "$*" in
  *'get deployment api'*) cat "$API_IMAGE_FILE" ;;
  *'patch deployment api'*) exit "${PATCH_RESULT:-0}" ;;
esac
MOCK
cat > "$scratch/bin/pulumi" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
printf 'pulumi %s\n' "$*" >> "$SCENARIO_LOG"
case "$1" in
  preview) exit "${PREVIEW_RESULT:-0}" ;;
  up)
    if [ "${ACTIVATE_WWW:-0}" = 1 ]; then
      echo 'ghcr.io/0x63616c/www-control-center-www@sha256:new' > "$API_IMAGE_FILE"
    fi
    exit "${APPLY_RESULT:-0}"
    ;;
esac
MOCK
chmod +x "$scratch/bin/"*
export PATH="$scratch/bin:$PATH"
export SCENARIO_LOG="$scratch/log" API_IMAGE_FILE="$scratch/image"

scenario() {
  : > "$SCENARIO_LOG"
  echo 'ghcr.io/0x63616c/www-control-center-api@sha256:old' > "$API_IMAGE_FILE"
  local actual=0
  bash "$root/scripts/deploy-www.sh" home-server > "$scratch/output" 2>&1 || actual=$?
  if [ "$actual" -ne "$1" ]; then
    cat "$scratch/output" >&2
    echo "FAIL: expected exit $1, got $actual" >&2
    exit 1
  fi
}

scenario 0
python3 - "$SCENARIO_LOG" <<'PY'
import sys
rows = open(sys.argv[1]).read().splitlines()
assert 'patch deployment api --type=merge' in rows[0]
assert '"rollingUpdate":null' in rows[0]
assert rows[1] == 'pulumi preview --stack home-server'
assert '--replicas=0' in rows[2]
assert 'wait --for=delete' in rows[3]
assert rows[4] == 'pulumi up --yes --stack home-server'
assert not any('--replicas=1' in row for row in rows)
PY
export PREVIEW_RESULT=12
scenario 12
! grep -q -- '--replicas=0' "$SCENARIO_LOG"
grep -q -- '--replicas=1' "$SCENARIO_LOG"
unset PREVIEW_RESULT
export APPLY_RESULT=13
scenario 13
grep -q -- '--replicas=1' "$SCENARIO_LOG"
export ACTIVATE_WWW=1
scenario 13
! grep -q -- '--replicas=1' "$SCENARIO_LOG"
unset APPLY_RESULT ACTIVATE_WWW
export PATCH_RESULT=14
scenario 14
! grep -q '^pulumi' "$SCENARIO_LOG"
grep -q -- '--replicas=1' "$SCENARIO_LOG"
echo 'PASS: strategy transition, preflight, legacy recovery, and no duplicate cycle owners (5 scenarios)'
