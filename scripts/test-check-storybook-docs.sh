#!/usr/bin/env bash
# Hermetic tests for check-storybook-docs.sh. Creates throwaway story files in a
# temp dir and asserts the guard's pass/fail behaviour. No repo state touched.
# Run: bash scripts/test-check-storybook-docs.sh   (exits 0 iff all cases pass)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GUARD="$SCRIPT_DIR/check-storybook-docs.sh"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

pass=0
fail=0
check() { # description | expected-exit | file...
  local desc="$1" expected="$2"; shift 2
  local actual=0
  bash "$GUARD" "$@" >/dev/null 2>&1 || actual=$?
  if [ "$actual" -eq "$expected" ]; then
    echo "  ok: $desc (exit $actual)"; pass=$((pass + 1))
  else
    echo "  FAIL: $desc (expected $expected, got $actual)"; fail=$((fail + 1))
  fi
}

# Fixtures
direct="$tmp/Direct.stories.tsx"
printf 'const meta = { title: "UI/X", tags: ["autodocs"] };\nexport default meta;\n' > "$direct"

factory="$tmp/Factory.stories.tsx"
printf 'import { defineTileMeta } from "./factory";\nconst meta = { ...defineTileMeta("X", X) };\nexport default meta;\n' > "$factory"

missing="$tmp/Missing.stories.tsx"
printf 'const meta = { title: "UI/X" };\nexport default meta;\n' > "$missing"

notastory="$tmp/helper.tsx"
printf 'export const x = 1;\n' > "$notastory"

echo "check-storybook-docs tests:"
check "direct tags:[autodocs] passes"      0 "$direct"
check "defineTileMeta factory passes"      0 "$factory"
check "missing autodocs is rejected"       1 "$missing"
check "non-story arg is ignored (passes)"  0 "$notastory"
check "mixed batch with one missing fails" 1 "$direct" "$factory" "$missing"
check "all-good batch passes"              0 "$direct" "$factory"

echo ""
echo "passed: $pass  failed: $fail"
[ "$fail" -eq 0 ]
